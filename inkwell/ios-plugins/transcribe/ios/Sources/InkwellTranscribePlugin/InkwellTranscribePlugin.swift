import Foundation
import Capacitor
import AVFoundation
import Speech

/// Live transcript on iPhone: the same interface as the Android plugin (start / position /
/// stop, "segment" and "status" events), built on Apple's own speech recognition.
///
/// iOS can only cut pieces out of audio that is on the phone, so:
/// - MP3 (most multi-part books): each ~45 s piece is fetched on its own with an HTTP
///   range request (from the file's size and length) and recognised directly.
/// - Other formats (M4B / M4A): the part is downloaded once, then cut locally; the copy
///   is deleted when the transcript stops or moves on.
@objc(InkwellTranscribePlugin)
public class InkwellTranscribePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkwellTranscribePlugin"
    public let jsName = "InkwellTranscribe"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "position", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private let lock = NSLock()
    private var currentJob = ""
    private var playPos: Double = 0
    private var task: Task<Void, Never>?
    /// Seconds of audio per piece (Apple's server recognition stops at one minute).
    private let pieceLength: Double = 45
    /// Downloaded copy of the current part (non-MP3), kept while the same part is transcribed.
    private var cached: (url: URL, file: URL)?

    @objc func start(_ call: CAPPluginCall) {
        let job = call.getString("job") ?? ""
        guard let address = call.getString("url"), let url = URL(string: address) else {
            call.reject("No audio address")
            return
        }
        var headers: [String: String] = [:]
        for (k, v) in call.getObject("headers") ?? [:] {
            if let s = v as? String { headers[k] = s }
        }
        let from = call.getDouble("start") ?? 0
        let ahead = call.getDouble("ahead") ?? 90
        let duration = call.getDouble("duration") ?? 0
        let language = call.getString("language") ?? "en"

        task?.cancel()
        lock.lock()
        currentJob = job
        playPos = from
        lock.unlock()
        call.resolve()

        task = Task.detached(priority: .utility) { [weak self] in
            await self?.run(job: job, url: url, headers: headers, from: from, ahead: ahead, knownDuration: duration, language: language)
        }
    }

    @objc func position(_ call: CAPPluginCall) {
        lock.lock()
        playPos = call.getDouble("pos") ?? playPos
        lock.unlock()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        lock.lock()
        currentJob = ""
        lock.unlock()
        task?.cancel()
        task = nil
        dropCache()
        call.resolve()
    }

    // MARK: - work

    private func isCurrent(_ job: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return job == currentJob && !Task.isCancelled
    }

    private func listening() -> Double {
        lock.lock()
        defer { lock.unlock() }
        return playPos
    }

    private func status(_ job: String, _ state: String, _ message: String = "") {
        notifyListeners("status", data: ["job": job, "state": state, "message": message])
    }

    private func fail(_ text: String) -> NSError {
        NSError(domain: "Transcript", code: 1, userInfo: [NSLocalizedDescriptionKey: text])
    }

    private func dropCache() {
        lock.lock()
        let old = cached
        cached = nil
        lock.unlock()
        if let f = old?.file { try? FileManager.default.removeItem(at: f) }
    }

    private func authorize() async -> Bool {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: return true
        case .notDetermined:
            return await withCheckedContinuation { c in
                SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0 == .authorized) }
            }
        default: return false
        }
    }

    /// Size and type of a remote file, from a one-byte range request.
    private func probe(_ url: URL, headers: [String: String]) async throws -> (size: Int64, type: String, ranges: Bool) {
        var req = URLRequest(url: url, timeoutInterval: 30)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        let (_, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw fail("no answer from the server") }
        let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
        if http.statusCode == 206, let cr = http.value(forHTTPHeaderField: "Content-Range"), let total = cr.split(separator: "/").last.flatMap({ Int64($0) }) {
            return (total, type, true)
        }
        return (http.expectedContentLength, type, false)
    }

    private func run(job: String, url: URL, headers: [String: String], from: Double, ahead: Double, knownDuration: Double, language: String) async {
        status(job, "loading", "model")
        guard await authorize() else {
            status(job, "error", "Allow speech recognition for Audiohub: iPhone Settings → Privacy & Security → Speech Recognition.")
            return
        }
        let locale = Locale(identifier: language == "hi" ? "hi-IN" : "en-US")
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            status(job, "error", "Speech recognition isn't available for this language on this iPhone.")
            return
        }

        status(job, "loading", "audio")
        // Work out how to get pieces of this part.
        var mp3Size: Int64 = 0 // > 0: fetch MP3 pieces by byte range
        var localAsset: AVURLAsset?
        do {
            if url.isFileURL {
                localAsset = AVURLAsset(url: url)
            } else {
                let info = try await probe(url, headers: headers)
                let isMp3 = url.pathExtension.lowercased() == "mp3" || info.type.contains("mpeg") || info.type.contains("mp3")
                if isMp3 && info.ranges && info.size > 0 {
                    mp3Size = info.size
                } else {
                    if info.size > 900_000_000 {
                        status(job, "error", "This part is too big to transcribe on iPhone (\(info.size / 1_000_000) MB).")
                        return
                    }
                    localAsset = AVURLAsset(url: try await localCopy(url, headers: headers, job: job))
                }
            }
        } catch {
            if isCurrent(job) { status(job, "error", "Couldn't open this book's audio for the transcript (\(error.localizedDescription)).") }
            return
        }
        guard isCurrent(job) else { return }

        var total = knownDuration
        if let a = localAsset, let d = try? await a.load(.duration), d.seconds.isFinite, d.seconds > 0 { total = d.seconds }
        if mp3Size > 0 && total <= 0 {
            let remote = AVURLAsset(url: url, options: headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey": headers])
            if let d = try? await remote.load(.duration), d.seconds.isFinite, d.seconds > 0 { total = d.seconds }
        }
        if mp3Size > 0 && total <= 0 {
            status(job, "error", "Couldn't tell how long this part is, so the transcript can't find its place.")
            return
        }

        var at = from
        var running = false
        var failures = 0
        while isCurrent(job) {
            if total > 0 && at >= total - 0.5 {
                status(job, "done")
                return
            }
            // Stay about `ahead` seconds in front of the listener, no further.
            if at > listening() + ahead {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                continue
            }
            let length = total > 0 ? min(pieceLength, total - at) : pieceLength
            let file: URL
            do {
                if mp3Size > 0 {
                    file = try await mp3Piece(url, headers: headers, size: mp3Size, total: total, start: at, length: length)
                } else if let a = localAsset {
                    file = try await cut(a, start: at, length: length)
                } else {
                    throw fail("no audio")
                }
            } catch {
                if !isCurrent(job) { return }
                if total == 0 && failures > 0 { status(job, "done"); return } // past the end of a file of unknown length
                failures += 1
                if failures >= 3 {
                    status(job, "error", "Couldn't read this book's audio for the transcript (\(error.localizedDescription)).")
                    return
                }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                continue
            }
            failures = 0
            defer { try? FileManager.default.removeItem(at: file) }
            // A piece with no speech (music, silence) just has no lines.
            let words = (try? await recognize(file, with: recognizer)) ?? []
            guard isCurrent(job) else { return }
            if !running {
                running = true
                status(job, "running")
            }
            for line in lines(words, offset: at) {
                notifyListeners("segment", data: ["job": job, "start": line.start, "end": line.end, "text": line.text])
            }
            at += length
        }
    }

    /// One MP3 piece: the matching byte range, saved as a small file (MP3 frames re-sync on their own).
    private func mp3Piece(_ url: URL, headers: [String: String], size: Int64, total: Double, start: Double, length: Double) async throws -> URL {
        let perSecond = Double(size) / total
        let first = max(0, Int64(start * perSecond))
        let last = min(size - 1, Int64((start + length) * perSecond) + 4096)
        var req = URLRequest(url: url, timeoutInterval: 60)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.setValue("bytes=\(first)-\(last)", forHTTPHeaderField: "Range")
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 206 || http.statusCode == 200, !data.isEmpty else {
            throw fail("the server didn't send this part of the audio")
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-\(UUID().uuidString).mp3")
        try data.write(to: out)
        return out
    }

    /// The whole part on the phone (formats that can't be fetched in pieces), reused while it's the same part.
    private func localCopy(_ url: URL, headers: [String: String], job: String) async throws -> URL {
        lock.lock()
        let hit = cached
        lock.unlock()
        if let hit = hit, hit.url == url, FileManager.default.fileExists(atPath: hit.file.path) { return hit.file }
        dropCache()
        var req = URLRequest(url: url, timeoutInterval: 120)
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let (tmp, resp) = try await URLSession.shared.download(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            try? FileManager.default.removeItem(at: tmp)
            throw fail("the server refused the download")
        }
        let ext = url.pathExtension.isEmpty ? "m4a" : url.pathExtension
        let file = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-part-\(UUID().uuidString).\(ext)")
        try FileManager.default.moveItem(at: tmp, to: file)
        lock.lock()
        cached = (url, file)
        lock.unlock()
        return file
    }

    /// One piece of a local file as a small m4a.
    private func cut(_ asset: AVURLAsset, start: Double, length: Double) async throws -> URL {
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw fail("this audio can't be read")
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("transcript-\(UUID().uuidString).m4a")
        session.outputURL = out
        session.outputFileType = .m4a
        session.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 1000),
                                        duration: CMTime(seconds: length, preferredTimescale: 1000))
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            session.exportAsynchronously { c.resume() }
        }
        guard session.status == .completed else {
            try? FileManager.default.removeItem(at: out)
            throw session.error ?? fail("couldn't read this part")
        }
        return out
    }

    private func recognize(_ file: URL, with recognizer: SFSpeechRecognizer) async throws -> [SFTranscriptionSegment] {
        let request = SFSpeechURLRecognitionRequest(url: file)
        request.shouldReportPartialResults = false
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        if #available(iOS 16, *) { request.addsPunctuation = true }
        return try await withCheckedThrowingContinuation { c in
            var finished = false
            recognizer.recognitionTask(with: request) { result, error in
                if finished { return }
                if let error = error {
                    finished = true
                    c.resume(throwing: error)
                } else if let result = result, result.isFinal {
                    finished = true
                    c.resume(returning: result.bestTranscription.segments)
                }
            }
        }
    }

    /// Words → readable lines: break after a sentence (5+ words) or at 18 words.
    private func lines(_ words: [SFTranscriptionSegment], offset: Double) -> [(start: Double, end: Double, text: String)] {
        var out: [(start: Double, end: Double, text: String)] = []
        var parts: [String] = []
        var first = 0.0
        var last = 0.0
        func flush() {
            guard !parts.isEmpty else { return }
            var text = parts.joined(separator: " ")
            for p in [".", ",", "!", "?", ";", ":"] { text = text.replacingOccurrences(of: " " + p, with: p) }
            out.append((offset + first, offset + last, text))
            parts = []
        }
        for w in words {
            let s = w.substring.trimmingCharacters(in: .whitespaces)
            if s.isEmpty { continue }
            if parts.isEmpty { first = w.timestamp }
            parts.append(s)
            last = w.timestamp + w.duration
            let sentenceEnd = s.hasSuffix(".") || s.hasSuffix("?") || s.hasSuffix("!")
            if (sentenceEnd && parts.count >= 5) || parts.count >= 18 { flush() }
        }
        flush()
        return out
    }
}
