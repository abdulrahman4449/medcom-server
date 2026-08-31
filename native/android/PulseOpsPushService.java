// Package line: match MainActivity.java, exactly as with the two plugins.
package com.PulseOps;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Deliberately almost empty, and the emptiness is the design.
 *
 * The server sends NOTIFICATION-type FCM messages carrying the dispatch
 * channel's id. Android itself displays those — with the channel's own sound,
 * on the alarm stream, through silent — whenever the app is backgrounded,
 * locked or swiped away, with no code of ours running at all. That is exactly
 * the case push exists for, and the system path is the one that cannot be
 * broken by a frozen WebView or a crashed process.
 *
 * The two callbacks below cover the only other cases:
 *
 *  - onMessageReceived fires instead when the app is in the FOREGROUND. The
 *    page is awake and polling; it will raise the full-screen alarm by itself
 *    within three seconds, so doing anything here would double the noise.
 *
 *  - onNewToken fires when Firebase rotates this device's token. There is no
 *    auth token in this process to send it with, so nothing is sent from
 *    here: the web layer asks the plugin for the CURRENT token and registers
 *    it every time somebody signs on, which covers rotation on the next
 *    sign-in — and the server prunes tokens two months silent.
 */
public class PulseOpsPushService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        // Covered by re-registration at sign-on. See the class comment.
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        // Foreground arrival: the page alarms by itself. See the class comment.
    }
}
