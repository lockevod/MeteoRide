import Capacitor
import Foundation
import UIKit

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
        CAPPluginMethod(name: "pendingCount", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backgroundRefreshStatus", returnType: CAPPluginReturnPromise)
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

    /// Whether iOS will run the ride-watch background task at all. Background App
    /// Refresh can be off for the app or for the whole device (and is off under
    /// parental restrictions); with it off the watch never runs and nothing says
    /// so, hence this. Resolves `{ status: "available" | "denied" | "restricted" }`.
    @objc func backgroundRefreshStatus(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let status: String
            switch UIApplication.shared.backgroundRefreshStatus {
            case .available: status = "available"
            case .denied: status = "denied"
            case .restricted: status = "restricted"
            @unknown default: status = "available"
            }
            call.resolve(["status": status])
        }
    }
}
