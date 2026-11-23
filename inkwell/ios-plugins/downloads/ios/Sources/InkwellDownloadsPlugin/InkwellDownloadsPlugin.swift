import Foundation
import Capacitor
import UIKit

/// Offline downloads on iPhone, with the same calls as the Android plugin, so the app's
/// Downloads code (queue, pause, resume, playing the saved copy) works as it is.
///
/// Parts are saved where you can see them: Files app → On My iPhone → Audiohub → Downloads →
/// Author → Title (copy them to a computer, AirDrop them…). The own-files scan skips that folder,
/// so a download isn't listed again as "your own book"; the folder is kept out of iCloud backups
/// (audiobooks are big). iOS moves an app's folder when it's updated or reinstalled, so every
/// answer also gives `rel` — the part's place inside Downloads — and `paths` turns those back into
/// today's addresses (and says which parts were deleted in the Files app).
@objc(InkwellDownloadsPlugin)
public class InkwellDownloadsPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "InkwellDownloadsPlugin"
    public let jsName = "InkwellDownloads"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "move", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "paths", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "publicAvailable", returnType: CAPPluginReturnPromise)
    ]

    /// One part being downloaded.
    private final class Job {
        let id: String
        let call: CAPPluginCall
        let target: URL
        let rel: String
        var task: URLSessionDownloadTask?
        var lastSent = Date.distantPast
        var saved: Int64 = 0
        var error: String?
        var background: UIBackgroundTaskIdentifier = .invalid
        init(id: String, call: CAPPluginCall, target: URL, rel: String) {
            self.id = id
            self.call = call
            self.target = target
            self.rel = rel
        }
    }

    private var jobs: [Int: Job] = [:] // by task id
    private let lock = NSLock()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 60
        config.timeoutIntervalForResource = 6 * 3600
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    /// Documents/Downloads (shown in the Files app) — created on first use, never backed up to iCloud.
    private var root: URL {
        var url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
        return url
    }

    private func clean(_ s: String) -> String {
        s.replacingOccurrences(of: "[\\\\:*?\"<>|]", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
    }

    /// A free file name in `dir` ("01 - Part.mp3", then "01 - Part (2).mp3"…).
    private func freeName(in dir: URL, for name: String) -> URL {
        var url = dir.appendingPathComponent(name)
        let base = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent(ext.isEmpty ? "\(base) (\(n))" : "\(base) (\(n)).\(ext)")
            n += 1
        }
        return url
    }

    /// The part's place inside Downloads ("Audiohub/Author/Title/001 - Part.mp3").
    private func relative(_ url: URL) -> String {
        let r = root.standardizedFileURL.path
        let p = url.standardizedFileURL.path
        return p.hasPrefix(r + "/") ? String(p.dropFirst(r.count + 1)) : url.lastPathComponent
    }

    /// Only files inside Downloads are ever moved or deleted.
    private func inside(_ uri: String) -> URL? {
        guard let url = URL(string: uri) ?? URL(string: uri.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""), url.isFileURL else { return nil }
        return url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") ? url : nil
    }

    /// iPhone build 9 kept downloads hidden in Application Support: moved once to the Files folder
    /// (same places inside Downloads, so the app's saved `rel`s still fit).
    override public func load() {
        let old = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true)
        guard FileManager.default.fileExists(atPath: old.path) else { return }
        let dest = root
        let items = (try? FileManager.default.contentsOfDirectory(at: old, includingPropertiesForKeys: nil)) ?? []
        for item in items {
            let to = dest.appendingPathComponent(item.lastPathComponent)
            if FileManager.default.fileExists(atPath: to.path) { mergeMove(item, into: to) } else { try? FileManager.default.moveItem(at: item, to: to) }
        }
        try? FileManager.default.removeItem(at: old)
    }

    /// Move a folder's contents into an existing folder of the same name.
    private func mergeMove(_ from: URL, into to: URL) {
        let items = (try? FileManager.default.contentsOfDirectory(at: from, includingPropertiesForKeys: nil)) ?? []
        for item in items {
            let target = to.appendingPathComponent(item.lastPathComponent)
            var isDir: ObjCBool = false
            if FileManager.default.fileExists(atPath: target.path, isDirectory: &isDir) {
                if isDir.boolValue { mergeMove(item, into: target) }
            } else {
                try? FileManager.default.moveItem(at: item, to: target)
            }
        }
    }

    // MARK: calls from the app

    @objc func download(_ call: CAPPluginCall) {
        guard let link = call.getString("url"),
              let url = URL(string: link) ?? URL(string: link.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") else {
            call.reject("No link for this part")
            return
        }
        let job = call.getString("job") ?? UUID().uuidString
        let folder = (call.getString("folder") ?? "Audiohub").split(separator: "/").map { clean(String($0)) }.filter { !$0.isEmpty }.joined(separator: "/")
        let name = clean(call.getString("name") ?? url.lastPathComponent).replacingOccurrences(of: "/", with: " ")
        let dir = root.appendingPathComponent(folder, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        } catch {
            call.reject("Couldn't make the folder: \(error.localizedDescription)")
            return
        }
        let target = freeName(in: dir, for: name.isEmpty ? "part.mp3" : name)
        var request = URLRequest(url: url)
        for (k, v) in call.getObject("headers") ?? [:] {
            if let s = v as? String { request.setValue(s, forHTTPHeaderField: k) }
        }
        let task = session.downloadTask(with: request)
        let j = Job(id: job, call: call, target: target, rel: relative(target))
        j.task = task
        // A little time to finish when you leave the app (iOS gives a few minutes at most).
        DispatchQueue.main.async {
            j.background = UIApplication.shared.beginBackgroundTask(withName: "Audiohub download") { [weak self] in
                self?.endBackground(j)
            }
        }
        lock.lock()
        jobs[task.taskIdentifier] = j
        lock.unlock()
        task.resume()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        let id = call.getString("job") ?? ""
        lock.lock()
        let running = jobs.values.filter { $0.id == id }
        lock.unlock()
        running.forEach { $0.task?.cancel() }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        if let url = inside(call.getString("uri") ?? "") {
            try? FileManager.default.removeItem(at: url)
            // Empty folders (Title, then Author) go too.
            var dir = url.deletingLastPathComponent()
            while dir.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/"),
                  (try? FileManager.default.contentsOfDirectory(atPath: dir.path))?.isEmpty == true {
                try? FileManager.default.removeItem(at: dir)
                dir = dir.deletingLastPathComponent()
            }
        }
        call.resolve()
    }

    @objc func move(_ call: CAPPluginCall) {
        guard let from = inside(call.getString("uri") ?? "") else {
            call.reject("Not a downloaded file")
            return
        }
        let folder = (call.getString("folder") ?? "Audiohub").split(separator: "/").map { clean(String($0)) }.filter { !$0.isEmpty }.joined(separator: "/")
        let dir = root.appendingPathComponent(folder, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let to = freeName(in: dir, for: from.lastPathComponent)
            try FileManager.default.moveItem(at: from, to: to)
            call.resolve(["uri": to.absoluteString, "rel": relative(to), "location": "Files → Audiohub → Downloads"])
        } catch {
            call.reject("Couldn't move it: \(error.localizedDescription)")
        }
    }

    /// Today's addresses for saved parts (iOS moves the app's folder on every update), and which
    /// ones are gone (deleted, renamed or moved in the Files app).
    @objc func paths(_ call: CAPPluginCall) {
        let rels = call.getArray("rels", String.self) ?? []
        let urls = rels.map { root.appendingPathComponent($0) }
        call.resolve([
            "uris": urls.map { $0.absoluteString },
            "missing": urls.map { !FileManager.default.fileExists(atPath: $0.path) }
        ])
    }

    /// Android's "save to the phone's Downloads folder": not on iPhone (parts stay in the app).
    @objc func publicAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": false])
    }

    // MARK: the download itself

    private func job(for task: URLSessionTask) -> Job? {
        lock.lock()
        defer { lock.unlock() }
        return jobs[task.taskIdentifier]
    }

    private func endBackground(_ j: Job) {
        DispatchQueue.main.async {
            if j.background != .invalid {
                UIApplication.shared.endBackgroundTask(j.background)
                j.background = .invalid
            }
        }
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let j = job(for: downloadTask), Date().timeIntervalSince(j.lastSent) > 0.5 else { return }
        j.lastSent = Date()
        notifyListeners("progress", data: ["job": j.id, "received": totalBytesWritten, "total": max(0, totalBytesExpectedToWrite)])
    }

    /// The file must be moved before this returns (iOS deletes it right after).
    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let j = job(for: downloadTask) else { return }
        if let http = downloadTask.response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            j.error = "the server answered HTTP \(http.statusCode)"
            return
        }
        // A web page instead of audio (an expired or wrong link): not kept as a part.
        if let h = try? FileHandle(forReadingFrom: location) {
            let head = String(decoding: h.readData(ofLength: 256), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            try? h.close()
            if head.hasPrefix("<!doctype html") || head.hasPrefix("<html") {
                j.error = "the link gave a web page instead of the audio"
                return
            }
        }
        do {
            try? FileManager.default.removeItem(at: j.target)
            try FileManager.default.moveItem(at: location, to: j.target)
            j.saved = (try? FileManager.default.attributesOfItem(atPath: j.target.path)[.size] as? Int64) ?? 0
        } catch {
            j.error = "couldn't save it: \(error.localizedDescription)"
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let j = job(for: task) else { return }
        lock.lock()
        jobs[task.taskIdentifier] = nil
        lock.unlock()
        endBackground(j)
        if let e = error as NSError? {
            j.call.reject(e.code == NSURLErrorCancelled ? "cancelled" : e.localizedDescription)
        } else if let msg = j.error {
            j.call.reject(msg)
        } else {
            j.call.resolve(["uri": j.target.absoluteString, "rel": j.rel, "size": j.saved, "location": "Files → Audiohub → Downloads"])
        }
    }
}
