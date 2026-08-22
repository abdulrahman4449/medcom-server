#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Capacitor needs the methods declared to Objective-C as well as written in
// Swift, or the JavaScript side calls into nothing.
CAP_PLUGIN(PulseOpsAlarmPlugin, "PulseOpsAlarm",
  CAP_PLUGIN_METHOD(alert, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(standby, CAPPluginReturnPromise);
)
