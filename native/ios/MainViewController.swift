import Capacitor

/**
 * Where the alarm plugin is registered on iOS.
 *
 * This is the counterpart to `registerPlugin(PulseOpsAlarmPlugin.class)` in
 * Android's MainActivity, and leaving it out is why the plugin was never there.
 *
 * Capacitor discovers plugins that arrive as packages — anything with its own
 * Package.swift or podspec announces itself and is loaded automatically. A
 * plugin class that lives in the app target does not: nothing scans the app for
 * it, so `CAPBridgedPlugin` conformance alone is not enough. The class
 * compiles, ships, is never instantiated, `load()` never runs, and
 * `window.Capacitor.Plugins.PulseOpsAlarm` does not exist. No error anywhere.
 *
 * `capacitorDidLoad` is the hook that runs once the bridge exists and before
 * the web layer starts asking for plugins, which is the only window where this
 * can be done.
 *
 * For this file to be used at all, SOMETHING has to construct it. On
 * Capacitor 8 that is `SceneDelegate.swift`, which builds the screen in code —
 * `Main.storyboard` is never used, so setting a custom class on the storyboard
 * changes nothing. Check which applies with
 * `grep -rn CAPBridgeViewController ios/App/App/*.swift` rather than assuming.
 *
 * EVERY plugin that lives in the app target is registered here. One missing
 * line is one plugin the web layer can never see, with no error anywhere.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PulseOpsAlarmPlugin())
        bridge?.registerPluginInstance(PulseOpsPushPlugin())
    }
}
