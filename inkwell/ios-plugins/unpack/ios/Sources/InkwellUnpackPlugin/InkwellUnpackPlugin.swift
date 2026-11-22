import Foundation
import Capacitor
import ZIPFoundation
import Unrar

/**
 * A Mobilism topic's files on iPhone, unpacked so they play: the same unpack() as the Android
 * InkwellDownloads plugin.
 *   unpack({ urls: [], names: [], folder, job }) → { files: [{ uri, name, size }], folder }
 *   events "unpackProgress" { job, phase: "download" | "unpack", got, total, part, parts }
 * .zip by ZIPFoundation; .rar (RAR 4 and RAR 5, split .partN.rar / .r00) by RARLAB's unrar.
 * Kept in Application Support/Unpacked (not Documents, which the app reads as "your own files",
 * so the book isn't listed twice).
 */
@objc(InkwellUnpackPlugin)
public class InkwellUnpackPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkwellUnpackPlugin"
    public let jsName = "InkwellUnpack"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "unpack", returnType: CAPPluginReturnPromise)
    ]

    private let work = DispatchQueue(label: "app.audiohub.unpack")
    private static let keep = try! NSRegularExpression(pattern: "\\.(mp3|m4b|m4a|aac|ogg|oga|opus|flac|wav|wma|jpe?g|png)$", options: .caseInsensitive)
    private static func keeps(_ name: String) -> Bool {
        keep.firstMatch(in: name, range: NSRange(name.startIndex..., in: name)) != nil
    }
    private static func safe(_ s: String) -> String {
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|")
        return s.components(separatedBy: bad).joined(separator: " ").trimmingCharacters(in: .whitespaces)
    }

    @objc func unpack(_ call: CAPPluginCall) {
        let urls = (call.getArray("urls") ?? []).compactMap { $0 as? String }
        let names = (call.getArray("names") ?? []).compactMap { $0 as? String }
        let folderName = Self.safe(call.getString("folder") ?? "Audiobook")
        let job = call.getString("job") ?? ""
        if urls.isEmpty { return call.reject("Nothing to unpack") }
        work.async {
            let fm = FileManager.default
            let temp = fm.temporaryDirectory.appendingPathComponent("unpack-\(Int(Date().timeIntervalSince1970 * 1000))", isDirectory: true)
            defer { try? fm.removeItem(at: temp) }
            do {
                try fm.createDirectory(at: temp, withIntermediateDirectories: true)
                // 1. Every part, downloaded (with progress).
                var got: [URL] = []
                for (i, u) in urls.enumerated() {
                    guard let url = URL(string: u) else { throw Failure("a link isn't valid") }
                    let name = Self.safe(names.count > i ? names[i] : "part\(i + 1)")
                    let dest = temp.appendingPathComponent(name.isEmpty ? "part\(i + 1)" : name)
                    try self.fetch(url, to: dest, job: job, part: i, parts: urls.count)
                    got.append(dest)
                }
                // 2. Unpacked into the book's own folder.
                let support = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let out = support.appendingPathComponent("Unpacked", isDirectory: true).appendingPathComponent(folderName.isEmpty ? "Audiobook" : folderName, isDirectory: true)
                try fm.createDirectory(at: out, withIntermediateDirectories: true)
                self.note(job, "unpack", 0, 0, 0, 1)
                var files: [URL] = []
                for f in got {
                    let n = f.lastPathComponent.lowercased()
                    if Self.keeps(n) {
                        // An audio file that came as it is.
                        let to = out.appendingPathComponent(f.lastPathComponent)
                        try? fm.removeItem(at: to)
                        try fm.moveItem(at: f, to: to)
                        files.append(to)
                    } else if n.hasSuffix(".zip") {
                        files += try self.unzip(f, into: out)
                    } else if n.hasSuffix(".rar") {
                        // A split .rar is read from its first part (the others are found next to it).
                        let part = n.range(of: "\\.part(\\d+)\\.rar$", options: .regularExpression)
                        if part == nil || n.range(of: "\\.part0*1\\.rar$", options: .regularExpression) != nil {
                            files += try self.unrar(f, into: out)
                        }
                    }
                }
                let audio = files.filter { Self.keeps($0.lastPathComponent) && !$0.lastPathComponent.lowercased().hasSuffix(".jpg") && !$0.lastPathComponent.lowercased().hasSuffix(".jpeg") && !$0.lastPathComponent.lowercased().hasSuffix(".png") }
                if audio.isEmpty { throw Failure("no audio files inside") }
                let list: [[String: Any]] = files.map { url in
                    let size = (try? fm.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
                    return ["uri": url.absoluteString, "name": url.lastPathComponent, "size": size]
                }
                call.resolve(["files": list, "folder": out.path])
            } catch let f as Failure {
                call.reject("Couldn't unpack: \(f.text)")
            } catch {
                call.reject("Couldn't unpack: \(error.localizedDescription)")
            }
        }
    }

    // ---- download, with progress ----
    private final class Fetch: NSObject, URLSessionDownloadDelegate {
        let dest: URL
        let onProgress: (Int64, Int64) -> Void
        let done = DispatchSemaphore(value: 0)
        var failure: Error?
        var status = 0
        init(dest: URL, onProgress: @escaping (Int64, Int64) -> Void) {
            self.dest = dest
            self.onProgress = onProgress
        }
        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
            onProgress(totalBytesWritten, max(0, totalBytesExpectedToWrite))
        }
        func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
            status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
            do {
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.moveItem(at: location, to: dest)
            } catch {
                failure = error
            }
        }
        func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
            if let error = error { failure = error }
            done.signal()
        }
    }

    private func fetch(_ url: URL, to dest: URL, job: String, part: Int, parts: Int) throws {
        var last = Date.distantPast
        let f = Fetch(dest: dest) { [weak self] got, total in
            // At most a few updates a second.
            if Date().timeIntervalSince(last) > 0.4 {
                last = Date()
                self?.note(job, "download", got, total, part, parts)
            }
        }
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 6 * 3600
        let session = URLSession(configuration: config, delegate: f, delegateQueue: nil)
        session.downloadTask(with: url).resume()
        f.done.wait()
        session.finishTasksAndInvalidate()
        if let e = f.failure { throw Failure("download failed (\(e.localizedDescription))") }
        if f.status >= 400 { throw Failure("the file server answered HTTP \(f.status)") }
    }

    // ---- .zip ----
    private func unzip(_ zip: URL, into out: URL) throws -> [URL] {
        let archive: ZIPFoundation.Archive
        do {
            archive = try ZIPFoundation.Archive(url: zip, accessMode: .read)
        } catch {
            throw Failure("this .zip can't be read")
        }
        var files: [URL] = []
        for entry in archive where entry.type == .file {
            let name = (entry.path as NSString).lastPathComponent
            guard Self.keeps(name) else { continue }
            let to = out.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: to)
            _ = try archive.extract(entry, to: to)
            files.append(to)
        }
        return files
    }

    // ---- .rar ----
    private func unrar(_ rar: URL, into out: URL) throws -> [URL] {
        let archive: Unrar.Archive
        do {
            archive = try Unrar.Archive(fileURL: rar)
        } catch {
            throw Failure("this .rar can't be read")
        }
        var files: [URL] = []
        for entry in try archive.entries() where !entry.directory {
            if entry.encrypted { throw Failure("this archive needs a password") }
            let name = (entry.fileName.replacingOccurrences(of: "\\", with: "/") as NSString).lastPathComponent
            guard Self.keeps(name) else { continue }
            let to = out.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: to)
            FileManager.default.createFile(atPath: to.path, contents: nil)
            guard let handle = try? FileHandle(forWritingTo: to) else { throw Failure("couldn't write \(name)") }
            defer { try? handle.close() }
            // Written as it comes, piece by piece: a 500 MB book never sits in memory whole.
            try archive.extract(entry) { data, _ in handle.write(data) }
            files.append(to)
        }
        return files
    }

    private func note(_ job: String, _ phase: String, _ got: Int64, _ total: Int64, _ part: Int, _ parts: Int) {
        notifyListeners("unpackProgress", data: ["job": job, "phase": phase, "got": got, "total": total, "part": part, "parts": parts])
    }

    private struct Failure: Error {
        let text: String
        init(_ text: String) { self.text = text }
    }
}
