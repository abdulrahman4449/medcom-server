package com.pulseops.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * The alarm path.
 *
 * A web page cannot get past the hardware silent switch, the volume slider or
 * Do Not Disturb - no browser allows it, and that is the right default for a
 * web page. A dispatch is not a web page notification: a crew who muted a
 * tablet at two in the morning and then missed the call they were sent on is
 * the failure the whole alert exists to prevent.
 *
 * So the tone is played on USAGE_ALARM, the stream that wakes people up. It
 * ignores the media volume, plays through silent, and is one of the few
 * categories Do Not Disturb lets through.
 *
 * Register in MainActivity:  registerPlugin(PulseOpsAlarmPlugin.class);
 * Put the tone at:           android/app/src/main/res/raw/dispatch_alert.mp3
 */
@CapacitorPlugin(
    name = "PulseOpsAlarm",
    permissions = {
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class PulseOpsAlarmPlugin extends Plugin {

    private static final String CHANNEL_ID = "pulseops_dispatch";
    // One id for the call banner, so a repeat replaces it rather than stacking.
    private static final int CALL_NOTIFICATION_ID = 4101;
    private MediaPlayer player;

    @Override
    public void load() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm =
            (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;

        // IMPORTANCE_HIGH so it can interrupt; USAGE_ALARM so it plays on the
        // alarm stream rather than the media one.
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Dispatch alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("A call assigned to this ambulance. Plays as an alarm.");
        channel.enableVibration(true);
        channel.setBypassDnd(true);
        channel.setSound(
            Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/dispatch_alert"),
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
        nm.createNotificationChannel(channel);
    }

    @PluginMethod
    public void alert(PluginCall call) {
        try {
            stopPlayer();
            // A build without res/raw/dispatch_alert.mp3 is the commonest way
            // this goes wrong, and it used to go wrong silently: the lookup
            // returned 0, MediaPlayer handed back null, and the plugin still
            // answered "done" - so the web layer, believing the alarm was
            // sounding on the alarm stream, played nothing of its own. A truck
            // got a buzz and no tone. Now a missing tone is reported as a
            // failure, the vibration still happens, and the web layer falls
            // back to its own tone: beatable by a mute switch, but not silence.
            boolean sounding = false;
            int resId = getContext().getResources().getIdentifier("dispatch_alert", "raw",
                getContext().getPackageName());
            if (resId != 0) {
                sounding = startPlayer(MediaPlayer.create(getContext(), resId));
            }
            // No tone in this build? Use the phone's own alarm sound rather
            // than nothing.
            //
            // Falling back to the web layer's tone is not good enough here: a
            // browser tone cannot play until the page has been tapped, and a
            // phone opened fresh to a waiting call has not been tapped. The
            // device's alarm ringtone always exists, is what the owner has
            // already chosen to be woken by, and plays on the alarm stream like
            // everything else here.
            if (!sounding) {
                Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
                if (alarm == null) alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (alarm != null) {
                    sounding = startPlayer(MediaPlayer.create(getContext(), alarm));
                }
            }

            // Vibration alongside the tone: a truck with its siren running is
            // louder than any phone, and the buzz is what gets noticed.
            Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                long[] pattern = { 0, 600, 300, 600, 300, 600 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    v.vibrate(pattern, 0);
                }
            }
            if (sounding) {
                call.resolve();
            } else {
                call.reject("Nothing could be played on the alarm stream - the app will use its own tone.");
            }
        } catch (Exception e) {
            call.reject("Could not raise the alarm: " + e.getMessage());
        }
    }

    /** Attaches the alarm-stream attributes and starts looping. Null-safe:
        MediaPlayer.create returns null rather than throwing when it cannot open
        the source, which is exactly the case this has to survive. */
    private boolean startPlayer(MediaPlayer mp) {
        if (mp == null) return false;
        try {
            mp.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build());
            // Repeat until the crew acknowledges. The web layer calls stop()
            // when the banner is dismissed.
            mp.setLooping(true);
            mp.start();
            player = mp;
            return true;
        } catch (Exception e) {
            try { mp.release(); } catch (Exception ignored) {}
            return false;
        }
    }

    /**
     * A banner from the operating system.
     *
     * The WebView has no Notification API either, so the app's notification
     * path was dead here for the same reason it was dead on iOS: a crew not
     * looking at the screen was told nothing. This posts on the alarm channel
     * created above, so it carries USAGE_ALARM and sounds through a silenced
     * phone the way the tone does.
     *
     * Local, not push. It needs the app to be running.
     */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        // Android 13 and later ask for this at runtime; before that the
        // manifest entry is the whole permission and there is nothing to ask.
        // Android 13 and later ask at runtime. Before that the manifest entry
        // is the whole permission and there is nothing to prompt for.
        if (Build.VERSION.SDK_INT >= 33
                && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationsResult");
            return;
        }
        JSObject out = new JSObject();
        out.put("granted", true);
        call.resolve(out);
    }

    @PermissionCallback
    private void notificationsResult(PluginCall call) {
        JSObject out = new JSObject();
        out.put("granted", getPermissionState("notifications") == PermissionState.GRANTED);
        call.resolve(out);
    }

    @PluginMethod
    public void notify(PluginCall call) {
        try {
            String title = call.getString("title", "Incoming call");
            String body = call.getString("body", "");
            NotificationManager nm =
                (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) {
                call.reject("No notification manager on this device.");
                return;
            }
            Intent open = getContext().getPackageManager()
                .getLaunchIntentForPackage(getContext().getPackageName());
            PendingIntent tap = open == null ? null : PendingIntent.getActivity(
                getContext(), 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Notification.Builder b = new Notification.Builder(getContext(), CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setSmallIcon(getContext().getApplicationInfo().icon)
                .setCategory(Notification.CATEGORY_ALARM)
                .setAutoCancel(true);
            if (tap != null) b.setContentIntent(tap);
            // One id, so a repeat replaces the banner instead of stacking.
            nm.notify(CALL_NOTIFICATION_ID, b.build());
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not post the notification: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopPlayer();
        Vibrator v = (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        if (v != null) v.cancel();
        if (call != null) call.resolve();
    }

    private void stopPlayer() {
        try {
            if (player != null) {
                if (player.isPlaying()) player.stop();
                player.release();
                player = null;
            }
        } catch (Exception ignored) {
        }
    }
}
