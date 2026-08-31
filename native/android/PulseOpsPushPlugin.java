// Same rule as the alarm plugin: this package line must match whatever
// MainActivity.java's first line says. Register it beside the alarm plugin:
//   registerPlugin(PulseOpsPushPlugin.class);
package com.PulseOps;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * The push half of the alarm story.
 *
 * The alarm plugin can make a phone LOUD; it cannot make a locked phone LOOK.
 * A locked Android freezes the WebView, the poll stops, and the app never
 * learns a call was raised. The server fills that gap: when a call lands on a
 * truck it sends a HIGH-priority FCM message addressed to the phones signed on
 * to that truck, onto the same dispatch channel the alarm plugin builds — so
 * it sounds on the alarm stream, through silent, with the phone locked, dozing
 * or the app swiped away.
 *
 * This plugin's only job is handing the web layer this device's FCM token, so
 * the web layer can register it against the truck being worked. Kept separate
 * from PulseOpsAlarmPlugin ON PURPOSE: this file needs the firebase-messaging
 * dependency and google-services.json, and a build without those should still
 * compile the alarm plugin untouched.
 *
 * Setup lives in native/README.md under "Push (FCM)".
 */
@CapacitorPlugin(name = "PulseOpsPush")
public class PulseOpsPushPlugin extends Plugin {

    @PluginMethod
    public void getToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful() || task.getResult() == null) {
                    Exception e = task.getException();
                    call.reject("No push token: " + (e == null ? "unknown" : e.getMessage()));
                    return;
                }
                JSObject out = new JSObject();
                out.put("token", task.getResult());
                call.resolve(out);
            });
        } catch (Exception e) {
            // Firebase not initialised — google-services.json missing from the
            // build. Say so in words somebody at a build machine can act on.
            call.reject("Push is not available in this build: " + e.getMessage());
        }
    }
}
