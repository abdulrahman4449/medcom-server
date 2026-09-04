import Foundation
import Capacitor
import UIKit
import UserNotifications
import FirebaseCore
import FirebaseMessaging

/**
 * PulseOpsPush — the iPhone half of "a locked phone is woken by the SERVER".
 *
 * WHY THIS EXISTS. The WebView freezes when a phone locks, the three-second
 * poll stops with it, and no alarm in the app can sound about a call it never
 * learned of. Android has been woken by FCM since the push work landed; iOS
 * had no plugin at all, so `src/lib/push.jsx` found nothing, returned quietly,
 * and the poll was the whole story — an iPhone in a pocket simply missed the
 * call. This is the missing half.
 *
 * WHY FIREBASE RATHER THAN APNs DIRECTLY. The server already speaks FCM, and
 * FCM hands off to Apple. Writing a second sender — JWT-signed HTTP/2 to
 * api.push.apple.com — would mean two credentials, two code paths and two
 * ways to fail silently, for one extra platform. Firebase takes the .p8 key
 * and the server does not change at all.
 *
 * WHAT IT DOES NOT DO. It does not get past the silent switch, the volume
 * slider or Do Not Disturb. The message is sent `time-sensitive`, which
 * breaks through Focus modes, and that is the strongest thing available
 * without Apple's Critical Alert entitlement. Say that rather than implying
 * an iPhone on silent is covered.
 *
 * PRIVACY. Nothing patient-shaped is in a push — the server decides the words
 * and they say a call landed and no more. This file only carries the token.
 *
 * The web layer talks to this through `window.Capacitor.Plugins.PulseOpsPush`
 * and needs exactly one method: getToken(). Any new method must be added to
 * pluginMethods as well as written, or it is a method the app can never call.
 */
@objc(PulseOpsPushPlugin)
public class PulseOpsPushPlugin: CAPPlugin, CAPBridgedPlugin, MessagingDelegate {

    public let identifier = "PulseOpsPushPlugin"
    public let jsName = "PulseOpsPush"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getToken", returnType: CAPPluginReturnPromise),
    ]

    // The plugin's own build, stamped like the alarm plugin's. A method list
    // is not a version: every method this web layer needs could already exist
    // in an older plugin, and then a stale build reports itself healthy.
    private let pluginBuild = "2026-09-04.1"

    public override func load() {
        // Printed so "is push even wired on this phone?" is answerable from
        // the Xcode console before the web layer gets a say.
        NSLog("PulseOpsPush: plugin loaded, build %@", pluginBuild)
        Messaging.messaging().delegate = self
    }

    /**
     * The FCM token for this device, which is what the server stores against
     * the crew's seat.
     *
     * THREE THINGS HAVE TO HAPPEN FIRST and they happen in this order, which
     * is why this is one method rather than three:
     *
     *  1. The person allows notifications. Without that, iOS issues no APNs
     *     token and Firebase has nothing to trade for an FCM one.
     *  2. iOS registers with APNs, which is a round trip to Apple.
     *  3. Firebase exchanges the APNs token for an FCM token.
     *
     * Asking for the token before step 1 has been answered returns an error
     * that reads like a fault in the app; asking before step 2 has completed
     * returns nothing at all. So this asks for permission, waits for it, and
     * only then requests the token — and answers with what actually happened
     * rather than an empty string, because "no token" and "the crew said no"
     * need different responses from the desk.
     */
    @objc func getToken(_ call: CAPPluginCall) {
        let centre = UNUserNotificationCenter.current()
        centre.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                NSLog("PulseOpsPush: permission error %@", error.localizedDescription)
            }
            guard granted else {
                NSLog("PulseOpsPush: notifications DENIED - this phone cannot be woken by the server")
                call.resolve(["token": "", "granted": false, "reason": "notifications-denied"])
                return
            }
            DispatchQueue.main.async {
                // Idempotent: iOS returns the existing registration if there
                // already is one, so this is safe on every sign-on.
                UIApplication.shared.registerForRemoteNotifications()
            }
            Messaging.messaging().token { token, err in
                if let err = err {
                    NSLog("PulseOpsPush: no FCM token - %@", err.localizedDescription)
                    call.resolve(["token": "", "granted": true, "reason": String(describing: err)])
                    return
                }
                let t = token ?? ""
                // The token itself is never logged: it is the address of one
                // specific phone, and it lives in a console people screenshot.
                NSLog("PulseOpsPush: FCM token obtained (%d chars)", t.count)
                call.resolve(["token": t, "granted": true, "platform": "ios", "pluginBuild": self.pluginBuild])
            }
        }
    }

    /// Firebase rotates tokens on its own schedule. The web layer re-registers
    /// once per app start and whenever the seat changes, so a rotated token is
    /// picked up then; this notifies the page as well, for the case where a
    /// crew is signed on and stays on through a rotation.
    public func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        NSLog("PulseOpsPush: token refreshed (%d chars)", (fcmToken ?? "").count)
        notifyListeners("pushTokenRefreshed", data: ["token": fcmToken ?? ""])
    }
}
