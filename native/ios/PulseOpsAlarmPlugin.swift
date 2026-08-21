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
        configureSession()
    }

    private func configureSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .default,
                options: [.duckOthers]
            )
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            NSLog("PulseOpsAlarm: could not configure the audio session: \(error)")
        }
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
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
