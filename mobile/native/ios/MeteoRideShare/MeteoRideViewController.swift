import Capacitor
import UIKit

/// Hosts the web view and registers the app's own plugin.
///
/// Capacitor only auto-registers plugins listed in the generated
/// `capacitor.config.json`, and that list is rebuilt from the installed npm packages
/// on every `cap sync` — a plugin that lives in the app target never appears in it.
/// `capacitorDidLoad` runs after the bridge exists and before the web view loads,
/// which is the one moment the registration can still be picked up.
///
/// This file belongs to the app target only. `SceneDelegate` must instantiate this
/// class instead of `CAPBridgeViewController`.
class MeteoRideViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MeteoRideSharePlugin())
    }
}
