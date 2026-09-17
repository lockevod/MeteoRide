//  Drop-in replacement for ios/App/App/SceneDelegate.swift.
//
//  This is the file Capacitor 8.5.2 generates, plus the three pieces MeteoRide
//  needs, each marked below. Copy it over the generated one. If a future Capacitor
//  version generates something different, do not copy it wholesale — apply the
//  three marked pieces to whatever the new template says.
//
//  Do NOT add this file to the Xcode target: it would collide with the real one.

import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // CHANGED (was CAPBridgeViewController): MeteoRideViewController registers the
        // MeteoRideShare plugin. Capacitor only auto-registers plugins that come from
        // npm packages, and it rebuilds that list on every `cap sync`, so a plugin
        // living in the app target has to register itself. Put the stock class back
        // and the share flow silently does nothing.
        window?.rootViewController = MeteoRideViewController()
        window?.makeKeyAndVisible()

        // ADDED: the app was launched by opening a .gpx/.kml from another app. Reads
        // on a background queue and announces itself when done; see ingestIncoming.
        ingestIncoming(connectionOptions.urlContexts)

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // ADDED: the app was already running.
        ingestIncoming(URLContexts)

        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // ADDED
    /// Reading a route takes as long as the provider takes, and the reader accepts up
    /// to 25 MiB: a large file, or one iCloud still has to fetch, would block the
    /// launch or the resume for as long as it takes, which is what a watchdog
    /// termination is made of. Both callers above are scene callbacks on the main
    /// thread, so the read runs on its own serial queue instead.
    ///
    /// The cost of that is ordering. This used to finish before
    /// `SceneDelegateProxy` emitted `appUrlOpen`, so the drain that event triggers was
    /// certain to find the route already in the inbox; now that drain usually runs
    /// first and finds nothing. What brings the route in is the announcement below,
    /// once the bytes are actually stored — the same way Android has always done it,
    /// through the same `sharedRouteAvailable` listener in `native.js`, and retained
    /// until JavaScript is listening. Do not "fix" the ordering by making this
    /// synchronous again.
    ///
    /// file:// URLs are routes opened from another app. meteoride:// is only the share
    /// extension waking us up and carries nothing to ingest.
    private func ingestIncoming(_ contexts: Set<UIOpenURLContext>) {
        let urls = contexts.map(\.url).filter(\.isFileURL)
        guard !urls.isEmpty else { return }
        // Counted here, on the main thread, before the queue is handed anything: the web
        // layer asks whether a read is in flight to decide that this launch carried a
        // route, and by the time the queue starts it would already be too late to say so.
        MeteoRideSharePlugin.beginIncoming()
        SceneDelegate.intake.async {
            defer { MeteoRideSharePlugin.endIncoming() }
            // Announced per file, not once at the end: two URLs arrive together, the
            // first stores in milliseconds and the second is an iCloud file that takes
            // seconds, and announcing after the loop would leave a route sitting in the
            // inbox, already readable, until some later activation happened to drain it.
            // The web layer coalesces the events itself — `consumePendingShare` refuses
            // to run twice at once and repeats instead.
            for url in urls where MeteoRideShareStore.ingest(fileURL: url) {
                MeteoRideSharePlugin.notifyRouteAvailable()
            }
        }
    }

    // ADDED
    /// Serial: two routes opened at once are read one after the other, as on Android,
    /// so the 25 MiB ceiling is a ceiling on this app's memory and not a multiple of it.
    private static let intake = DispatchQueue(label: "cc.meteoride.app.intake", qos: .userInitiated)
}
