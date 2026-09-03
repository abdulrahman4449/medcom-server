// The package must match the folder this file sits in, and that folder is
// whatever your Capacitor project already uses - open MainActivity.java, read
// its first line, and make this one identical. Android Studio reports a
// mismatch as "Package name ... does not correspond to the file path", which is
// the one error that stops the build before anything else is even looked at.
package com.PulseOps;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.PendingIntent;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.database.ContentObserver;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.util.Log;
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

    // How often the floor re-asserts itself while an alert sounds. Short
    // enough that a thumb held on volume-down never gets the alarm quiet for
    // long enough to be heard as quiet.
    private static final long FLOOR_TICK_MS = 400;

    // The PLUGIN's own build date, which is not the web build's.
    //
    // index.html is copied into the project and the plugin is rebuilt in
    // Android Studio, and it is easy to do one and not the other. Checking
    // that the METHOD NAMES exist cannot catch it here: every method this web
    // layer needs already existed in the previous plugin, so an Android phone
    // carrying a fortnight-old plugin reported "shell up to date" and there
    // was nothing anywhere that disagreed. A version says what a method list
    // cannot. Bump it whenever this file changes.
    private static final String PLUGIN_BUILD = "2026-09-03.4";

    private MediaPlayer player;
    // Separate from the alarm player, so a stand-down can never stop an alarm
    // that is still running for a different call.
    private MediaPlayer standDownPlayer;
    private AudioFocusRequest focusRequest;
    // What the alarm volume was before an alert raised it, so it can be put
    // back. -1 means "not raised by us".
    private int volumeBefore = -1;
    // Whether the last attempt at the floor actually landed, and why not. Read
    // back through status(), because a floor that is refused looks exactly like
    // one that worked from everywhere else in the app.
    private boolean volumeFloorOk = false;
    private String volumeFloorNote = "not attempted yet";
    // The floor's own heartbeat. See startFloorWatch().
    private Handler floorHandler;
    private Runnable floorTick;
    // Corrects a volume change the INSTANT it happens, rather than up to a
    // tick later. See startFloorWatch().
    private ContentObserver volumeObserver;
    // What actually happened to the alarm stream WHILE the last alert was
    // sounding: the lowest level seen, and how many times the floor put it
    // back. A reading taken afterwards is 86% and says nothing — the whole
    // question is what it was during the tone, and nobody can watch a number
    // and a phone at the same time. Reset when an alert starts, kept
    // afterwards so it can be read off the screen once the call is over.
    private int alarmVolumeMinPct = -1;
    private int floorRaises = 0;

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

    /**
     * Which of the two tones a priority gets.
     *
     * ALS and CCT are one answer - somebody getting up and moving now - and BLS
     * is the other. The same rule as `toneKeyFor` in src/lib/dates.jsx and
     * `toneKey(for:)` in the iOS plugin; change one and change all three.
     */
    static String toneKey(String priority) {
        String p = priority == null ? "" : priority.toLowerCase();
        if (p.equals("cct") || p.equals("critical") || p.equals("als") || p.equals("urgent")) {
            return "cct";
        }
        return "bls";
    }

    /**
     * The raw resource for a tone, or 0 if this build ships none for it.
     *
     * A bundled file may override a tone, but only per tone. The single generic
     * dispatch_alert.mp3 is deliberately NOT used for a dispatch any more: one
     * file cannot express two tones, so a build carrying it sounded the same
     * note for a dialysis run and a critical care transfer, and disagreed with
     * the browser and with iOS. That is exactly how "the ALS tone is right on
     * the server and wrong in the app" happens. With no per-tone file the tone
     * is built in memory below, from the same figures the browser uses.
     */
    private int toneResource(String priority) {
        return getContext().getResources()
            .getIdentifier("dispatch_alert_" + toneKey(priority), "raw", getContext().getPackageName());
    }

    /**
     * The alert tone, built here, note for note the same as the browser's.
     *
     * The department's two tones are a handful of sine steps; carrying them as
     * numbers rather than as files is what stops the three paths drifting apart
     * again. Written to the cache as a WAV so the existing MediaPlayer looping
     * works unchanged.
     *
     * Same figures as `playAlertTone` in src/lib/dates.jsx and `alarmWav` in
     * the iOS plugin.
     */
    private Uri builtToneUri(String priority) {
        try {
            String tone = toneKey(priority);
            // {frequency Hz, milliseconds}. 0 Hz is silence.
            int[][] steps = tone.equals("cct")
                ? new int[][] { {950, 150}, {650, 150}, {950, 150},
                                {650, 150}, {950, 150}, {650, 150}, {0, 450} }
                : new int[][] { {784, 300}, {0, 20}, {1046, 350}, {0, 600} };
            final int rate = 22050;
            int frames = 0;
            for (int[] st : steps) frames += (int) ((long) rate * st[1] / 1000);
            byte[] out = new byte[44 + frames * 2];
            java.nio.ByteBuffer b = java.nio.ByteBuffer.wrap(out).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            b.put("RIFF".getBytes("US-ASCII")).putInt(36 + frames * 2).put("WAVE".getBytes("US-ASCII"));
            b.put("fmt ".getBytes("US-ASCII")).putInt(16).putShort((short) 1).putShort((short) 1)
                .putInt(rate).putInt(rate * 2).putShort((short) 2).putShort((short) 16);
            b.put("data".getBytes("US-ASCII")).putInt(frames * 2);
            for (int[] st : steps) {
                int n = (int) ((long) rate * st[1] / 1000);
                for (int i = 0; i < n; i++) {
                    if (st[0] == 0) { b.putShort((short) 0); continue; }
                    double t = (double) i / rate;
                    // A short fade at each end: a tone starting at full
                    // amplitude clicks, and this repeats until it is
                    // acknowledged, so a click every second becomes the sound.
                    double fade = Math.min(1.0, Math.min(i, n - i) / (rate * 0.008));
                    double v = Math.sin(2 * Math.PI * st[0] * t) * 0.85 * fade;
                    b.putShort((short) (Math.max(-1.0, Math.min(1.0, v)) * 32767));
                }
            }
            java.io.File f = new java.io.File(getContext().getCacheDir(), "pulseops_" + tone + ".wav");
            java.io.FileOutputStream fos = new java.io.FileOutputStream(f);
            try { fos.write(out); } finally { fos.close(); }
            return Uri.fromFile(f);
        } catch (Exception e) {
            return null;
        }
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
            ensureChannel();

            // Already sounding? Then leave it alone and say yes.
            //
            // This is the whole of the "it played for a few seconds and then
            // stopped" fault. The web layer repeats this call every 1.7
            // seconds for as long as the call is unacknowledged, and this
            // method used to tear the player down and build a new one every
            // time. Three things went wrong with that, all of them at once:
            //
            //  - stopPlayer() ran FIRST, so a rebuild that failed for any
            //    reason - another app holding the audio device, memory
            //    pressure, the activity mid-pause - left the crew with silence
            //    where a working alarm had been a moment earlier, and there is
            //    no second chance once the page is frozen.
            //  - every pass asked for audio focus again, so tapping another
            //    app's notification started a fight over the audio device that
            //    the alarm could lose.
            //  - every pass restarted the vibration pattern from the top, so
            //    the buzz never got past its first pulse.
            //
            // The player already loops by itself and keeps looping while the
            // page is frozen, which is exactly what is wanted. So a repeat is
            // now a no-op: start once, keep going until stop().
            if (player != null && player.isPlaying()) {
                // Still re-assert the volume floor. A thumb on volume-down
                // mid-alarm takes the alarm stream below it, and an alarm
                // playing correctly into a lowered stream is the "it went
                // quiet by itself" report. Acknowledging is how an alert goes
                // quiet; the next repeat, 1.7 seconds later, brings the floor
                // back. No player is touched here - that lesson is above.
                raiseAlarmVolume();
                call.resolve(status());
                return;
            }
            stopPlayer();

            // A new alert, so a new trace. The repeat above returns before
            // this, or every pass would wipe the record of the dip it is
            // there to catch.
            alarmVolumeMinPct = -1;
            floorRaises = 0;

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

            // Which of the department's tones this call gets.
            //
            // ALS and CCT are the same answer - somebody getting up and moving
            // now - so they share a tone; BLS keeps its own, because that is
            // the difference a crew acts on. A build that ships only
            // dispatch_alert.mp3 uses it for everything, exactly as before.
            final String priority = call.getString("priority", "routine");
            final String tone = toneKey(priority);
            String source;
            boolean sounding = false;
            int resId = toneResource(priority);
            if (resId != 0) {
                source = "dispatch_alert_" + tone;
                sounding = startPlayer(MediaPlayer.create(getContext(), resId));
            } else {
                source = "built in memory";
                Uri built = builtToneUri(priority);
                if (built != null) sounding = startPlayer(MediaPlayer.create(getContext(), built));
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
                source = "the phone's own alarm";
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
                // The floor holds itself from here until stop(), whatever the
                // page is doing.
                startFloorWatch();
                // Handed back so the crew screen can say which tone this phone
                // actually played. "The ALS tone is wrong in the app" is not
                // answerable from a log nobody can open on a truck.
                JSObject out = status();
                out.put("tone", tone);
                out.put("source", source);
                call.resolve(out);
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
            // The stream's level and the player's own level multiply, so a
            // player left below 1.0 would cap the alarm under the floor no
            // matter what the stream says.
            mp.setVolume(1f, 1f);
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
            if (am == null) {
                noteFloor(false, "no audio service on this device");
                return;
            }
            int max = am.getStreamMaxVolume(AudioManager.STREAM_ALARM);
            int now = am.getStreamVolume(AudioManager.STREAM_ALARM);
            int want = (int) Math.ceil(max * MIN_ALARM_SHARE);
            int nowPct = pctOf(now, max);
            if (alarmVolumeMinPct < 0 || nowPct < alarmVolumeMinPct) alarmVolumeMinPct = nowPct;
            if (now >= want) {
                noteFloor(true, "already at or above the floor");
                return;
            }
            am.setStreamVolume(AudioManager.STREAM_ALARM, want, 0);
            // ASK, then LOOK. Android accepts setStreamVolume and quietly does
            // nothing under Do Not Disturb without notification-policy access,
            // and several manufacturers' battery or focus modes refuse it the
            // same silent way - no exception, no error, the stream simply
            // stays where the thumb left it. Assuming the write took is how
            // "the floor did not kick in" became invisible: the alarm played
            // correctly into a stream at 10% and every diagnostic said fine.
            int after = am.getStreamVolume(AudioManager.STREAM_ALARM);
            if (after < want) {
                // Some devices refuse an absolute set and still honour a
                // relative raise — the same permission, a different code path
                // inside the framework. Worth one climb before giving up and
                // calling the floor refused. Bounded by the stream's own max,
                // so this can never spin.
                for (int i = 0; i <= max && am.getStreamVolume(AudioManager.STREAM_ALARM) < want; i++) {
                    am.adjustStreamVolume(AudioManager.STREAM_ALARM, AudioManager.ADJUST_RAISE, 0);
                }
                after = am.getStreamVolume(AudioManager.STREAM_ALARM);
            }
            if (after >= want) {
                // Keep the ORIGINAL setting, once, and ONLY when the raise
                // actually took. A re-raise mid-alarm - the repeat above,
                // after a thumb on volume-down - must not overwrite what the
                // owner had it on, or stop() "restores" the alarm stream to
                // mid-alarm quiet and every alert after this one starts from
                // there. A refused raise must not arm the restore at all: it
                // changed nothing, so it has nothing to put back.
                if (volumeBefore < 0) volumeBefore = now;
                floorRaises++;
                noteFloor(true, "put it back to " + pctOf(after, max) + "% (from " + nowPct + "%)");
            } else {
                noteFloor(false, "REFUSED - the alarm stream stayed at "
                    + pctOf(after, max) + "%" + (dndOn() ? ", Do Not Disturb is on" : ""));
            }
        } catch (SecurityException e) {
            // Do Not Disturb refuses this outright without the app holding
            // notification-policy access. The alert still plays; it plays
            // quietly, and the crew line now says so rather than swallowing it.
            noteFloor(false, "REFUSED - Do Not Disturb blocks volume changes on this phone");
        } catch (Exception e) {
            noteFloor(false, "REFUSED - " + e.getMessage());
        }
    }

    /**
     * The floor re-asserts ITSELF, on the plugin's own timer.
     *
     * It used to be re-applied only when the web layer repeated alert(), every
     * 1.7 seconds — which makes an alarm's loudness depend on a JavaScript
     * timer inside a WebView, and Android throttles those the moment the page
     * is busy, backgrounded or scrolling. A thumb on volume-down during a call
     * then took the alarm stream to zero and nothing put it back: the tone was
     * still playing, correctly, into silence. Reported as "when I lowered the
     * volume the sound stopped entirely".
     *
     * A second is short enough that volume-down is undone before a crew has
     * finished pressing it, and this runs entirely inside the plugin, so it
     * holds whatever the page is doing — including nothing at all.
     */
    private void startFloorWatch() {
        stopFloorWatch();
        floorHandler = new Handler(Looper.getMainLooper());
        floorTick = new Runnable() {
            @Override
            public void run() {
                // The alert owns the floor for as long as the PLAYER EXISTS,
                // not for as long as isPlaying() happens to answer true.
                //
                // It used to bail out on a false from isPlaying() and never
                // reschedule — so one momentary false, which MediaPlayer gives
                // freely while it is preparing, seeking or recovering from an
                // interruption, killed the floor for the rest of the call and
                // nothing restarted it. A guarantee cannot have a case where it
                // silently stops guaranteeing. stopFloorWatch() is the only
                // thing that ends this, and stopPlayer() is the only thing that
                // calls it.
                if (player == null) return;
                raiseAlarmVolume();
                if (floorHandler != null) floorHandler.postDelayed(this, FLOOR_TICK_MS);
            }
        };
        // Immediately, then on the tick: the first correction must not wait.
        floorHandler.post(floorTick);

        // And instantly, on the volume itself.
        //
        // A timer alone means a thumb held on volume-down wins for up to a
        // whole tick, which is long enough for a crew to hear the alarm die.
        // Android publishes volume changes through the settings provider, so
        // the floor is put back in the same breath as it is taken away. Our
        // own write comes back through here too and is a no-op: the raise
        // returns early once the stream is at or above the floor.
        try {
            volumeObserver = new ContentObserver(floorHandler) {
                @Override
                public void onChange(boolean selfChange) {
                    if (player != null) raiseAlarmVolume();
                }
            };
            getContext().getContentResolver()
                .registerContentObserver(Settings.System.CONTENT_URI, true, volumeObserver);
        } catch (Exception ignored) {
            // Without the observer the tick above still holds the floor.
        }
    }

    private void stopFloorWatch() {
        try {
            if (floorHandler != null && floorTick != null) floorHandler.removeCallbacks(floorTick);
        } catch (Exception ignored) {
        }
        try {
            if (volumeObserver != null) getContext().getContentResolver().unregisterContentObserver(volumeObserver);
        } catch (Exception ignored) {
        }
        volumeObserver = null;
        floorHandler = null;
        floorTick = null;
    }

    /** The last thing the floor did, in words a crew can read off their own
        screen and send on. A guard that fails silently is a guard nobody knows
        about: this one is reported by status(), so it reaches the crew line,
        the owner's System page and a device's diagnostics answer. */
    private void noteFloor(boolean ok, String why) {
        // Only when it CHANGES: the watch below runs once a second, and a line
        // a second would bury everything else in logcat.
        if (ok != volumeFloorOk || !why.equals(volumeFloorNote)) {
            Log.i("PulseOpsAlarm", "volume floor: " + (ok ? "ok" : "NOT APPLIED") + " - " + why);
        }
        volumeFloorOk = ok;
        volumeFloorNote = why;
    }

    private int pctOf(int now, int max) {
        return max > 0 ? (int) Math.round((now * 100.0) / max) : 0;
    }

    /** Whether the phone is in some Do Not Disturb mode. Not a fault on its
        own - the alarm stream is meant to survive DND - but it is the usual
        reason a volume change is refused, so it is worth naming. */
    private boolean dndOn() {
        try {
            NotificationManager nm = nm();
            if (nm == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false;
            return nm.getCurrentInterruptionFilter() != NotificationManager.INTERRUPTION_FILTER_ALL;
        } catch (Exception e) {
            return false;
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
            // The channel's sound plays on the alarm stream at whatever the
            // slider happens to sit at - and this is exactly the path a phone
            // woken from a pocket takes, so it gets the same floor the full
            // alarm gets. Put back after the sound has had time to play,
            // unless the full alarm has started underneath in the meantime -
            // its own stop() owns the restore then.
            raiseAlarmVolume();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    if (player == null || !player.isPlaying()) restoreAlarmVolume();
                } catch (Exception ignored) {
                }
            }, 20000);
            Intent open = getContext().getPackageManager()
                .getLaunchIntentForPackage(getContext().getPackageName());
            PendingIntent tap = open == null ? null : PendingIntent.getActivity(
                getContext(), 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            // Channels arrived in API 26 and so did the constructor that takes
            // one. This project still builds for 24, so the older constructor
            // is kept for those two versions - on them there is no channel to
            // belong to, and the priority flag is what makes the banner
            // interrupt instead of sliding into the drawer quietly.
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                b = new Notification.Builder(getContext(), CHANNEL_ID);
            } else {
                b = new Notification.Builder(getContext())
                    .setPriority(Notification.PRIORITY_MAX)
                    .setSound(alarmSoundUri(), AudioManager.STREAM_ALARM);
            }
            b.setContentTitle(title)
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
        // getBoolean hands back a Boolean, and unboxing a null one throws -
        // the default only applies when the key is absent, not when it is
        // present and null.
        final Boolean asked = call.getBoolean("on", true);
        final boolean on = asked == null || asked.booleanValue();
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
                out.put("alarmVolumePct", pctOf(now, max));
            }
        } catch (Exception ignored) {
        }
        // What the volume floor did last time an alert asked for it. Without
        // this, a refused raise is indistinguishable from one that worked.
        out.put("volumeFloorOk", volumeFloorOk);
        out.put("volumeFloor", volumeFloorNote);
        out.put("alarmVolumeMinPct", alarmVolumeMinPct);
        out.put("floorRaises", floorRaises);
        out.put("dnd", dndOn());
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            boolean exempt = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || (pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
            out.put("batteryOptimised", !exempt);
        } catch (Exception ignored) {
        }
        out.put("platform", "android");
        out.put("pluginBuild", PLUGIN_BUILD);
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

    /**
     * The stand-down, on the alarm path rather than through page audio.
     *
     * A cancellation used to be a Web Audio tone and nothing else, so on a
     * phone whose page audio had been interrupted - which is every phone that
     * has just had an alarm playing over it, and every phone that has been in
     * the background - the crew were never told the call was off. They were
     * left driving to a patient nobody needed moved.
     *
     * One shot, not a loop: the web layer decides how often to repeat it, and
     * a stand-down that ran forever would be worse than the call it cancels.
     * It uses its own player so it can never stop an alarm that is still
     * running for a different call.
     */
    @PluginMethod
    public void standDown(PluginCall call) {
        try {
            stopStandDown();
            // As audible as the alarm that preceded it. A stand-down nobody
            // hears leaves a crew driving to a patient who does not need
            // moving, which is worse than a missed alert rather than better.
            raiseAlarmVolume();
            Uri tone = standDownUri();
            MediaPlayer mp = tone == null ? null : MediaPlayer.create(getContext(), tone);
            if (mp == null) {
                call.reject("Nothing to sound the stand-down with.");
                return;
            }
            mp.setAudioAttributes(alarmAttributes());
            mp.setLooping(false);
            mp.setOnCompletionListener((m) -> stopStandDown());
            mp.setOnErrorListener((m, what, extra) -> { stopStandDown(); return true; });
            mp.start();
            standDownPlayer = mp;
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not sound the stand-down: " + e.getMessage());
        }
    }

    /** A stand-down tone if this build ships one, otherwise the phone's own
        notification sound - which is deliberately not its alarm sound, so a
        cancellation can never be mistaken for another call arriving. */
    private Uri standDownUri() {
        int id = getContext().getResources()
            .getIdentifier("dispatch_stand_down", "raw", getContext().getPackageName());
        if (id != 0) {
            return Uri.parse("android.resource://" + getContext().getPackageName() + "/raw/dispatch_stand_down");
        }
        Uri n = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        return n != null ? n : RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
    }

    private void stopStandDown() {
        try {
            if (standDownPlayer != null) {
                if (standDownPlayer.isPlaying()) standDownPlayer.stop();
                standDownPlayer.release();
                standDownPlayer = null;
            }
        } catch (Exception ignored) {
        }
        // Only once nothing of ours is sounding. An alarm still running for a
        // different call keeps the volume it was raised to.
        if (player == null) {
            releaseFocus();
            restoreAlarmVolume();
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopPlayer();
        Vibrator v = vibrator();
        if (v != null) v.cancel();
        // The same race iOS had, in its Android form.
        //
        // A cancellation stops the alarm and sounds the stand-down at the same
        // moment. Handing the audio focus back and dropping the alarm stream to
        // whatever it was before, while a stand-down is playing on that very
        // stream, is how a crew gets told the call is off in a whisper - or not
        // at all. Both are left alone until the stand-down has finished; its
        // own completion listener tidies up after it.
        if (standDownPlayer != null && standDownPlayer.isPlaying()) {
            if (call != null) call.resolve();
            return;
        }
        releaseFocus();
        restoreAlarmVolume();
        if (call != null) call.resolve();
    }

    private void stopPlayer() {
        // Before the player, and unconditionally: a watch left running would go
        // on holding the alarm stream up after the call was acknowledged.
        stopFloorWatch();
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
