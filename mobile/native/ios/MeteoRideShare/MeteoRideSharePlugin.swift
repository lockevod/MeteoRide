import Capacitor
import Foundation

/// Bridges the shared-route inbox to the web layer.
///
/// `scripts/native.js` calls `Capacitor.Plugins.MeteoRideShare.consumePending()`
/// at launch, on every `appUrlOpen`, and whenever the app becomes active.
///
/// This file belongs to the app target only.
@objc(MeteoRideSharePlugin)
public class MeteoRideSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeteoRideSharePlugin"
    public let jsName = "MeteoRideShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "consumePending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingCount", returnType: CAPPluginReturnPromise)
    ]

    /// Resolves with `{ name, gpx }`, or an empty object when the inbox is drained.
    @objc func consumePending(_ call: CAPPluginCall) {
        guard let item = MeteoRideShareStore.nextPending() else {
            call.resolve([:])
            return
        }
        call.resolve(["name": item.name, "gpx": item.text])
    }

    @objc func pendingCount(_ call: CAPPluginCall) {
        call.resolve(["count": MeteoRideShareStore.pendingURLs().count])
    }
}
