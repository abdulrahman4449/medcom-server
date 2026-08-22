# native/

The parts of PulseOps that cannot be written in a web page, kept here so they
travel with the app even though the Capacitor project itself lives on your Mac.

## What this is for

A dispatch alert has to be unmissable. The web layer already goes as far as a
browser is allowed: a call alert ignores the in-app loudness setting entirely,
including SILENT, declares its audio as `playback` rather than ambient, and
vibrates alongside the tone.

What a web page **cannot** do, on any browser, is override:

- the hardware silent switch
- the operating system's volume slider
- Do Not Disturb / Focus

So **a muted phone can still miss a call** until these two files are in the
native shell. Say that to the crews rather than implying it is covered.

## What these do

| | Android | iOS |
|---|---|---|
| Plays on | the **alarm** stream (`USAGE_ALARM`) | `.playback` session with `.duckOthers` |
| Beats the silent switch | yes | yes |
| Beats the volume slider | yes — alarm volume is separate | yes |
| Beats Do Not Disturb | yes (`setBypassDnd`) | **no** — Apple does not allow it |
| Repeats until acknowledged | yes | yes |
| Keeps the app awake in the background | no — see below | yes (`standby`) |
| Vibrates | yes | handled by the system |

The web app finds the plugin by name. When it is there, a dispatch goes through
it; when it is not — the browser version, or a shell that has not been rebuilt —
everything falls back to the existing Web Audio tone and behaves exactly as
before. Nothing breaks by not installing this; it just stays beatable by a
mute switch.

**The tone file is optional.** Both plugins used to give up without
`dispatch_alert.mp3` and hand back to the web layer's tone — which cannot play
until the page has been tapped, so a phone opened fresh to a call already
waiting made no sound at all. That is the worst outcome available and it hung on
whether somebody remembered to drag a file into Xcode. Now iOS builds its own
two-tone alarm in memory and Android falls back to the phone's own alarm
ringtone. Supply the mp3 if you want your own sound; do not supply it and the
alarm still sounds, on the alarm path, at full volume.

## Installing — Android

1. Copy `android/PulseOpsAlarmPlugin.java` into
   `android/app/src/main/java/com/pulseops/app/` (match the package line to
   your own applicationId if it differs).
2. Register it in `MainActivity.java`:

   ```java
   public class MainActivity extends BridgeActivity {
       @Override
       public void onCreate(Bundle savedInstanceState) {
           registerPlugin(PulseOpsAlarmPlugin.class);
           super.onCreate(savedInstanceState);
       }
   }
   ```
3. Put your alert tone at
   `android/app/src/main/res/raw/dispatch_alert.mp3`.
   The filename matters — the plugin looks it up by name.
4. Add to `AndroidManifest.xml`, inside `<manifest>`:

   ```xml
   <uses-permission android:name="android.permission.VIBRATE" />
   ```

   Nothing else. In particular **do not** add
   `ACCESS_BACKGROUND_LOCATION` — that triggers Google's Location Permissions
   declaration review, which this app's whole location design exists to avoid.
5. Rebuild the AAB and reinstall.

## Installing — iOS

1. Copy both `ios/PulseOpsAlarmPlugin.swift` and
   `ios/PulseOpsAlarmPlugin.m` into `ios/App/App/`, and add them to the App
   target in Xcode.
2. Add your tone as `dispatch_alert.mp3`, also added to the target
   ("Copy Bundle Resources").
3. In `Info.plist`, add background audio so a tone that starts as the screen
   locks is allowed to finish:

   ```xml
   <key>UIBackgroundModes</key>
   <array><string>audio</string></array>
   ```
4. Rebuild and reinstall.

## Staying awake — why the tone "does not work in the background"

The usual diagnosis is wrong. The sound is not being blocked; the app is not
running. iOS suspends a backgrounded app, and a suspended app has stopped
executing JavaScript — so the three-second poll stops, the dispatch never
arrives, and there is nothing for the alarm to sound about. No alarm plugin can
fix that from the outside, because nothing is running to call it.

What iOS does not suspend is an app that is playing audio. So while a crew is
signed on, the plugin holds an audio session open with **silence** looping
through it — nothing audible, nothing ducked, just enough that the operating
system keeps the process alive. The poll keeps running and a dispatch still
lands, at which point the alarm plays at full volume on the alarm path.

The app calls `standby({on:true})` at sign-in and `standby({on:false})` at
sign-out. A shell without the method simply carries on as before.

**What this costs, stated plainly:**

- It uses battery. A crew tablet wants to be on charge.
- It does **not** survive the app being force-quit from the app switcher, or
  the phone restarting. Nothing short of a push notification does.
- It needs `UIBackgroundModes: audio` in `Info.plist`. Without it iOS ends the
  session the moment the app leaves the screen and you are back where you
  started.

**Android** does not have this method. Its background story is different —
the WebView's timers are throttled and then frozen by Doze, and the honest fix
there is a foreground service or a high-priority FCM push, not a silent audio
loop. Until one of those exists, treat an Android phone with the app in the
background as a phone that can miss a call.

**Neither of these reaches a phone where the app is closed.** That needs a push
notification sent from the server: on Android a high-priority FCM message onto
the existing `USAGE_ALARM` channel, which does sound through silent; on iOS an
APNs push, and to get past the ring/silent switch specifically it must be a
**Critical Alert**, which needs a paid Apple Developer account and an
entitlement requested from Apple by form. Ordinary iOS pushes respect the
silent switch however loud you set the sound.

## Location — what the shells need

The map's tracking is ordinary `navigator.geolocation` in the web layer, and it
already asks the crew for consent inside the app. That is not the same
permission as the phone's. Without the two entries below the operating system
is never asked, so it never prompts, and the crew see an app that took their
"yes" and then showed the desk nothing.

**Android** — in `AndroidManifest.xml`, inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

Capacitor's own bridge handles the WebView's geolocation prompt and asks for the
runtime permission when the page requests a position — but only if the two lines
above are declared. **Do not add `ACCESS_BACKGROUND_LOCATION`**: tracking is
foreground-only by design, and that permission triggers Google's Location
Permissions declaration review.

**iOS** — in `Info.plist`:

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Your truck's position is shared with the dispatch desk while you are on a call, and only while this app is open.</string>
```

WKWebView will not ask for location without this string, and Apple rejects a
build that uses location without one. Do **not** add
`NSLocationAlwaysAndWhenInUseUsageDescription` — the app never wants location in
the background.

The app asks the phone at the moment the crew taps **Allow while on a call** on
the consent sheet, so the OS dialog appears next to the explanation rather than
in the middle of a call. If the phone refuses, the crew are told there and then
and pointed at the right Settings screen.

## Checking it worked

Put the phone on **silent**, turn the volume **all the way down**, and have the
desk assign a call to that crew's truck.

- Working: the tone plays at full volume and keeps repeating until the crew
  presses the acknowledgement.
- Not working: silence, or a tone you can only hear with the volume up. The
  plugin is not registered, or the mp3 is not in the bundle under that exact
  name.

On iOS, also try it with Focus on. It will **not** sound — that is Apple's
limit, not a bug, and it is the one case worth telling crews about.

## Do not send the signing key

Everything here is source. The keystore that signs your Android build, and the
certificates that sign the iOS one, must never be pasted into a chat, committed
to this repository, or emailed. If the Android keystore is lost you can never
update the app again — a new key means a new listing.
