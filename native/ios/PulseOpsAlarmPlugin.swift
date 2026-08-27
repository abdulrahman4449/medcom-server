import Foundation
import Capacitor
import AVFoundation
import UserNotifications

/**
 * The alarm path on iOS.
 *
 * A web page cannot get past the ring/silent switch. What native code can do
 * is declare the audio session as .playback, which is media rather than
 * ambient sound, and media plays through the silent switch. With .duckOthers
 * it also quietens anything else running - a podcast, a call on speaker - so
 * the dispatch is the thing the crew hears.
 *
 * Apple does not let a third-party app override Do Not Disturb. The honest
 * position is: this beats the silent switch and the volume slider, and it does
 * not beat Focus. Say that to the crews rather than implying it is covered.
 *
 * Register in AppDelegate or wherever plugins are registered.
 * Put the tone at: ios/App/App/dispatch_alert.mp3 (added to the target).
 */
// CAPBridgedPlugin, not just CAPPlugin.
//
// This is the whole reason the plugin was never there. Up to Capacitor 5 the
// CAP_PLUGIN macro in the .m file was what registered a plugin; from Capacitor
// 6 that route is gone and registration comes from this protocol - the
// identifier, the JavaScript name, and an explicit list of the methods the web
// layer is allowed to call. Without it the class compiles, ships, and is never
// loaded: window.Capacitor.Plugins.PulseOpsAlarm simply does not exist.
//
// Every symptom followed from that one line. No banner for a call, because the
// notification went to a plugin that was not there. No tone through the alarm
// path, because the alarm went to the same place - and the fallback is page
// audio, which iOS had already interrupted. The .m file below is kept for
// older Capacitor versions and is harmless here.
//
// There is deliberately no .m file any more. Keeping the old CAP_PLUGIN macro
// beside this conformance registers the same plugin twice by two different
// mechanisms, and Capacitor's own migration for 6 says to delete it. If an
// PulseOpsAlarmPlugin.m is still in the Xcode project, remove it.
//
// Any new method has to be added to pluginMethods as well as written. One
// without the other is a method the app can never call.
@objc(PulseOpsAlarmPlugin)
public class PulseOpsAlarmPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "PulseOpsAlarmPlugin"
    public let jsName = "PulseOpsAlarm"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "alert", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "standby", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
    ]


    private var player: AVAudioPlayer?

    public override func load() {
        // Printed so "is the plugin actually loaded?" is answerable from the
        // Xcode console, which is the one place that can answer it before the
        // web layer gets a say. If this line never appears, the class is not
        // being registered and nothing else in this file can run.
        NSLog("PulseOpsAlarm: plugin loaded and registered as %@", jsName)
        // Deliberately not activating a session at launch. Doing that put the
        // app's audio ahead of everything else's from the moment it opened, so
        // simply having PulseOps installed quietened whatever the phone was
        // already playing. The session is configured when there is a reason
        // for one: going on duty (standby) or a dispatch (alert).
    }

    private var standbyPlayer: AVAudioPlayer?

    private func configureSession(ducking: Bool = true) {
        do {
            // Ducking for the alarm, and nothing at all for standby.
            //
            // Standby used to ask for .mixWithOthers, on the reasoning that a
            // phone which ducked everything else for a whole shift would be
            // unusable. That reasoning was right and the option was fatal: with
            // .mixWithOthers the app is secondary audio, and iOS does not give
            // secondary audio background execution. It suspended the app
            // anyway, which stopped the poll, so no call ever arrived to sound
            // an alarm about — the exact fault standby exists to prevent,
            // caused by standby's own settings. The console said options=1.
            //
            // Plain .playback makes this the primary audio session, which is
            // what earns the background time. The cost is real and worth saying
            // out loud: going on duty interrupts music or a podcast playing on
            // that device. On a crew tablet that is the right trade. On
            // somebody's personal phone it is intrusive.
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: ducking ? [.duckOthers] : []
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("PulseOpsAlarm: could not configure the audio session: \(error)")
        }
    }

    /// Anything else that takes the audio session — a phone call, navigation
    /// speaking, Siri — interrupts our silence, and when it ends iOS does not
    /// restart it for us. Without this, one incoming call in the middle of a
    /// shift would end standby for good and the app would be suspendable again
    /// from then on, silently.
    private func watchForInterruptions() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: .main
        ) { [weak self] note in
            guard
                let self = self,
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                let type = AVAudioSession.InterruptionType(rawValue: raw)
            else { return }
            if type == .ended && self.standbyWanted {
                NSLog("PulseOpsAlarm: audio interruption ended, restarting standby")
                self.startStandby()
            } else if type == .began {
                NSLog("PulseOpsAlarm: audio interrupted by something else")
            }
        }
    }

    /**
     * Standby: staying awake while somebody is on duty.
     *
     * iOS suspends an app that goes to the background, and a suspended app has
     * stopped running JavaScript. That is the real reason a tone "does not work
     * in the background": not that the sound is blocked, but that the board is
     * no longer being polled, so the call never arrives and there is nothing to
     * sound. No alarm plugin can fix that from the outside.
     *
     * What iOS does not suspend is an app that is playing audio. So while a
     * crew is signed on, this holds an audio session open with silence looping
     * through it. Nothing is audible and nothing is ducked; the app simply
     * keeps running, the poll keeps working, and a dispatch still lands.
     *
     * Costs, stated plainly: it uses battery, so a crew tablet wants to be on
     * charge; it does not survive the app being force-quit from the app
     * switcher, or the phone restarting; and it needs UIBackgroundModes:audio
     * in Info.plist, without which iOS ends the session the moment the app
     * leaves the screen.
     */
    @objc func standby(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            if !on {
                self.standbyWanted = false
                self.standbyPlayer?.stop()
                self.standbyPlayer = nil
                // The session is only released if nothing else is using it -
                // an alarm sounding right now outranks going off duty.
                if self.player == nil {
                    try? AVAudioSession.sharedInstance().setActive(
                        false, options: .notifyOthersOnDeactivation)
                }
                call.resolve(["standby": false])
                return
            }
            self.standbyWanted = true
            self.watchForInterruptions()
            if self.standbyPlayer?.isPlaying == true {
                call.resolve(["standby": true])
                return
            }
            self.startStandby()
            call.resolve(["standby": self.standbyPlayer?.isPlaying == true])
        }
    }

    private var standbyWanted = false

    private func startStandby() {
        DispatchQueue.main.async {
            self.configureSession(ducking: false)
            do {
                // Built here rather than shipped as a file: a silent asset is
                // the sort of thing that goes missing from a bundle without
                // anybody noticing, and this must not be able to fail quietly.
                let p = try AVAudioPlayer(data: PulseOpsAlarmPlugin.silentWav())
                p.numberOfLoops = -1
                // Full volume on silent samples, not volume 0 on audible ones.
                // The content is silence either way and nothing is heard, but a
                // player turned down to nothing is a plausible thing for iOS to
                // treat as "not really playing" and suspend the app anyway —
                // which is the whole thing standby exists to prevent.
                p.volume = 1.0
                p.prepareToPlay()
                let started = p.play()
                self.standbyPlayer = p
                NSLog(
                    "PulseOpsAlarm: standby on, play()=%@ isPlaying=%@ category=%@ options=%lu",
                    started ? "accepted" : "REFUSED",
                    p.isPlaying ? "yes" : "NO",
                    AVAudioSession.sharedInstance().category.rawValue,
                    AVAudioSession.sharedInstance().categoryOptions.rawValue
                )
            } catch {
                NSLog("PulseOpsAlarm: could not hold the app awake: %@", error.localizedDescription)
            }
        }
    }

    /// The three call tones, built in memory so the app never depends on a file
    /// being remembered — and one per priority, because which of the three a
    /// crew hears is information, not decoration.
    ///
    /// A single shared alarm was a regression the moment the synthesised
    /// fallback started being used for real: CCT, ALS and BLS all arrived
    /// sounding identical, and none of them sounded like the tone the crews had
    /// already learned. These are the same figures as the Web Audio tones in
    /// dates.jsx, note for note, so the app sounds the same whichever path it
    /// takes.
    ///
    /// A gap follows each so the whole thing can loop without running together.
    private static func alarmWav(priority: String) -> Data {
        let rate = 22050
        // (frequency, seconds) — 0 Hz is silence.
        let steps: [(Double, Double)]
        switch priority {
        case "cct", "critical":
            // Fast alternating wail. The one that has to cut through a room.
            steps = [
                (950, 0.15), (650, 0.15), (950, 0.15),
                (650, 0.15), (950, 0.15), (650, 0.15), (0, 0.45),
            ]
        case "als", "urgent":
            // Two rising beeps, with a gap so they read as two.
            steps = [(700, 0.34), (0, 0.08), (1000, 0.34), (0, 0.5)]
        default:
            // The routine chime.
            steps = [(784, 0.30), (0, 0.02), (1046, 0.35), (0, 0.6)]
        }
        var samples: [Int16] = []
        for (freq, seconds) in steps {
            let n = Int(Double(rate) * seconds)
            for i in 0..<n {
                if freq == 0 {
                    samples.append(0)
                    continue
                }
                let t = Double(i) / Double(rate)
                // A short fade at each end, or a tone starting at full
                // amplitude arrives as a click — and this repeats until it is
                // acknowledged, so a click every second becomes the sound.
                let fade = min(1.0, min(Double(i), Double(n - i)) / (Double(rate) * 0.008))
                let v = sin(2.0 * Double.pi * freq * t) * 0.85 * fade
                samples.append(Int16(max(-1.0, min(1.0, v)) * 32767.0))
            }
        }
        return wav(samples: samples, rate: rate)
    }

    /// One second of silence as a WAV, 8 kHz mono. Small enough to keep in
    /// memory and looped forever.
    private static func silentWav(seconds: Double = 1.0) -> Data {
        let rate = 8000
        return wav(samples: [Int16](repeating: 0, count: Int(Double(rate) * seconds)), rate: rate)
    }

    /// 16-bit mono PCM in a WAV wrapper, which AVAudioPlayer reads from Data.
    private static func wav(samples: [Int16], rate: Int) -> Data {
        let bytes = samples.count * 2
        var d = Data()
        func str(_ s: String) { d.append(s.data(using: .ascii)!) }
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        str("RIFF"); u32(UInt32(36 + bytes)); str("WAVE")
        str("fmt "); u32(16); u16(1); u16(1)
        u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        str("data"); u32(UInt32(bytes))
        for s in samples { var x = s.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        return d
    }

    @objc func alert(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            NSLog("PulseOpsAlarm: alert() called")
            self.stopPlayer()
            self.configureSession()
            // The bundled tone if there is one, and a tone built here if there
            // is not.
            //
            // Depending on a file being in the bundle made "did somebody
            // remember to add the mp3" into "does this ambulance get told about
            // its calls", and the failure was silent in the worst way: the
            // plugin refused, the web layer fell back to its own tone, and that
            // tone cannot play until the page has been tapped. On a phone
            // opened fresh to a waiting call there had been no tap, so the crew
            // got nothing at all. An alarm must not have a missing-file case.
            do {
                let p: AVAudioPlayer
                if let url = Bundle.main.url(forResource: "dispatch_alert", withExtension: "mp3") {
                    p = try AVAudioPlayer(contentsOf: url)
                } else {
                    p = try AVAudioPlayer(
                        data: PulseOpsAlarmPlugin.alarmWav(priority: call.getString("priority") ?? "routine"))
                }
                // Repeat until the crew acknowledges; the web layer calls stop().
                p.numberOfLoops = -1
                p.volume = 1.0
                p.prepareToPlay()
                let started = p.play()
                self.player = p
                // Everything that decides whether a crew hears this, in one
                // line: whether the tone came from the bundle or was built
                // here, whether play() was accepted, whether the player really
                // is playing, and what the audio session is set to. "No tone"
                // is not one fault, it is five, and this says which.
                let session = AVAudioSession.sharedInstance()
                NSLog(
                    "PulseOpsAlarm: source=%@ play()=%@ isPlaying=%@ volume=%.2f category=%@ outputVolume=%.2f",
                    Bundle.main.url(forResource: "dispatch_alert", withExtension: "mp3") != nil
                        ? "bundled mp3" : "built in memory",
                    started ? "accepted" : "REFUSED",
                    p.isPlaying ? "yes" : "NO",
                    p.volume,
                    session.category.rawValue,
                    session.outputVolume
                )
                call.resolve()
            } catch {
                call.reject("Could not raise the alarm: \(error.localizedDescription)")
            }
        }
    }

    /**
     * A banner from the operating system, for the case the web layer cannot
     * cover.
     *
     * There is no Notification API in a WKWebView, so every notification path
     * the app has was dead on iOS: a crew who was not looking at the screen got
     * nothing at all when a call was assigned. This is a *local* notification -
     * it needs the app to be running, which while somebody is signed on it now
     * is - and it carries iOS's own sound and vibration rather than the page's,
     * so it still arrives when the page's audio has been interrupted.
     *
     * What it is not: a push. A force-quit app cannot be reached by this or by
     * anything else short of APNs, which needs a paid developer account.
     */
    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .sound, .badge]
        ) { granted, _ in
            NSLog("PulseOpsAlarm: notification permission granted=%@", granted ? "yes" : "NO")
            call.resolve(["granted": granted])
        }
    }

    @objc func notify(_ call: CAPPluginCall) {
        let content = UNMutableNotificationContent()
        content.title = call.getString("title") ?? "Incoming call"
        content.body = call.getString("body") ?? ""
        content.sound = .default
        // Time Sensitive gets past a Focus. It is honoured only when the build
        // carries the entitlement for it and ignored otherwise, which is why it
        // is set unconditionally and nothing depends on it.
        if #available(iOS 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }
        // One identifier, so a repeat replaces the banner rather than stacking a
        // pile of them up. A crew has one call at a time.
        let request = UNNotificationRequest(
            identifier: "pulseops-call",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { error in
            NSLog("PulseOpsAlarm: notify() posted, error=%@", error?.localizedDescription ?? "none")
            if let error = error {
                call.reject("Could not post the notification: \(error.localizedDescription)")
            } else {
                call.resolve()
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopPlayer()
            call.resolve()
        }
    }

    private func stopPlayer() {
        player?.stop()
        player = nil
        // Taking the alarm down must not take the app's standby down with it.
        // Releasing the session here unconditionally would have put the shell
        // straight back to sleep the moment a crew acknowledged a call - so the
        // first dispatch of a shift would have worked and none of the rest.
        if standbyPlayer?.isPlaying == true {
            configureSession(ducking: false)
            return
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
