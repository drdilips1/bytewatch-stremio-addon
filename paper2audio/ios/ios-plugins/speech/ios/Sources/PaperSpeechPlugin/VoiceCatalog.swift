import Foundation

/// The same voices as Paper to Audio on Android (LocalTts.kt, Kokoro.kt, MyVoices.kt), with the same
/// settings, so each sounds the same on both. Voice ids: "super:F2", "kokoro:af_heart", "clone:emma";
/// anything else is one of the iPhone's own voices.
enum VoiceCatalog {
    struct Pack {
        let key: String
        let title: String
        let folder: String
        let mb: Int
        let required: [String]
    }

    static let kokoroPack = Pack(key: "kokoro", title: "Kokoro voices", folder: "kokoro-int8-multi-lang-v1_0", mb: 132,
                                 required: ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-us-en.txt", "espeak-ng-data"])
    static let supertonicPack = Pack(key: "supertonic", title: "Light voices", folder: "sherpa-onnx-supertonic-3-tts-int8-2026-05-11", mb: 129,
                                     required: ["duration_predictor.int8.onnx", "text_encoder.int8.onnx", "vector_estimator.int8.onnx",
                                                "vocoder.int8.onnx", "tts.json", "unicode_indexer.bin", "voice.bin"])
    static let pocketPack = Pack(key: "pocket", title: "Real readers", folder: "sherpa-onnx-pocket-tts-int8-2026-01-26", mb: 98,
                                 required: ["lm_flow.int8.onnx", "lm_main.int8.onnx", "encoder.onnx", "decoder.int8.onnx",
                                            "text_conditioner.onnx", "vocab.json", "token_scores.json"])
    static let packs = [supertonicPack, kokoroPack, pocketPack]

    static func pack(forVoice id: String) -> Pack? {
        if id.hasPrefix("super:") { return supertonicPack }
        if id.hasPrefix("kokoro:") { return kokoroPack }
        if id.hasPrefix("clone:") { return pocketPack }
        return nil
    }

    static func isNeural(_ id: String) -> Bool { pack(forVoice: id) != nil }

    // Supertonic 3's ten voices; sid is the style index in voice.bin.
    static let supertonic: [(name: String, sid: Int, label: String)] =
        (1...5).map { (name: "F\($0)", sid: $0 - 1, label: "Supertonic female \($0)") } +
        (1...5).map { (name: "M\($0)", sid: $0 + 4, label: "Supertonic male \($0)") }

    static let supertonicLangs: Set<String> = ["en", "ko", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu",
                                               "id", "it", "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi"]

    struct KVoice {
        let name: String
        let sid: Int
        let label: String
        var british: Bool { name.hasPrefix("b") }
    }

    static let kokoro: [KVoice] = [
        KVoice(name: "af_heart", sid: 3, label: "Heart · US English · female"),
        KVoice(name: "af_bella", sid: 2, label: "Bella · US English · female"),
        KVoice(name: "af_nicole", sid: 6, label: "Nicole · US English · female (soft)"),
        KVoice(name: "af_sarah", sid: 9, label: "Sarah · US English · female"),
        KVoice(name: "af_aoede", sid: 1, label: "Aoede · US English · female"),
        KVoice(name: "af_kore", sid: 5, label: "Kore · US English · female"),
        KVoice(name: "am_michael", sid: 16, label: "Michael · US English · male"),
        KVoice(name: "am_fenrir", sid: 14, label: "Fenrir · US English · male"),
        KVoice(name: "am_puck", sid: 18, label: "Puck · US English · male"),
        KVoice(name: "am_echo", sid: 12, label: "Echo · US English · male"),
        KVoice(name: "bf_emma", sid: 21, label: "Emma · British English · female"),
        KVoice(name: "bf_isabella", sid: 22, label: "Isabella · British English · female"),
        KVoice(name: "bm_george", sid: 26, label: "George · British English · male"),
        KVoice(name: "bm_fable", sid: 25, label: "Fable · British English · male"),
        KVoice(name: "bm_daniel", sid: 24, label: "Daniel · British English · male"),
        KVoice(name: "hf_alpha", sid: 31, label: "Ananya · Indian English · female"),
        KVoice(name: "hf_beta", sid: 32, label: "Diya · Indian English · female"),
        KVoice(name: "hm_omega", sid: 33, label: "Arjun · Indian English · male"),
        KVoice(name: "hm_psi", sid: 34, label: "Kabir · Indian English · male"),
    ]

    /// Ready-made copied voices ("real readers"): the recording is in the app (public/voices/<id>.wav or .mp3).
    struct Reader {
        let id: String
        let name: String
        let description: String
        var pause: Int = 0
        var denoised: Bool = true
        var seed: Int = 0
        var leadIn: Bool = true
    }

    static let readers: [Reader] = [
        // Narrato's readers, with exactly the settings they have on Android.
        Reader(id: "emma", name: "Emma", description: "female · English", pause: 700, denoised: false, seed: 64194),
        Reader(id: "lily", name: "Lily", description: "female · English", pause: 700, denoised: false, seed: 90538),
        Reader(id: "grace", name: "Grace", description: "female · English", pause: 480, denoised: false, seed: 34312),
        Reader(id: "isla", name: "Isla", description: "female · English", pause: 900, denoised: false, seed: 4618),
        Reader(id: "sophie", name: "Sophie", description: "female · English", pause: 700, denoised: false, seed: 92620),
        Reader(id: "ava", name: "Ava", description: "female · English", pause: 760, denoised: false, seed: 97744),
        Reader(id: "clara", name: "Clara", description: "female · English", pause: 900, denoised: false, seed: 41723),
        Reader(id: "maya", name: "Maya", description: "female · English", pause: 720, denoised: false, seed: 56628),
        Reader(id: "nora", name: "Hazel", description: "female · English", pause: 540, denoised: false, seed: 98730),
        Reader(id: "rose", name: "Rose", description: "female · English", pause: 560, denoised: false, seed: 6471),
        Reader(id: "daniel", name: "Daniel", description: "male · English", pause: 740, denoised: false, seed: 20604),
        Reader(id: "henry", name: "Henry", description: "male · English", pause: 900, denoised: false, seed: 54287),
        Reader(id: "oscar", name: "Oscar", description: "male · English", pause: 800, denoised: false, seed: 15734),
        Reader(id: "jack", name: "Jack", description: "male · English", pause: 520, denoised: false, seed: 81386),
        Reader(id: "arthur", name: "Arthur", description: "male · English", pause: 840, denoised: false, seed: 57008),
        Reader(id: "leo", name: "Noah", description: "male · English", pause: 500, denoised: false, seed: 31250),
        Reader(id: "sam", name: "Lucas", description: "male · English", pause: 560, denoised: false, seed: 84032),
        Reader(id: "theo", name: "Theo", description: "male · English", pause: 740, denoised: false, seed: 31800),
        Reader(id: "ethan", name: "Ethan", description: "male · English", pause: 640, denoised: false, seed: 92573),
        Reader(id: "ryan", name: "Ryan", description: "male · English", pause: 700, denoised: false, seed: 41746),
        // Copied from openly licensed sample voices.
        Reader(id: "luna", name: "Luna", description: "female · US"),
        Reader(id: "bria", name: "Bria", description: "female · US"),
        Reader(id: "carter", name: "Carter", description: "male · US"),
        Reader(id: "declan", name: "Declan", description: "male · US, deep"),
        Reader(id: "elliot", name: "Elliot", description: "male · US, deep"),
        Reader(id: "felix", name: "Felix", description: "male · US"),
        Reader(id: "grant", name: "Grant", description: "male · US, deep"),
        Reader(id: "hugo", name: "Hugo", description: "male · US"),
        Reader(id: "ian", name: "Ian", description: "male · US, lighter"),
        Reader(id: "james", name: "James", description: "male · British"),
    ]

    static func reader(_ id: String) -> Reader? { readers.first { $0.id == id } }

    /// Java's String.hashCode, so a voice without a picked seed gets the same one as on Android.
    static func javaHash(_ s: String) -> Int32 {
        var h: Int32 = 0
        for u in s.utf16 { h = 31 &* h &+ Int32(u) }
        return h
    }

    static func seed(forVoice id: String) -> Int {
        if id.hasPrefix("clone:"), let r = reader(String(id.dropFirst(6))), r.seed > 0 { return r.seed }
        return Int(javaHash(id) & 0x7fffffff) % 100_000 + 1
    }

    /// The voice list for the app's chooser.
    static func listForChooser() -> [[String: Any]] {
        var out: [[String: Any]] = []
        for v in supertonic { out.append(["id": "super:\(v.name)", "name": v.label, "group": "supertonic", "lang": "multi"]) }
        for v in kokoro { out.append(["id": "kokoro:\(v.name)", "name": v.label, "group": "kokoro", "lang": "en"]) }
        for r in readers { out.append(["id": "clone:\(r.id)", "name": r.name, "detail": r.description, "group": "readers", "lang": "en"]) }
        return out
    }
}
