import Foundation
#if canImport(SherpaOnnxC)
import SherpaOnnxC
#endif

/// The on-device voice engines (sherpa-onnx), as on Android (LocalTts.generate): Supertonic, Kokoro and
/// the copying engine (real readers). One model in memory at a time; calls are serialized.
final class NeuralEngine {
    static let shared = NeuralEngine()
    private let lock = NSLock()
    private var key = ""
    private var tts: SherpaOnnxOfflineTtsWrapper?
    /// Each copied voice's usual pace (characters a second), learned as it reads (as on Android).
    private var paces: [String: Double] = [:]

    struct Audio {
        let samples: [Float]
        let rate: Int
    }

    enum Failure: LocalizedError {
        case missing(String), unknown(String), empty
        var errorDescription: String? {
            switch self {
            case .missing(let t): return "Download the \(t) first"
            case .unknown(let v): return "Unknown voice \(v)"
            case .empty: return "The voice produced no audio"
            }
        }
    }

    // Supertonic's own 1x is brisk: it slows a little itself and the player does the rest (as on Android).
    static let supertonicPace: Float = 0.95
    static let supertonicPlayback: Float = 0.87

    /// Fastest speed each engine renders itself; the player speeds up beyond it (pitch kept).
    static func maxSpeed(_ voice: String) -> Float {
        if voice.hasPrefix("clone:") { return 1.0 }
        if voice.hasPrefix("super:") { return 1.1 }
        return 2.0
    }

    private func engineKey(_ voice: String) -> String {
        if voice.hasPrefix("kokoro:") {
            let name = String(voice.dropFirst(7))
            return VoiceCatalog.kokoro.first { $0.name == name }?.british == true ? "kokoro-gb" : "kokoro-us"
        }
        if voice.hasPrefix("super:") { return "supertonic" }
        return "pocket"
    }

    private func engine(for voice: String) throws -> SherpaOnnxOfflineTtsWrapper {
        let k = engineKey(voice)
        if k == key, let t = tts { return t }
        tts = nil // frees the previous model first (only one in memory)
        let packs = Packs.shared
        // Two threads, for battery (as on Android: more only busy-wait).
        let threads = 2
        var model: SherpaOnnxOfflineTtsModelConfig
        switch k {
        case "supertonic":
            let p = VoiceCatalog.supertonicPack
            guard packs.isInstalled(p) else { throw Failure.missing(p.title) }
            model = sherpaOnnxOfflineTtsModelConfig(numThreads: threads, supertonic: sherpaOnnxOfflineTtsSupertonicModelConfig(
                durationPredictor: packs.file(p, "duration_predictor.int8.onnx"),
                textEncoder: packs.file(p, "text_encoder.int8.onnx"),
                vectorEstimator: packs.file(p, "vector_estimator.int8.onnx"),
                vocoder: packs.file(p, "vocoder.int8.onnx"),
                ttsJson: packs.file(p, "tts.json"),
                unicodeIndexer: packs.file(p, "unicode_indexer.bin"),
                voiceStyle: packs.file(p, "voice.bin")))
        case "pocket":
            let p = VoiceCatalog.pocketPack
            guard packs.isInstalled(p) else { throw Failure.missing(p.title) }
            model = sherpaOnnxOfflineTtsModelConfig(numThreads: threads, pocket: sherpaOnnxOfflineTtsPocketModelConfig(
                lmFlow: packs.file(p, "lm_flow.int8.onnx"),
                lmMain: packs.file(p, "lm_main.int8.onnx"),
                encoder: packs.file(p, "encoder.onnx"),
                decoder: packs.file(p, "decoder.int8.onnx"),
                textConditioner: packs.file(p, "text_conditioner.onnx"),
                vocabJson: packs.file(p, "vocab.json"),
                tokenScoresJson: packs.file(p, "token_scores.json")))
        default:
            let p = VoiceCatalog.kokoroPack
            guard packs.isInstalled(p) else { throw Failure.missing(p.title) }
            var lexicon = packs.file(p, k == "kokoro-gb" ? "lexicon-gb-en.txt" : "lexicon-us-en.txt")
            if !FileManager.default.fileExists(atPath: lexicon) { lexicon = packs.file(p, "lexicon-us-en.txt") }
            model = sherpaOnnxOfflineTtsModelConfig(kokoro: sherpaOnnxOfflineTtsKokoroModelConfig(
                model: packs.file(p, "model.int8.onnx"),
                voices: packs.file(p, "voices.bin"),
                tokens: packs.file(p, "tokens.txt"),
                dataDir: packs.file(p, "espeak-ng-data"),
                lexicon: lexicon), numThreads: threads)
        }
        // silenceScale 1: the engines' default (0.2) shrinks every pause inside a sentence to a fifth.
        var config = sherpaOnnxOfflineTtsConfig(model: model, silenceScale: 1)
        let t = SherpaOnnxOfflineTtsWrapper(config: &config)
        guard t.tts != nil else { throw Failure.missing("voice files (they may be damaged; download them again)") }
        tts = t
        key = k
        return t
    }

    /// Frees the model (when reading stops or the phone is short of memory).
    func release() {
        lock.lock(); defer { lock.unlock() }
        tts = nil
        key = ""
    }

    func pace(_ voice: String) -> Double? { lock.lock(); defer { lock.unlock() }; return paces[voice] }

    private func recordPace(_ voice: String, chars: Int, seconds: Double) {
        guard chars >= 25, seconds >= 1 else { return }
        let now = Double(chars) / seconds
        let avg = paces[voice].map { $0 * 0.85 + now * 0.15 } ?? now
        paces[voice] = min(22, max(8, avg))
    }

    /// [text] spoken by [voice] at [speed] (the engine's own speed; the player does the rest).
    func synthesize(voice: String, text: String, speed: Float, lang: String?) throws -> Audio {
        lock.lock(); defer { lock.unlock() }
        let t = try engine(for: voice)
        let name = voice.split(separator: ":", maxSplits: 1).last.map(String.init) ?? ""
        var samples: [Float]
        var rate: Int
        if voice.hasPrefix("kokoro:") {
            guard let v = VoiceCatalog.kokoro.first(where: { $0.name == name }) else { throw Failure.unknown(voice) }
            let a = t.generate(text: text, sid: v.sid, speed: speed)
            samples = a.samples
            rate = Int(a.sampleRate)
        } else if voice.hasPrefix("super:") {
            guard let v = VoiceCatalog.supertonic.first(where: { $0.name == name }) else { throw Failure.unknown(voice) }
            let code = lang.flatMap { VoiceCatalog.supertonicLangs.contains($0) ? $0 : nil } ?? "en"
            let config = SherpaOnnxGenerationConfigSwift(
                silenceScale: 1, speed: speed * NeuralEngine.supertonicPace, sid: v.sid, numSteps: 6,
                extra: ["lang": code, "seed": String(VoiceCatalog.seed(forVoice: voice))])
            let a = t.generateWithConfig(text: text, config: config, callback: nil, arg: nil)
            samples = a.samples
            rate = Int(a.sampleRate)
        } else {
            (samples, rate) = try copied(t, voice: voice, name: name, text: text)
        }
        if samples.isEmpty { throw Failure.empty }
        return Audio(samples: samples, rate: rate)
    }

    /// A real reader: the copying engine with Android's settings and checks (the "Well." lead-in cut off,
    /// a second take for doubtful lines, run-ons trimmed, hiss removed).
    private func copied(_ t: SherpaOnnxOfflineTtsWrapper, voice: String, name: String, text: String) throws -> ([Float], Int) {
        guard let reader = VoiceCatalog.reader(name), let ref = AudioChecks.reference(name) else { throw Failure.unknown(voice) }
        let refRate = AudioChecks.referenceRate
        let hears = (ref.count + refRate - 1) / refRate
        let spoken = TextPrep.prepareForCopied(TextPrep.endSentence(text))
        let trimmed = spoken.trimmingCharacters(in: .whitespaces)
        let pace = paces[voice]
        func maxFrames(_ s: String) -> Int { min(400, max(25, Int(Double(s.count) * 1.15 + 15))) }
        func gen(_ say: String, seed: Int, extraFrames: Int = 0) -> (samples: [Float], rate: Int) {
            let config = SherpaOnnxGenerationConfigSwift(
                silenceScale: 1, referenceAudio: ref, referenceSampleRate: refRate, numSteps: 5,
                extra: [
                    "seed": String(seed),
                    "max_reference_audio_len": String(hears),
                    "temperature": "0.6",
                    "chunk_size": "15",
                    "max_frames": String(maxFrames(trimmed) + extraFrames),
                    "frames_after_eos": "2",
                ])
            let a = t.generateWithConfig(text: say, config: config, callback: nil, arg: nil)
            return (a.samples, Int(a.sampleRate))
        }
        func take(_ seed: Int) -> (samples: [Float], rate: Int) {
            if !reader.leadIn { return gen(spoken, seed: seed) }
            let led = gen(String(repeating: " ", count: 8) + "Well. " + trimmed, seed: seed, extraFrames: 12)
            if let cut = AudioChecks.afterLeadIn(led.samples, rate: led.rate), cut < led.samples.count {
                return (Array(led.samples[cut...]), led.rate)
            }
            return gen(spoken, seed: seed)
        }
        let seed = VoiceCatalog.seed(forVoice: voice)
        var best = take(seed)
        func secs(_ a: (samples: [Float], rate: Int)) -> Double { Double(a.samples.count) / Double(max(1, a.rate)) }
        if TextPrep.risky(spoken) || !AudioChecks.plausible(secs(best), trimmed, pace) {
            let second = take(seed + 7919)
            if AudioChecks.distance(secs(second), trimmed, pace) < AudioChecks.distance(secs(best), trimmed, pace) { best = second }
        }
        let clean = AudioChecks.dehiss(AudioChecks.trimRunOn(best.samples, rate: best.rate, text: text, pace: pace),
                                       rate: best.rate, lowPassOn: reader.denoised)
        recordPace(voice, chars: text.count, seconds: Double(clean.count) / Double(max(1, best.rate)))
        return (clean, best.rate)
    }
}
