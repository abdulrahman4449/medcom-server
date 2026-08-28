package com.pulseops.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.WindowManager;

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

    /**
     * The channel id carries a version, and that is not decoration.
     *
     * A notification channel is created once and is then the USER'S, not the
     * app's: Android refuses to change its importance, its sound or its
     * Do Not Disturb bypass afterwards, silently, for ever. So a phone that
     * installed an early build - or whose owner once swiped the alert away and
     * chose "turn off notifications like this" - kept a silent channel that no
     * amount of reinstalling fixed, while the phone next to it was fine. That
     * is exactly what "sometimes it works and sometimes it doesn't" looks like
     * from the outside.
     *
     * Bumping this number is the only way to hand somebody a correct channel.
     * Do it whenever the sound, the importance or the bypass below changes,
     * and the old one is deleted on the way past.
     */
    private static final String CHANNEL_ID = "pulseops_dispatch_v2";
    private static final String[] OLD_CHANNEL_IDS = { "pulseops_dispatch" };
    // One id for the call banner, so a repeat replaces it rather than stacking.
    private static final int CALL_NOTIFICATION_ID = 4101;
    // Below this, an alarm on a truck's tablet is not going to be heard over a
    // running engine. Expressed as a share of the device's own maximum, since
    // that number differs by handset.
    private static final double MIN_ALARM_SHARE = 0.7;

    private MediaPlayer player;
    private AudioFocusRequest focusRequest;
    // What the alarm volume was before an alert raised it, so it can be put
    // back. -1 means "not raised by us".
    private int volumeBefore = -1;

    @Override
    public void load() {
        ensureChannel();
    }

    private NotificationManager nm() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = nm();
        if (nm == null) return;
        // Clear out the channels earlier builds made. Left behind they sit in
        // the phone's settings as a second, older "Dispatch alerts" entry, and
        // a crew turning the wrong one on is a support call nobody can solve
        // over the radio.
        for (String old : OLD_CHANNEL_IDS) {
            try { nm.deleteNotificationChannel(old); } catch (Exception ignored) {}
        }
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

        // IMPORTANCE_HIGH so it can interrupt; USAGE_ALARM so it plays on the
        // alarm stream rather than the media one.
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID, "Dispatch alerts", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("A call assigned to this ambulance. Plays as an alarm.");
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[] { 0, 600, 300, 600, 300, 600 });
        channel.setBypassDnd(true);
        channel.setSound(alarmSoundUri(), alarmAttributes());
        nm.createNotificationChannel(channel);
    }

    /** The bundled tone if this build has one, otherwise the phone's own alarm. */
    private Uri alarmSoundUri() {
        int resId = getContext().getResources()
            .getIdentifier("dispatch_alert", "raw", getContext().getPackageName());
        if (resId != 0) {
            return Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/dispatch_alert");
        }
        Uri alarm = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
        return alarm != null ? alarm : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
    }

    private AudioAttributes alarmAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
    }

    private AudioManager audio() {
        return (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    @PluginMethod
    public void alert(PluginCall call) {
        try {
            stopPlayer();
            ensureChannel();

            // An alarm nobody can hear over a diesel engine is not an alarm.
            //
            // STREAM_ALARM has a volume of its own, separate from the media
            // slider, and a tablet handed over at 0 stays at 0 through every
            // shift after it - the alert plays on the right stream, correctly,
            // into silence. Raised for the length of the alert and put back by
            // stop(), so nobody's phone is left louder than they set it.
            raiseAlarmVolume();

            // Ask for focus so navigation and music duck out of the way. The
            // alarm stream plays regardless, but an alert underneath a
            // turn-by-turn instruction at full volume is one a crew can miss -
            // and a truck with Maps running is the normal case, not the odd one.
            requestFocus();

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
            Vibrator v = vibrator();
            if (v != null && v.hasVibrator()) {
                long[] pattern = { 0, 600, 300, 600, 300, 600 };
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(VibrationEffect.createWaveform(pattern, 0), alarmAttributes());
                } else {
                    v.vibrate(pattern, 0);
                }
            }
            if (sounding) {
                call.resolve(status());
            } else {
                releaseFocus();
                restoreAlarmVolume();
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
            mp.setAudioAttributes(alarmAttributes());
            // A player that dies mid-loop used to do so in silence: the alarm
            // simply stopped and the crew had no idea it ever started. Errors
            // tear it down so the next repeat builds a fresh one.
            mp.setOnErrorListener((m, what, extra) -> { stopPlayer(); return true; });
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

    private Vibrator vibrator() {
        try {
            return (Vibrator) getContext().getSystemService(Context.VIBRATOR_SERVICE);
        } catch (Exception e) {
            return null;
        }
    }

    private void raiseAlarmVolume() {
        try {
            AudioManager am = audio();
            if (am == null) return;
            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int now = am.getStreamVolume(AudioManager.STREAM_ALARM);
            int want = (int) Math.ceil(max * MIN_ALARM_SHARE);
            if (now >= want) return;
            volumeBefore = now;
            am.setStreamVolume(AudioManager.STREAM_ALARM, want, 0);
        } catch (Exception ignored) {
            // Do Not Disturb can refuse this without the app holding policy
            // access. The alert still plays; it plays quietly, and
            // backgroundStatus() below is what says so.
        }
    }

    private void restoreAlarmVolume() {
        try {
            if (volumeBefore < 0) return;
            AudioManager am = audio();
            if (am != null) am.setStreamVolume(AudioManager.STREAM_ALARM, volumeBefore, 0);
        } catch (Exception ignored) {
        } finally {
            volumeBefore = -1;
        }
    }

    private void requestFocus() {
        try {
            AudioManager am = audio();
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                    .setAudioAttributes(alarmAttributes())
                    .build();
                am.requestAudioFocus(focusRequest);
            } else {
                am.requestAudioFocus(null, AudioManager.STREAM_ALARM,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
        } catch (Exception ignored) {
        }
    }

    private void releaseFocus() {
        try {
            AudioManager am = audio();
            if (am == null) return;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (focusRequest != null) am.abandonAudioFocusRequest(focusRequest);
            } else {
                am.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {
        } finally {
            focusRequest = null;
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
            NotificationManager nm = nm();
            if (nm == null) {
                call.reject("No notification manager on this device.");
                return;
            }
            ensureChannel();
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

    /**
     * Keep the screen on while somebody is signed on.
     *
     * This is the whole Android answer to "the alert was late" and most of the
     * answer to "it never came".
     *
     * The board is read every three seconds by a timer inside the WebView.
     * Android throttles a backgrounded WebView's timers - first to about one a
     * second, then to one a minute, and after a few minutes it freezes the page
     * outright. A frozen page runs no timer, makes no request, and never learns
     * a call was raised, so there is nothing for any alarm to sound about. Doze
     * and the per-manufacturer battery savers make it worse and make it
     * inconsistent, which is why the same call reaches one tablet at once, the
     * next one a minute late, and the third not at all.
     *
     * A screen that stays on is a page that is never backgrounded. FLAG_KEEP_
     * SCREEN_ON is a window flag: no permission, nothing to declare to Google,
     * and it lets go the moment the crew signs out. It costs battery, which is
     * the right trade for a tablet in a cradle on a charger and the reason it
     * is tied to being signed on rather than to the app being open.
     *
     * It does NOT survive the crew pressing Home or locking the tablet. Nothing
     * a web layer can do does - see native/README.md for the two things that
     * would, and what each costs.
     */
    @PluginMethod
    public void keepAwake(PluginCall call) {
        final boolean on = call.getBoolean("on", true);
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity to hold awake.");
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                if (on) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            } catch (Exception ignored) {
            }
        });
        JSObject out = new JSObject();
        out.put("on", on);
        call.resolve(out);
    }

    /**
     * Everything about this phone that decides whether a call will be heard.
     *
     * A crew cannot read a log and a supervisor on the radio cannot either, so
     * the answers go on the screen under the speaker check. Every one of these
     * has silenced a real alert, and none of them is visible from inside the
     * web layer:
     *
     *  - notifications turned off for the app entirely
     *  - the alarm channel silenced or dropped below IMPORTANCE_HIGH by the
     *    owner, which Android will not let the app undo
     *  - the alarm stream sitting at zero
     *  - battery optimisation putting the app to sleep in the background
     */
    @PluginMethod
    public void backgroundStatus(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject out = new JSObject();
        try {
            NotificationManager nm = nm();
            out.put("notificationsEnabled", nm != null && nm.areNotificationsEnabled());
            if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = nm.getNotificationChannel(CHANNEL_ID);
                out.put("channelExists", ch != null);
                out.put("channelImportance", ch == null ? -1 : ch.getImportance());
                out.put("channelSilenced", ch != null
                    && (ch.getImportance() == NotificationManager.IMPORTANCE_NONE || ch.getSound() == null));
                out.put("channelBypassesDnd", ch != null && ch.canBypassDnd());
            }
        } catch (Exception ignored) {
        }
        try {
            AudioManager am = audio();
            if (am != null) {
                int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
                int now = am.getStreamVolume(AudioManager.STREAM_ALARM);
                out.put("alarmVolume", now);
                out.put("alarmVolumeMax", max);
                out.put("alarmVolumePct", max > 0 ? (int) Math.round((now * 100.0) / max) : 0);
            }
        } catch (Exception ignored) {
        }
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean exempt = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
            out.put("batteryOptimised", !exempt);
        } catch (Exception ignored) {
        }
        out.put("platform", "android");
        out.put("sdk", Build.VERSION.SDK_INT);
        return out;
    }

    /**
     * Two taps to the screen that fixes it.
     *
     * Telling a crew "your notification channel is silenced" and leaving them
     * to find it is telling them nothing. Neither of these needs a permission:
     * the app is opening a settings page, not changing a setting.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "notifications");
        try {
            Intent i;
            if ("battery".equals(which)) {
                i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            } else if ("channel".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName())
                    .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.parse("package:" + getContext().getPackageName()));
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not open that settings page: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopPlayer();
        releaseFocus();
        restoreAlarmVolume();
        Vibrator v = vibrator();
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
