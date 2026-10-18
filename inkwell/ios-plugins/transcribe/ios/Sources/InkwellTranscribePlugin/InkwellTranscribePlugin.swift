import Foundation
import Capacitor
import AVFoundation
import Speech

/// Live transcript on iPhone: the same interface as the Android plugin (start / position /
/// stop, "segment" and "status" events), built on Apple's own speech recognition.
/// The book's audio is cut into short pieces a little ahead of where you are listening,
/// each piece is recognised on the phone (offline where the iPhone supports it), and the
/// words come back as timed lines.
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
        let language = call.getString("language") ?? "en"

        task?.cancel()
        lock.lock()
        currentJob = job
        playPos = from
        lock.unlock()
        call.resolve()

        task = Task.detached(priority: .utility) { [weak self] in
            await self?.run(job: job, url: url, headers: headers, from: from, ahead: ahead, language: language)
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

    private func run(job: String, url: URL, headers: [String: String], from: Double, ahead: Double, language: String) async {
        status(job, "loading")
        guard await authorize() else {
            status(job, "error", "Allow speech recognition for Audiohub: iPhone Settings → Privacy & Security → Speech Recognition.")
            return
        }
        let locale = Locale(identifier: language == "hi" ? "hi-IN" : "en-US")
        guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.isAvailable else {
            status(job, "error", "Speech recognition isn't available for this language on this iPhone.")
            return
        }
        var options: [String: Any] = [:]
        if !headers.isEmpty { options["AVURLAssetHTTPHeaderFieldsKey"] = headers }
        let asset = AVURLAsset(url: url, options: options)
        var total: Double = 0
        if let d = try? await asset.load(.duration), d.seconds.isFinite { total = d.seconds }

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
                file = try await cut(asset, start: at, length: length)
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

    /// One piece of the book's audio as a small local file.
    private func cut(_ asset: AVURLAsset, start: Double, length: Double) async throws -> URL {
        guard let session = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetAppleM4A) else {
            throw NSError(domain: "Transcript", code: 1, userInfo: [NSLocalizedDescriptionKey: "this audio can't be read"])
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
            throw session.error ?? NSError(domain: "Transcript", code: 2, userInfo: [NSLocalizedDescriptionKey: "couldn't read this part"])
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
