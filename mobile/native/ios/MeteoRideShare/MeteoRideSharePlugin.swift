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

    /// The scene delegate reads an incoming route on a background queue and has no
    /// other way to reach the live plugin, exactly as Android's activity does not.
    /// Weak, like Android's, which nils it in `handleOnDestroy`: a strong static would
    /// pin the plugin, its bridge and the web view past a scene teardown, and a stale
    /// non-nil instance would also defeat `missedAnnouncement` below — the announcement
    /// would go to a dead bridge and nothing would re-emit it.
    private weak static var instance: MeteoRideSharePlugin?
    /// A route can finish landing before the bridge has even built this plugin, which
    /// is not rare: the file arrives with the launch. The announcement is kept and made
    /// at `load`, or it would be dropped into a bridge nobody is listening to yet.
    private static var missedAnnouncement = false
    private static let announcementLock = NSLock()

    override public func load() {
        MeteoRideSharePlugin.announcementLock.lock()
        MeteoRideSharePlugin.instance = self
        let missed = MeteoRideSharePlugin.missedAnnouncement
        MeteoRideSharePlugin.missedAnnouncement = false
        MeteoRideSharePlugin.announcementLock.unlock()
        if missed { announce() }
    }

    /// Tells the web layer a route landed in the inbox. Safe from any thread, and
    /// retained until JavaScript is listening, so a route stored before the page added
    /// its listener is still announced.
    static func notifyRouteAvailable() {
        announcementLock.lock()
        let plugin = instance
        if plugin == nil { missedAnnouncement = true }
        announcementLock.unlock()
        plugin?.announce()
    }

    private func announce() {
        // `notifyListeners` walks `eventListeners` and `retainedEventArguments`, plain
        // NSMutableDictionaries with no locking of their own, and `addListener` mutates
        // them from the bridge's serial queue. This is now called from the intake
        // queue, so without the hop a route finishing while JavaScript is registering
        // its listener is a data race on a Foundation collection — and, more quietly, a
        // lost announcement when the retained-arguments flush and the append cross.
        // The queue is `CapacitorBridge.dispatchQueue`, which is what
        // `CapacitorBridge.swift:525` runs every plugin call on, `addListener`
        // included. It is not on `CAPBridgeProtocol`, hence the cast; main is the
        // fallback for a bridge that is not that class, which is better than racing.
        let queue = (bridge as? CapacitorBridge)?.dispatchQueue ?? DispatchQueue.main
        queue.async { [weak self] in
            self?.notifyListeners("sharedRouteAvailable", data: [:], retainUntilConsumed: true)
        }
    }

    /// Resolves with `{ name, gpx }`, or an empty object when the inbox is drained.
    @objc func consumePending(_ call: CAPPluginCall) {
        guard let item = MeteoRideShareStore.nextPending() else {
            call.resolve([:])
            return
        }
        call.resolve(["name": item.name, "gpx": item.text])
    }

    /// Reads handed to the intake queue and not yet finished. See `pendingCount`.
    private static var incoming = 0
    private static let incomingLock = NSLock()

    static func beginIncoming() {
        incomingLock.lock()
        incoming += 1
        incomingLock.unlock()
    }

    static func endIncoming() {
        incomingLock.lock()
        if incoming > 0 { incoming -= 1 }
        incomingLock.unlock()
    }

    /// `count` is what is waiting in the inbox; `incoming` is what is still being read.
    /// The web layer needs both: since the read moved off the main thread, a launch that
    /// carried a route has an empty inbox for as long as the read takes, and treating
    /// that as "nothing arrived" is what sends the map to the phone's position — and
    /// asks for the location permission — on the one launch where the user had already
    /// said what they wanted to see.
    @objc func pendingCount(_ call: CAPPluginCall) {
        MeteoRideSharePlugin.incomingLock.lock()
        let arriving = MeteoRideSharePlugin.incoming
        MeteoRideSharePlugin.incomingLock.unlock()
        call.resolve(["count": MeteoRideShareStore.pendingURLs().count, "incoming": arriving])
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
