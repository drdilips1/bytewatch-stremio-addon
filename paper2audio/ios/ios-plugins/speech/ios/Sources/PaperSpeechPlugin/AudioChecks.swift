import Foundation
import AVFoundation

/// Checks and clean-up for copied voices, as on Android (CloneCheck and RunOn in LocalTts.kt).
enum AudioChecks {
    /// The voice sample ends on exactly 80 ms of silence (as the engine was trained).
    static func endOnPause(_ x: [Float], rate: Int) -> [Float] {
        let frame = max(1, rate / 50)
        let n = x.count / frame
        if n == 0 { return x }
        var db = [Double](repeating: 0, count: n)
        for f in 0..<n {
            var s = 0.0
            for i in (f * frame)..<((f + 1) * frame) { s += Double(x[i] * x[i]) }
            db[f] = 20 * log10(sqrt(s / Double(frame)) + 1e-12)
        }
        let mx = db.max() ?? 0
        let lastLoud = db.lastIndex { $0 > mx - 35 } ?? (n - 1)
        let end = (lastLoud + 1) * frame
        var out = Array(x.prefix(end))
        let fade = min(rate / 50, end)
        for k in 0..<fade { out[end - fade + k] *= 1 - Float(k) / Float(fade) }
        out += [Float](repeating: 0, count: rate * 8 / 100)
        return out
    }

    private static func rms(_ x: [Float], frame: Int) -> [Float] {
        let n = x.count / frame
        var r = [Float](repeating: 0, count: n)
        for f in 0..<n {
            var s = 0.0
            for i in (f * frame)..<((f + 1) * frame) { s += Double(x[i] * x[i]) }
            r[f] = Float(sqrt(s / Double(frame)))
        }
        return r
    }

    private static func percentile(_ v: [Float], _ p: Double) -> Float {
        let s = v.sorted()
        return s[min(s.count - 1, Int(Double(s.count) * p))]
    }

    /// Where the sentence starts after the throwaway "Well." (nil when there's no clear pause after it).
    static func afterLeadIn(_ x: [Float], rate: Int) -> Int? {
        let frame = rate / 100
        let r = rms(x, frame: frame)
        let n = r.count
        if n < 40 { return nil }
        let loud = percentile(r, 0.9)
        var onset: Int? = nil
        if n > 12 {
            for f in 0..<(n - 12) where (f..<(f + 12)).filter({ r[$0] > loud * 0.2 }).count >= 10 { onset = f; break }
        }
        guard let start = onset else { return nil }
        let quiet = loud * 0.06
        var f = start + 15
        while f < min(n, 160) {
            if r[f] < quiet {
                var e = f
                while e < n && r[e] < quiet { e += 1 }
                if e - f >= 9 {
                    let after = (e..<min(n, e + 30)).filter { r[$0] > loud * 0.2 }.count
                    return after >= 5 ? max(0, e - 3) * frame : nil
                }
                f = e
            } else { f += 1 }
        }
        return nil
    }

    private static func expected(_ text: String, _ pace: Double?) -> Double { 0.3 + Double(text.count) / (pace ?? 13.0) }

    static func distance(_ seconds: Double, _ text: String, _ pace: Double?) -> Double { abs(log(seconds / expected(text, pace))) }

    static func plausible(_ seconds: Double, _ text: String, _ pace: Double?) -> Bool {
        let e = expected(text, pace)
        let r = seconds / e
        if r < 0.6 { return false }
        return pace == nil ? r <= 1.75 : (r <= 1.4 || seconds - e < 0.8)
    }

    /// Cuts the babble a copied voice sometimes adds after a sentence (RunOn.trim).
    static func trimRunOn(_ samples: [Float], rate: Int, text: String, pace: Double?) -> [Float] {
        let seconds = Double(samples.count) / Double(rate)
        let exp: Double
        if let pace = pace {
            exp = max(1.0, 0.3 + Double(text.count) / pace)
            if seconds <= exp * 1.4 || seconds - exp < 0.8 { return samples }
        } else {
            exp = max(1.5, Double(text.count) / 11.0)
            if seconds <= exp * 1.5 { return samples }
        }
        let frame = rate / 20
        let from = Int(exp * (pace == nil ? 1.05 : 0.9) * Double(rate)) / frame
        let to = samples.count / frame
        if to - from < 2 { return samples }
        var energy = [Double](repeating: 0, count: to)
        for f in 0..<to {
            var e = 0.0
            for i in (f * frame)..<min(samples.count, (f + 1) * frame) { e += Double(samples[i] * samples[i]) }
            energy[f] = e / Double(frame)
        }
        let sorted = energy.sorted()
        let speech = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.7))]
        var cut: Int? = nil
        for f in from..<to where f + 1 < to && energy[f] < speech * 0.02 && energy[f + 1] < speech * 0.02 { cut = f; break }
        let at = cut ?? (from..<to).min { energy[$0] < energy[$1] } ?? to
        return Array(samples.prefix(at * frame))
    }

    /// A simple low-pass (two biquad passes at [cutoff] Hz).
    static func lowPass(_ x: [Float], rate: Int, cutoff: Double) -> [Float] {
        let w = 2 * Double.pi * cutoff / Double(rate)
        let q = 0.7071
        let alpha = sin(w) / (2 * q)
        let c = cos(w)
        let a0 = 1 + alpha
        let b0 = (1 - c) / 2 / a0, b1 = (1 - c) / a0, b2 = (1 - c) / 2 / a0
        let a1 = -2 * c / a0, a2 = (1 - alpha) / a0
        var y = x
        for _ in 0..<2 {
            var x1 = 0.0, x2 = 0.0, y1 = 0.0, y2 = 0.0
            for i in 0..<y.count {
                let xi = Double(y[i])
                let yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
                x2 = x1; x1 = xi; y2 = y1; y1 = yi
                y[i] = Float(yi)
            }
        }
        return y
    }

    /// Removes hiss: above 7.5 kHz (for voices learned from a cleaned 16 kHz recording) and in the quiet between words.
    static func dehiss(_ x: [Float], rate: Int, lowPassOn: Bool) -> [Float] {
        if x.isEmpty { return x }
        var y = lowPassOn && rate > 16_000 ? lowPass(x, rate: rate, cutoff: 7_500) : x
        let frame = rate / 100
        let r = rms(y, frame: frame)
        let n = r.count
        if n < 5 { return y }
        let floor = percentile(r, 0.9) * 0.03
        let ahead = 8
        var g: Float = 1
        for f in 0..<n {
            let soon = (f..<min(n, f + ahead + 1)).contains { r[$0] >= floor }
            let target: Float = soon ? 1 : 0.3
            g = target > g ? target : g + (target - g) * 0.2
            for i in (f * frame)..<((f + 1) * frame) { y[i] *= g }
        }
        return y
    }

    // MARK: - The readers' recordings

    static let referenceRate = 24_000
    private static var cache: [String: [Float]] = [:]
    private static let lock = NSLock()

    /// A ready-made reader's recording, mono at 24 kHz, at most 30 s, ending on 80 ms of silence.
    static func reference(_ id: String) -> [Float]? {
        lock.lock(); defer { lock.unlock() }
        if let c = cache[id] { return c }
        let base = Bundle.main.bundleURL.appendingPathComponent("public/voices")
        let url = ["wav", "mp3"].map { base.appendingPathComponent("\(id).\($0)") }.first { FileManager.default.fileExists(atPath: $0.path) }
        guard let url = url, let samples = decode(url) else { return nil }
        let room = 30 * referenceRate - referenceRate / 10
        let ref = endOnPause(Array(samples.prefix(room)), rate: referenceRate)
        cache[id] = ref
        return ref
    }

    /// Any audio file as mono float samples at 24 kHz (at most 32 s).
    private static func decode(_ url: URL) -> [Float]? {
        guard let file = try? AVAudioFile(forReading: url) else { return nil }
        let src = file.processingFormat
        guard let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(referenceRate), channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: src, to: target) else { return nil }
        let maxFrames = AVAudioFrameCount(min(Double(file.length), 32 * src.sampleRate))
        guard let inBuf = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: maxFrames) else { return nil }
        do { try file.read(into: inBuf, frameCount: maxFrames) } catch { return nil }
        let outCap = AVAudioFrameCount(Double(inBuf.frameLength) * target.sampleRate / src.sampleRate + 1024)
        guard let outBuf = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: outCap) else { return nil }
        var fed = false
        var err: NSError?
        converter.convert(to: outBuf, error: &err) { _, status in
            if fed { status.pointee = .endOfStream; return nil }
            fed = true
            status.pointee = .haveData
            return inBuf
        }
        guard err == nil, let ch = outBuf.floatChannelData else { return nil }
        return Array(UnsafeBufferPointer(start: ch[0], count: Int(outBuf.frameLength)))
    }
}
