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

        // ADDED: the app was launched by opening a .gpx/.kml from another app.
        ingestIncoming(connectionOptions.urlContexts)

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // ADDED: the app was already running. This must come before the proxy call,
        // which is what emits appUrlOpen and tells the web layer to drain the inbox —
        // the route has to be in the inbox by then.
        ingestIncoming(URLContexts)

        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    // ADDED
    /// file:// URLs are routes opened from another app. meteoride:// is only the
    /// share extension waking us up and carries nothing to ingest.
    private func ingestIncoming(_ contexts: Set<UIOpenURLContext>) {
        for context in contexts where context.url.isFileURL {
            MeteoRideShareStore.ingest(fileURL: context.url)
        }
    }
}
