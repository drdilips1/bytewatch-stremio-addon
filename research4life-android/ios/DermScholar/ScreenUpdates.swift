import Foundation
import CryptoKit

/// Newer screens (the web build published on GitHub Pages, research4life-android/web) are
/// downloaded in the background and used from the next launch, so most fixes arrive without
/// reinstalling. Only screens made for this app's native side are taken (minNative ≤
/// nativeLevel); if they don't start, the app goes back to the screens it was built with.
enum ScreenUpdates {
    /// What this native side can do. Raise it when the screens start using something new here
    /// (web/build.sh puts it in ota.json as minNative, and AltStore's source as dsNativeLevel):
    /// older apps then keep their screens and offer the reinstall instead.
    static let nativeLevel = 4
    static let site = "https://drdilips1.github.io/bytewatch-stremio-addon/dermscholar/"
    static let bundled = Bundle.main.url(forResource: "www", withExtension: nil)!
    private static let defaults = UserDefaults.standard

    private static var folder: URL {
        let u = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("screens", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }

    struct Manifest: Decodable {
        let id: String
        let built: Int
        let minNative: Int
        let files: [String: String]
    }

    static func manifest(at dir: URL) -> Manifest? {
        guard let d = try? Data(contentsOf: dir.appendingPathComponent("ota.json")) else { return nil }
        return try? JSONDecoder().decode(Manifest.self, from: d)
    }

    private static func usable(_ dir: URL) -> Manifest? {
        guard let m = manifest(at: dir), m.minNative <= nativeLevel,
              m.built > (manifest(at: bundled)?.built ?? 0),
              !(defaults.stringArray(forKey: "screens.bad") ?? []).contains(m.id),
              FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.html").path) else { return nil }
        return m
    }

    /// The screens to load: downloaded ones when newer than the built-in ones, else the built-in.
    static func root() -> URL {
        if let next = defaults.string(forKey: "screens.pending") {
            defaults.set(next, forKey: "screens.active")
            defaults.removeObject(forKey: "screens.pending")
        }
        guard let name = defaults.string(forKey: "screens.active") else { return bundled }
        let dir = folder.appendingPathComponent(name, isDirectory: true)
        return usable(dir) == nil ? bundled : dir
    }

    /// Downloaded screens that didn't start: never taken again.
    static func reject(_ dir: URL) {
        guard dir != bundled else { return }
        if let m = manifest(at: dir) {
            defaults.set((defaults.stringArray(forKey: "screens.bad") ?? []) + [m.id], forKey: "screens.bad")
        }
        defaults.removeObject(forKey: "screens.active")
    }

    /// Looks for newer screens and gets them ready for the next launch.
    static func check(current: URL) {
        Task.detached(priority: .background) { try? await download(current: current) }
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func download(current: URL) async throws {
        guard let url = URL(string: site + "ota.json?t=\(Int(Date().timeIntervalSince1970))") else { return }
        let (data, resp) = try await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData))
        guard (resp as? HTTPURLResponse)?.statusCode == 200 else { return }
        let m = try JSONDecoder().decode(Manifest.self, from: data)
        let have = max(manifest(at: current)?.built ?? 0, manifest(at: bundled)?.built ?? 0)
        guard m.minNative <= nativeLevel, m.built > have, !m.id.isEmpty, !m.id.contains("/"),
              !(defaults.stringArray(forKey: "screens.bad") ?? []).contains(m.id),
              defaults.string(forKey: "screens.pending") != m.id else { return }

        let fm = FileManager.default
        let final = folder.appendingPathComponent(m.id, isDirectory: true)
        let part = folder.appendingPathComponent(m.id + ".part", isDirectory: true)
        try? fm.removeItem(at: part)
        try fm.createDirectory(at: part, withIntermediateDirectories: true)
        for (path, hash) in m.files {
            guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("..") else { throw URLError(.badURL) }
            let target = part.appendingPathComponent(path)
            try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Unchanged files come from the screens already on the phone.
            var copied = false
            for base in [current, bundled] {
                let f = base.appendingPathComponent(path)
                if let d = try? Data(contentsOf: f), sha256(d) == hash {
                    try d.write(to: target)
                    copied = true
                    break
                }
            }
            if copied { continue }
            // ?v= skips a stale copy in GitHub's cache.
            let enc = path.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? path
            guard let fu = URL(string: site + enc + "?v=" + String(hash.prefix(12))) else { throw URLError(.badURL) }
            let (d, r) = try await URLSession.shared.data(for: URLRequest(url: fu, cachePolicy: .reloadIgnoringLocalCacheData))
            guard (r as? HTTPURLResponse)?.statusCode == 200, sha256(d) == hash else { throw URLError(.cannotDecodeContentData) }
            try d.write(to: target)
        }
        try data.write(to: part.appendingPathComponent("ota.json"))
        try? fm.removeItem(at: final)
        try fm.moveItem(at: part, to: final)
        defaults.set(m.id, forKey: "screens.pending")
        // Keep only what's in use and what's next.
        let keep: Set<String> = [m.id, current.lastPathComponent]
        for name in (try? fm.contentsOfDirectory(atPath: folder.path)) ?? [] where !keep.contains(name) {
            try? fm.removeItem(at: folder.appendingPathComponent(name))
        }
    }
}
