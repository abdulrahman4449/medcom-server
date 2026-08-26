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
 * For this file to be used at all, the view controller in Main.storyboard has
 * to have its custom class set to MainViewController. Adding the file without
 * that changes nothing — the storyboard would go on creating a plain
 * CAPBridgeViewController and this code would never run.
 */
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(PulseOpsAlarmPlugin())
    }
}
