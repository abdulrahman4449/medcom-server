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
@objc(PulseOpsAlarmPlugin)
public class PulseOpsAlarmPlugin: CAPPlugin {

    private var player: AVAudioPlayer?

    public override func load() {
        // Deliberately not activating a session at launch. Doing that put the
        // app's audio ahead of everything else's from the moment it opened, so
        // simply having PulseOps installed quietened whatever the phone was
        // already playing. The session is configured when there is a reason
        // for one: going on duty (standby) or a dispatch (alert).
    }

    private var standbyPlayer: AVAudioPlayer?

    private func configureSession(ducking: Bool = true) {
        do {
            // Ducking is right for the alarm - it quietens a podcast or a call
            // on speaker so the dispatch is the thing the crew hears. It is
            // wrong for standby, which is silence: a phone that ducked
            // everything else for a whole shift would be unusable, so standby
            // mixes instead.
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: ducking ? [.duckOthers] : [.mixWithOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("PulseOpsAlarm: could not configure the audio session: \(error)")
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
            if self.standbyPlayer?.isPlaying == true {
                call.resolve(["standby": true])
                return
            }
            self.configureSession(ducking: false)
            do {
                // Built here rather than shipped as a file: a silent asset is
                // the sort of thing that goes missing from a bundle without
                // anybody noticing, and this must not be able to fail quietly.
                let p = try AVAudioPlayer(data: PulseOpsAlarmPlugin.silentWav())
                p.numberOfLoops = -1
                p.volume = 0
                p.prepareToPlay()
                p.play()
                self.standbyPlayer = p
                call.resolve(["standby": true])
            } catch {
                call.reject("Could not hold the app awake: \(error.localizedDescription)")
            }
        }
    }

    /// A two-tone alarm as a WAV, built in memory so the app never depends on a
    /// file being remembered. Alternating high and low with a gap between, the
    /// shape of every emergency tone there has ever been, and loud: this is the
    /// sound that has to carry over a running engine.
    private static func alarmWav() -> Data {
        let rate = 22050
        // high, silence, low, silence - one cycle, then looped by the player.
        let steps: [(Double, Double)] = [(880, 0.32), (0, 0.10), (660, 0.32), (0, 0.26)]
        var samples: [Int16] = []
        for (freq, seconds) in steps {
            let n = Int(Double(rate) * seconds)
            for i in 0..<n {
                if freq == 0 {
                    samples.append(0)
                    continue
                }
                let t = Double(i) / Double(rate)
                // A short fade at each end, or the square edge of a tone
                // starting at full amplitude arrives as a click.
                let fade = min(1.0, min(Double(i), Double(n - i)) / (Double(rate) * 0.01))
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
                    p = try AVAudioPlayer(data: PulseOpsAlarmPlugin.alarmWav())
                }
                // Repeat until the crew acknowledges; the web layer calls stop().
                p.numberOfLoops = -1
                p.volume = 1.0
                p.prepareToPlay()
                p.play()
                self.player = p
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
