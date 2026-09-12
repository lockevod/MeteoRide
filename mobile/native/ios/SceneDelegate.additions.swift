//  Reference snippet — do NOT add this file to the Xcode target.
//
//  Capacitor 8 routes incoming URLs through ios/App/App/SceneDelegate.swift.
//  Edit that generated file and add the marked pieces, so routes opened with
//  "Open in MeteoRide" (Files, Mail, AirDrop, a Safari download) land in the same
//  inbox the share extension writes to.

func scene(_ scene: UIScene,
           willConnectTo session: UISceneSession,
           options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }

    window = UIWindow(windowScene: windowScene)
    window?.rootViewController = CAPBridgeViewController()
    window?.makeKeyAndVisible()

    // >>> ADD THIS LINE <<<  (the app was launched by opening a file)
    ingestIncoming(connectionOptions.urlContexts)

    SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
}

func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    // >>> ADD THIS LINE <<<  (the app was already running)
    ingestIncoming(URLContexts)

    // Keep Capacitor's own handling: it emits appUrlOpen, which is what tells the
    // web layer to drain the inbox.
    SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
}

// >>> ADD THIS METHOD <<<
/// file:// URLs are routes opened from another app. meteoride:// is only the share
/// extension waking us up and carries nothing to ingest.
private func ingestIncoming(_ contexts: Set<UIOpenURLContext>) {
    for context in contexts where context.url.isFileURL {
        MeteoRideShareStore.ingest(fileURL: context.url)
    }
}
