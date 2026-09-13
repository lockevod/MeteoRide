import UIKit
import UniformTypeIdentifiers

/// Share-sheet target: accepts a .gpx/.kml from any app, parks it in the App Group
/// inbox and brings MeteoRide to the front.
///
/// This replaces the iOS Shortcut + POST-to-Cloudflare handoff the web app needs:
/// the file never leaves the device.
class ShareViewController: UIViewController {

    /// Custom URL scheme declared by the main app.
    private let hostAppURL = URL(string: "meteoride://shared")!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        processAttachments()
    }

    private func processAttachments() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .compactMap { $0.attachments }
            .flatMap { $0 }

        guard !providers.isEmpty else { return finish(stored: 0) }

        let group = DispatchGroup()
        var stored = 0
        let lock = NSLock()

        for provider in providers {
            group.enter()
            load(provider) { ok in
                if ok { lock.lock(); stored += 1; lock.unlock() }
                group.leave()
            }
        }

        group.notify(queue: .main) { [weak self] in
            self?.finish(stored: stored)
        }
    }

    private func load(_ provider: NSItemProvider, completion: @escaping (Bool) -> Void) {
        let fileURLType = UTType.fileURL.identifier
        let dataType = UTType.data.identifier

        if provider.hasItemConformingToTypeIdentifier(fileURLType) {
            provider.loadItem(forTypeIdentifier: fileURLType, options: nil) { item, _ in
                guard let url = item as? URL else { return completion(false) }
                completion(MeteoRideShareStore.ingest(fileURL: url))
            }
            return
        }

        if provider.hasItemConformingToTypeIdentifier(dataType) {
            provider.loadItem(forTypeIdentifier: dataType, options: nil) { item, _ in
                if let url = item as? URL {
                    completion(MeteoRideShareStore.ingest(fileURL: url))
                } else if let data = item as? Data {
                    let name = provider.suggestedName ?? "route.gpx"
                    guard MeteoRideShareStore.accepts(name: name, data: data) else { return completion(false) }
                    completion(MeteoRideShareStore.store(data: data, suggestedName: name) != nil)
                } else {
                    completion(false)
                }
            }
            return
        }

        completion(false)
    }

    private func finish(stored: Int) {
        guard stored > 0 else {
            NSLog("[MeteoRide] share extension got nothing it could read")
            return complete()
        }
        openHostApp { [weak self] in self?.complete() }
    }

    private func complete() {
        extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }

    /// Brings MeteoRide to the front, then calls back.
    ///
    /// `NSExtensionContext.open` does not return whether it worked — it reports
    /// through a completion handler, and for a share extension it frequently reports
    /// failure, which is why the responder-chain fallback is here. The request must
    /// not be completed until this has finished: completing tears down the context
    /// and the view controller, and the open never happens.
    private func openHostApp(then done: @escaping () -> Void) {
        guard let context = extensionContext else {
            openViaResponderChain()
            return done()
        }
        context.open(hostAppURL) { [weak self] opened in
            DispatchQueue.main.async {
                if !opened { self?.openViaResponderChain() }
                done()
            }
        }
    }

    /// A share extension has no `UIApplication` of its own, so reach the hosting app
    /// through the responder chain. If this fails too, the route simply waits in the
    /// inbox and is picked up the next time MeteoRide opens.
    private func openViaResponderChain() {
        var responder: UIResponder? = self
        let selector = NSSelectorFromString("openURL:")
        while let current = responder {
            if current.responds(to: selector), !(current is ShareViewController) {
                current.perform(selector, with: hostAppURL)
                return
            }
            responder = current.next
        }
    }
}
