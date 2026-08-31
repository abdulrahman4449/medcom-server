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
| Keeps the app awake in the background | partly — `keepAwake` holds the screen on | yes (`standby`) |
| Reports why this handset is silent | yes (`backgroundStatus`) | — |
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

1. Copy `android/PulseOpsAlarmPlugin.java` into the folder your
   `MainActivity.java` already lives in — `android/app/src/main/java/com/PulseOps/`
   on this project.

   **Then make the `package` line on line 1 identical to the one at the top of
   `MainActivity.java`.** Java requires the package statement to match the
   folder, and Android Studio stops the build on the mismatch before it looks at
   anything else: *"Package name 'x' does not correspond to the file path 'y'"*.
   It is the first thing to check and the easiest to miss.
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
4. `minSdk` may be anything from 24 up. Channels, `VibrationEffect`,
   `AudioFocusRequest` and the channel-settings intents all arrived in API 26,
   so every one of them is behind a `Build.VERSION.SDK_INT` check with a
   working path for 24 and 25 — do not remove those branches to tidy the file
   up unless you also raise `minSdk`.
5. Add to `AndroidManifest.xml`, inside `<manifest>`:

   ```xml
   <uses-permission android:name="android.permission.VIBRATE" />
   ```

   Nothing else. In particular **do not** add
   `ACCESS_BACKGROUND_LOCATION` — that triggers Google's Location Permissions
   declaration review, which this app's whole location design exists to avoid.
6. Rebuild the AAB and reinstall.

## "Sometimes it works, sometimes it's late, sometimes it doesn't"

That exact triad has one main cause and four smaller ones, and none of them is
the alarm code. When the alarm is reached it plays; the problem is that on
Android it is often never reached.

**The main cause: a backgrounded WebView stops reading the board.**

The board is polled every three seconds by a timer inside the WebView. Android
throttles a backgrounded WebView's timers to roughly one a second, then to one
a minute, and after a few minutes freezes the page outright. A frozen page runs
no timer, makes no request, and never learns a call was raised — so there is
nothing for any alarm to sound about. Doze and each manufacturer's own battery
saver (Samsung, Xiaomi and Huawei are the aggressive ones) decide which of
those states a given handset lands in, which is precisely why one tablet gets
the call instantly, the next one a minute late, and the third not at all.

`keepAwake` is the answer that costs nothing: while somebody is signed on, the
app holds `FLAG_KEEP_SCREEN_ON`. A screen that stays on is a page that is never
backgrounded, so the poll keeps running at three seconds and the alarm is on
time. No permission, nothing declared to Google, released the moment the crew
signs out. It costs battery, which is the right trade for a tablet in a cradle
on a charger.

**It does not survive Home being pressed or the tablet being locked.** Nothing a
web layer can do does. See "Going further" below.

**The four smaller ones**, each of which silences the alert on its own, each set
by somebody long ago on one handset and not the next, and none of which the app
is allowed to change on the owner's behalf:

| What | What it does | Where it shows |
|---|---|---|
| Notifications turned off for the app | no banner at all | `notificationsEnabled` |
| The alert channel silenced by its owner | banner arrives mute — **Android will not let the app undo this** | `channelSilenced` |
| The alarm stream at zero | the tone plays on the right stream, into silence | `alarmVolumePct` |
| Battery optimisation on | the app is frozen in the background | `batteryOptimised` |

`backgroundStatus()` reads all four, and the crew screen shows them under the
speaker check with a **Fix it** button that opens the exact settings page. Ask
for that line before diagnosing "no tone" — it is the difference between four
possible faults and one named one.

Two of these the plugin now handles itself rather than reporting:

- **The alarm volume is raised** to 70% of the handset's maximum for the length
  of an alert and put back by `stop()`, so a tablet handed over with the alarm
  slider at zero still makes a noise. Do Not Disturb can refuse this; that is
  what the reported percentage is for.
- **Audio focus is requested**, so navigation and music duck out of the way. A
  truck with Maps running is the normal case, and an alert underneath a
  turn-by-turn instruction is one a crew can miss.

**And one that was silently permanent.** A notification channel is created once
and is then the *user's*: Android refuses to change its importance, its sound or
its DND bypass afterwards, for ever. A phone that installed an early build — or
whose owner once swiped an alert away and chose "turn off notifications like
this" — kept a silent channel that reinstalling did not fix, while the phone
beside it was fine. The channel id now carries a version (`pulseops_dispatch_v2`)
and the old one is deleted on the way past, so this build hands every handset a
correct channel. **Bump that number whenever the sound, the importance or the
bypass changes** — it is the only way to hand somebody a corrected channel.

## Going further: the two things that would cover a locked phone

**Push (FCM) is now built — see the next section.** The foreground-service
alternative is kept here so the choice stays on record: a persistent
notification and a process the system will not freeze would also work, but
from Android 14 it needs a declared `foregroundServiceType` and **a Google
Play justification form**, burns battery all shift, and still dies with a
force-quit. FCM covers more and declares nothing, which is why it is the one
that got built.

## Push (FCM) — waking the locked phone

The whole path is in the repo: the server watches every board write and, the
moment a call lands on a truck, sends a HIGH-priority FCM message to the
phones signed on to that truck. The message carries the dispatch channel's id
(`pulseops_dispatch_v2`), so **Android itself** shows it with the channel's
sound — alarm stream, through silent, phone locked, dozing, or the app swiped
away — with no app code running. The web layer registers this phone's token
against the truck at sign-on and takes it back at sign-out
(`src/lib/push.jsx`); the server side is `lib/push-triggers.cjs` (what fires,
under `npm test`) and `lib/push-fcm.cjs` (the send, dependency-free).

**Privacy is part of the design: the push names no patient.** It says "NEW
CALL — open the app and acknowledge" and nothing else. It travels through
Google and sits on a lock screen; an MRN in either place is a disclosure.

### One-time setup

**Firebase (free, ~10 minutes):**
1. console.firebase.google.com → Add project (name it anything; Analytics off).
2. Add an **Android app** with your applicationId (open `android/app/build.gradle`
   and copy it exactly). Download **google-services.json** into `android/app/`.
3. Project settings → Service accounts → **Generate new private key**. This
   JSON is a server credential — treat it like `AUTH_SECRET`, never commit it.

**Render:** add an environment variable `FIREBASE_SERVICE_ACCOUNT` and paste
the service-account JSON in whole. Redeploy. Without it every push path is a
no-op and nothing else changes.

**Android project:**
1. Copy `PulseOpsPushPlugin.java` and `PulseOpsPushService.java` from this
   folder next to the alarm plugin, fixing the `package` line the same way.
2. In `MainActivity.java`, beside the existing line:
   `registerPlugin(PulseOpsPushPlugin.class);`
3. Root `build.gradle`, inside `buildscript { dependencies { … } }`:
   `classpath 'com.google.gms:google-services:4.4.2'`
4. `android/app/build.gradle`: at the very bottom add
   `apply plugin: 'com.google.gms.google-services'`
   and inside `dependencies { … }`:
   `implementation platform('com.google.firebase:firebase-bom:33.7.0')`
   `implementation 'com.google.firebase:firebase-messaging'`
5. `AndroidManifest.xml`, inside `<application>`:
   ```xml
   <service
       android:name=".PulseOpsPushService"
       android:exported="false">
       <intent-filter>
           <action android:name="com.google.firebase.MESSAGING_EVENT" />
       </intent-filter>
   </service>
   ```
6. Rebuild, reinstall, sign a crew member on to a truck once (that registers
   the token), then lock the phone, leave it untouched, and raise a call for
   that truck from the desk. It should sound within a few seconds.

**What it still cannot do:** nothing reaches a phone whose owner force-stopped
the app from system settings (rare — a swipe-away is fine), turned the
channel's notifications off, or has no Google services. `BackgroundAlertNotice`
already names the notification settings; the rest is the truth to tell crews.

**iOS is deliberately not wired.** APNs needs a paid Apple developer account,
and getting past the silent switch needs the Critical Alerts entitlement on
top. The day the account exists, the server half here is reusable — an `apns`
block beside the `android` one — and the shell needs a real push
registration; until then an iPhone's story is unchanged.

## Capacitor 6 and later: the registration that is easy to miss

`PulseOpsAlarmPlugin.swift` conforms to **`CAPBridgedPlugin`** as well as
`CAPPlugin`, and it must. Up to Capacitor 5 the `CAP_PLUGIN` macro in the `.m`
file was what registered a plugin. From Capacitor 6 that route is gone: a class
conforming only to `CAPPlugin` compiles, ships, and is never loaded, so
`window.Capacitor.Plugins.PulseOpsAlarm` does not exist and every call into it
silently does nothing.

There is no build error and no crash — just an app with no alarm path, no
banner, and a fallback to page audio that iOS may already have interrupted.

**A plugin in the app target must be registered by hand.** Capacitor discovers
plugins that arrive as packages — anything with its own `Package.swift` or
podspec announces itself. A class sitting in the app target does not, so the
`CAPBridgedPlugin` conformance alone is not enough: nothing ever instantiates
it, `load()` never runs, and `window.Capacitor.Plugins.PulseOpsAlarm` does not
exist. This is the exact counterpart of `registerPlugin(...)` in Android's
`MainActivity`, and it is what `MainViewController.swift` is for:

```swift
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PulseOpsAlarmPlugin())
    }
}
```

**The file does nothing on its own — something has to actually use the class.**
Where that is depends on how your Capacitor version builds the first screen, and
it is worth checking rather than assuming:

```
grep -rn "CAPBridgeViewController" ios/App/App/*.swift
```

- **`SceneDelegate.swift` contains `window?.rootViewController =
  CAPBridgeViewController()`** — the screen is built in code and
  `Main.storyboard` is never used. Change that one line to
  `MainViewController()`. This is the case on Capacitor 8.
- **No such line** — the screen comes from the storyboard. Open
  `Main.storyboard`, select the view controller, and in the Identity inspector
  (⌥⌘4) set **Class** to `MainViewController`.

Getting this wrong is silent in both directions: the class exists, the app runs,
and the plugin is simply never registered.

**There is no `.m` file any more, and there must not be one.** The two
mechanisms do not sit side by side: the macro registers the same plugin a second
way, and Capacitor's own migration to 6 says to delete the file. If an old
`PulseOpsAlarmPlugin.m` is still in the Xcode project, remove it — right-click
it in the navigator, Delete, **Move to Trash**.

Any method added to the plugin has to be listed in `pluginMethods` as well as
written. One without the other is a method the web layer can never call.

**Is it actually loaded?** On launch the plugin prints to the Xcode console:

```
PulseOpsAlarm: plugin loaded and registered as PulseOpsAlarm
```

If that line is absent, the class is not being registered and nothing else in
the file can run — check that both it is in **Build Phases → Compile Sources**
and that no `.m` file remains. If the line is present but the app still reports
the plugin missing, the mismatch is in `jsName`.

Your Capacitor version is in `node_modules/@capacitor/core/package.json` — the
podspec does not carry one of its own, it reads it from there.

## Installing — iOS

1. Copy `ios/PulseOpsAlarmPlugin.swift` **and `ios/MainViewController.swift`**
   into `ios/App/App/` and add both to the App target in Xcode. There is no
   `.m` file; if an old one is still in the project, delete it. Then set the
   storyboard's view controller class to `MainViewController` — see above.
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

## Notifications — the banner an iPhone never got

Neither shell has a Web `Notification` API. Not "it needs permission" — the
object does not exist. So `notifyAssignedCall` returned on its first line on
every phone, and a crew who was not looking at the screen when a call landed was
told nothing at all. The full-screen alarm only exists inside the app.

Both plugins now raise one through the operating system instead:

- **iOS** — `UNUserNotificationCenter`, with iOS's own sound and vibration. It
  is marked Time Sensitive, which gets past a Focus **if** the build carries
  that entitlement and is ignored otherwise, so nothing depends on it.
- **Android** — posted on the existing `USAGE_ALARM` channel, so it sounds
  through a silenced phone the way the tone does.

Permission is asked at sign-in and again when a restored session loads — a
tablet that comes back from a refresh never sees the sign-in screen, and asking
only there left exactly the long-running devices this matters most on without
it. Both platforms only ever prompt once.

**Android 13 and later** also need this in `AndroidManifest.xml`, or the banner
is posted and never shown:

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

**This is a local notification, not a push.** It needs the app to be running —
which, while somebody is on duty, standby now keeps it doing. A force-quit app
cannot be reached by this or by anything else short of APNs and a paid Apple
developer account.

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
