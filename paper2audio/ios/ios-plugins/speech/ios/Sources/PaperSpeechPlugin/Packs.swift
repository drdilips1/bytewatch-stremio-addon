import Foundation
import ZIPFoundation

/// The voice packs, downloaded once from the same place as on Android (the app's own GitHub release,
/// a zip in parts), then kept on the phone: Documents/voices/<folder>.
final class Packs {
    static let shared = Packs()
    private let mirror = "https://github.com/drdilips1/bytewatch-stremio-addon/releases/download/p2a-voices"
    private let queue = DispatchQueue(label: "p2a.packs")
    private var running: Set<String> = []

    var root: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("voices", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func dir(_ p: VoiceCatalog.Pack) -> URL { root.appendingPathComponent(p.folder, isDirectory: true) }
    func file(_ p: VoiceCatalog.Pack, _ name: String) -> String { dir(p).appendingPathComponent(name).path }
    func isInstalled(_ p: VoiceCatalog.Pack) -> Bool {
        FileManager.default.fileExists(atPath: dir(p).appendingPathComponent(".installed").path)
    }
    func isDownloading(_ p: VoiceCatalog.Pack) -> Bool { queue.sync { running.contains(p.key) } }

    /// Downloads and unpacks [p]; [progress] gets 0–100 and a message; [done] nil on success, else the reason.
    func install(_ p: VoiceCatalog.Pack, progress: @escaping (Int, String) -> Void, done: @escaping (String?) -> Void) {
        let started: Bool = queue.sync {
            if running.contains(p.key) { return false }
            running.insert(p.key)
            return true
        }
        guard started else { return }
        DispatchQueue.global(qos: .userInitiated).async {
            let error = self.run(p, progress: progress)
            self.queue.sync { _ = self.running.remove(p.key) }
            done(error)
        }
    }

    private struct Part: Decodable {
        let name: String
        let size: Int64
    }
    private struct Manifest: Decodable { let parts: [Part] }

    private func fetch(_ url: URL) throws -> Data {
        var result: Result<Data, Error> = .failure(URLError(.unknown))
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error { result = .failure(error) }
            else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                result = .failure(NSError(domain: "p2a", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode)"]))
            } else { result = .success(data ?? Data()) }
            sem.signal()
        }.resume()
        sem.wait()
        return try result.get()
    }

    /// Downloads one part to a temporary file (no whole part held in memory).
    private func download(_ url: URL) throws -> URL {
        var result: Result<URL, Error> = .failure(URLError(.unknown))
        let sem = DispatchSemaphore(value: 0)
        URLSession.shared.downloadTask(with: url) { tmp, response, error in
            if let error = error { result = .failure(error) }
            else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                result = .failure(NSError(domain: "p2a", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "HTTP \(http.statusCode)"]))
            } else if let tmp = tmp {
                // The temporary file is removed when this returns: keep it.
                let keep = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
                do {
                    try FileManager.default.moveItem(at: tmp, to: keep)
                    result = .success(keep)
                } catch { result = .failure(error) }
            }
            sem.signal()
        }.resume()
        sem.wait()
        return try result.get()
    }

    private func run(_ p: VoiceCatalog.Pack, progress: (Int, String) -> Void) -> String? {
        let fm = FileManager.default
        let zip = root.appendingPathComponent(p.folder + ".zip.part")
        do {
            progress(0, "Starting download…")
            guard let manifestUrl = URL(string: "\(mirror)/\(p.folder).json") else { return "Bad address" }
            let manifest = try JSONDecoder().decode(Manifest.self, from: try fetch(manifestUrl))
            let total = max(1, manifest.parts.reduce(0) { $0 + $1.size })
            try? fm.removeItem(at: zip)
            fm.createFile(atPath: zip.path, contents: nil)
            let out = try FileHandle(forWritingTo: zip)
            var have: Int64 = 0
            for (i, part) in manifest.parts.enumerated() {
                progress(Int(have * 90 / total), "Downloading \(p.title)… part \(i + 1) of \(manifest.parts.count), \(have / 1_000_000) of \(total / 1_000_000) MB")
                guard let url = URL(string: "\(mirror)/\(part.name)") else { continue }
                let tmp = try download(url)
                let input = try FileHandle(forReadingFrom: tmp)
                while true {
                    let chunk = input.readData(ofLength: 4 << 20)
                    if chunk.isEmpty { break }
                    out.write(chunk)
                    have += Int64(chunk.count)
                }
                input.closeFile()
                try? fm.removeItem(at: tmp)
            }
            out.closeFile()

            progress(92, "Unpacking \(p.title)…")
            let dest = dir(p)
            try? fm.removeItem(at: dest)
            try fm.createDirectory(at: dest, withIntermediateDirectories: true)
            let archive = try Archive(url: zip, accessMode: .read)
            for entry in archive {
                var rel = entry.path
                if rel.hasPrefix("./") { rel = String(rel.dropFirst(2)) }
                if rel.isEmpty || rel.split(separator: "/").contains("..") || rel.hasPrefix("test_wavs/") ||
                    rel.hasPrefix("dict/") || rel.hasSuffix(".fst") || rel == "lexicon-zh.txt" { continue }
                let target = dest.appendingPathComponent(rel)
                if entry.type == .directory {
                    try fm.createDirectory(at: target, withIntermediateDirectories: true)
                    continue
                }
                try fm.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try? fm.removeItem(at: target)
                _ = try archive.extract(entry, to: target)
            }
            for name in p.required where !fm.fileExists(atPath: dest.appendingPathComponent(name).path) {
                return "The download was incomplete (\(name) missing). Please try again."
            }
            fm.createFile(atPath: dest.appendingPathComponent(".installed").path, contents: Data())
            try? fm.removeItem(at: zip)
            // Not backed up to iCloud: it can always be downloaded again.
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var d = root
            try? d.setResourceValues(values)
            progress(100, "\(p.title) ready")
            return nil
        } catch {
            return "Couldn't download \(p.title): \(error.localizedDescription)"
        }
    }
}
