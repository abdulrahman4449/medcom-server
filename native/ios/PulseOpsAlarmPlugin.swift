import Foundation
import Capacitor
import AVFoundation

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

    /// One second of silence as a WAV, 8 kHz mono. Small enough to keep in
    /// memory and looped forever.
    private static func silentWav(seconds: Double = 1.0) -> Data {
        let rate = 8000
        let samples = Int(Double(rate) * seconds)
        let bytes = samples * 2
        var d = Data()
        func str(_ s: String) { d.append(s.data(using: .ascii)!) }
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        str("RIFF"); u32(UInt32(36 + bytes)); str("WAVE")
        str("fmt "); u32(16); u16(1); u16(1)
        u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        str("data"); u32(UInt32(bytes))
        d.append(Data(count: bytes))
        return d
    }

    @objc func alert(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stopPlayer()
            self.configureSession()
            guard let url = Bundle.main.url(forResource: "dispatch_alert", withExtension: "mp3") else {
                call.reject("dispatch_alert.mp3 is not in the app bundle")
                return
            }
            do {
                let p = try AVAudioPlayer(contentsOf: url)
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
