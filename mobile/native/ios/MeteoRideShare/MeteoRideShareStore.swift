import Foundation

/// Drop box for routes that arrive from outside the app.
///
/// Two producers write here: the share extension (a GPX shared from Files, Mail,
/// Komoot, Strava…) and the main app when another app opens a .gpx/.kml "in"
/// MeteoRide. The web layer drains it through `MeteoRideSharePlugin`.
///
/// This file must belong to BOTH targets: the app and the share extension.
enum MeteoRideShareStore {

    /// Must match the App Group enabled on both targets.
    static let appGroupId = "group.cc.meteoride.app"

    private static let folderName = "IncomingRoutes"
    private static let allowedExtensions: Set<String> = ["gpx", "kml"]

    /// Shared folder, created on first use. Nil means the App Group is misconfigured.
    static var inboxURL: URL? {
        let fm = FileManager.default
        guard let container = fm.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            NSLog("[MeteoRide] App Group \(appGroupId) unavailable — check entitlements")
            return nil
        }
        let dir = container.appendingPathComponent(folderName, isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    // MARK: - Writing

    /// Stores raw route bytes. Returns the stored file, or nil if it could not be saved.
    @discardableResult
    static func store(data: Data, suggestedName: String) -> URL? {
        guard let dir = inboxURL, !data.isEmpty else { return nil }
        let safeName = sanitize(suggestedName)
        // Timestamp prefix keeps arrival order and avoids collisions between shares.
        let fileName = "\(Int(Date().timeIntervalSince1970 * 1000))__\(safeName)"
        let dest = dir.appendingPathComponent(fileName)
        do {
            try data.write(to: dest, options: .atomic)
            return dest
        } catch {
            NSLog("[MeteoRide] could not store shared route: \(error.localizedDescription)")
            return nil
        }
    }

    /// Copies a file the system handed us (share sheet or "Open in…").
    @discardableResult
    static func ingest(fileURL: URL) -> Bool {
        let ext = fileURL.pathExtension.lowercased()
        guard allowedExtensions.contains(ext) else { return false }

        // Files coming from other apps may be security-scoped.
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }

        guard let data = try? Data(contentsOf: fileURL) else { return false }
        return store(data: data, suggestedName: fileURL.lastPathComponent) != nil
    }

    // MARK: - Reading

    static func pendingURLs() -> [URL] {
        guard let dir = inboxURL else { return [] }
        let items = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        return items.sorted().map { dir.appendingPathComponent($0) }
    }

    /// Returns the oldest pending route as text and removes it from the inbox.
    static func nextPending() -> (name: String, text: String)? {
        for url in pendingURLs() {
            defer { try? FileManager.default.removeItem(at: url) }
            guard let data = try? Data(contentsOf: url) else { continue }
            guard let text = decode(data), !text.isEmpty else { continue }
            return (displayName(of: url), text)
        }
        return nil
    }

    // MARK: - Helpers

    /// GPX is XML and normally UTF-8; some exporters still emit Latin-1.
    private static func decode(_ data: Data) -> String? {
        String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1)
    }

    /// Strips the timestamp prefix added by `store`.
    private static func displayName(of url: URL) -> String {
        let name = url.lastPathComponent
        guard let range = name.range(of: "__") else { return name }
        return String(name[range.upperBound...])
    }

    private static func sanitize(_ name: String) -> String {
        var base = name.isEmpty ? "route.gpx" : name
        base = base.replacingOccurrences(of: "/", with: "-")
        base = base.replacingOccurrences(of: ":", with: "-")
        if !allowedExtensions.contains((base as NSString).pathExtension.lowercased()) {
            base += ".gpx"
        }
        return String(base.suffix(120))
    }
}
