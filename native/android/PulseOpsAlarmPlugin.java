package com.pulseops.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
@CapacitorPlugin(name = "PulseOpsAlarm")
public class PulseOpsAlarmPlugin extends Plugin {

    private static final String CHANNEL_ID = "pulseops_dispatch";
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
            player = MediaPlayer.create(getContext(),
                getContext().getResources().getIdentifier("dispatch_alert", "raw",
                    getContext().getPackageName()));
            if (player != null) {
                player.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
                // Repeat until the crew acknowledges. The web layer calls
                // stop() when the banner is dismissed.
                player.setLooping(true);
                player.start();
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
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not raise the alarm: " + e.getMessage());
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
