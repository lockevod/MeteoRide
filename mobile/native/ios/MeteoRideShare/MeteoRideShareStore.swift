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
    private static let maxBytes = 25 * 1024 * 1024
    private static let maxAge: TimeInterval = 24 * 60 * 60

    // Two shares can land in the same millisecond; this tells their file names apart.
    private static var sequenceCounter = 0
    private static let sequenceLock = NSLock()
    private static func nextSequence() -> Int {
        sequenceLock.lock()
        defer { sequenceLock.unlock() }
        sequenceCounter += 1
        return sequenceCounter
    }

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
        guard let dir = inboxURL, !data.isEmpty, data.count <= maxBytes else { return nil }
        let millis = Int64(Date().timeIntervalSince1970 * 1000)
        let fileName = inboxFileName(millis: millis, sequence: nextSequence(), name: suggestedName)
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
        // Only local files. `Data(contentsOf:)` happily accepts an https URL and
        // performs a blocking, untimed network download, and the share sheet hands
        // over a web URL whenever someone shares a link from Strava, Komoot or a
        // browser. Sharing a link is not a supported way to open a route.
        guard fileURL.isFileURL else {
            NSLog("[MeteoRide] ignoring shared web URL: \(fileURL.scheme ?? "?")")
            return false
        }

        // Files coming from other apps may be security-scoped.
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }

        guard let data = readCapped(fileURL) else { return false }
        return accepts(name: fileURL.lastPathComponent, data: data)
            && store(data: data, suggestedName: fileURL.lastPathComponent) != nil
    }

    /// Reads at most `maxBytes`, giving up as soon as the file turns out to be bigger.
    /// `Data(contentsOf:)` would load all of it first, and the share extension has a
    /// small memory budget.
    static func readCapped(_ fileURL: URL) -> Data? {
        guard let stream = InputStream(url: fileURL) else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 64 * 1024)
        while true {
            let read = stream.read(&buffer, maxLength: buffer.count)
            if read < 0 { return nil }
            if read == 0 { return data }
            data.append(buffer, count: read)
            if data.count > maxBytes {
                NSLog("[MeteoRide] ignoring shared file larger than \(maxBytes) bytes")
                return nil
            }
        }
    }

    /// Apps share routes with all sorts of types and names, so judge by the file name
    /// or, failing that, by what is actually inside. Mirrors the Android side.
    static func accepts(name: String, data: Data) -> Bool {
        guard !data.isEmpty, data.count <= maxBytes else { return false }
        if allowedExtensions.contains((name as NSString).pathExtension.lowercased()) { return true }
        let head = data.prefix(2048)
        guard let start = String(data: head, encoding: .utf8)?.lowercased()
            ?? String(data: head, encoding: .isoLatin1)?.lowercased() else { return false }
        return start.contains("<gpx") || start.contains("<kml")
    }

    // MARK: - Reading

    static func pendingURLs() -> [URL] {
        guard let dir = inboxURL else { return [] }
        prune(in: dir)
        let items = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        // `.atomic` writes leave a `<name>.sb-XXXX` temp file in the same directory
        // for the instant of the rename; excluding anything that is not a finished
        // inbox name keeps that temp file from being read and deleted as if it were
        // a real, complete route.
        return items.filter(isInboxName).sorted().map { dir.appendingPathComponent($0) }
    }

    /// A route shared while the web layer never got to run would sit here forever.
    private static func prune(in dir: URL) {
        let fm = FileManager.default
        let items = (try? fm.contentsOfDirectory(atPath: dir.path)) ?? []
        for item in items {
            let url = dir.appendingPathComponent(item)
            guard let modified = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { continue }
            if Date().timeIntervalSince(modified) > maxAge { try? fm.removeItem(at: url) }
        }
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

    /// Timestamp+sequence file name: unique across shares, sorts in arrival order.
    /// Mirrors the Android side's `%013d-%04d__name` format.
    static func inboxFileName(millis: Int64, sequence: Int, name: String) -> String {
        // %d reads a 32-bit int and would truncate a 13-digit millisecond
        // timestamp; %lld/%ld match the actual 64-bit argument width.
        String(format: "%013lld-%04ld__%@", millis, sequence % 10000, sanitize(name))
    }

    /// A finished inbox entry, as opposed to an `.atomic` write's transient
    /// `<name>.sb-XXXX` sibling or unrelated junk (e.g. `.DS_Store`).
    static func isInboxName(_ name: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: "^\\d{13}-\\d{4}__.+\\.(gpx|kml)$") else { return false }
        let range = NSRange(name.startIndex..<name.endIndex, in: name)
        return regex.firstMatch(in: name, range: range) != nil
    }

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
