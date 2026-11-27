import Foundation
import AVFoundation
import Capacitor

/// Reading aloud on iPhone with Apple's own voices — every voice on the phone, including the
/// Enhanced and Premium ones you download in Settings → Accessibility → Spoken Content → Voices.
/// The same calls as the Android InkwellTts plugin, so the app's voice settings, read-along and
/// "Listen" (an ebook made into an audiobook for the player) work as they are:
///  - getEngines / getVoices: one engine ("iPhone voices") and its voices, best first in the app.
///  - speak / stop: say a text (read-along in the reader); resolves when it has been said.
///  - synthesize: write a text to a WAV file in the app's caches (one audiobook part).
/// Speech uses the "spoken audio" session, so it keeps going with the screen off.
@objc(InkwellTtsPlugin)
public class InkwellTtsPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "InkwellTtsPlugin"
    public let jsName = "InkwellTts"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEngines", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVoices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "speak", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "synthesize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCache", returnType: CAPPluginReturnPromise)
    ]

    private let synth = AVSpeechSynthesizer()
    private var speaking: CAPPluginCall?
    private var writer: AVSpeechSynthesizer? // kept alive while it writes a file

    override public func load() {
        synth.delegate = self
    }

    @objc func getEngines(_ call: CAPPluginCall) {
        call.resolve(["engines": [["name": "apple", "label": "iPhone voices"]], "defaultEngine": "apple"])
    }

    @objc func getVoices(_ call: CAPPluginCall) {
        let names = Locale.current
        let list: [[String: Any]] = AVSpeechSynthesisVoice.speechVoices().compactMap { v in
            // Novelty voices ("Bells", "Bubbles"…) read books badly: left out.
            if #available(iOS 17.0, *), v.voiceTraits.contains(.isNoveltyVoice) { return nil }
            var quality = 300
            if v.quality == .enhanced { quality = 400 }
            if #available(iOS 16.0, *), v.quality == .premium { quality = 500 }
            let kind = quality >= 500 ? "Premium" : quality >= 400 ? "Enhanced" : ""
            return [
                "name": v.identifier,
                "title": kind.isEmpty ? v.name : "\(v.name) (\(kind))",
                "lang": v.language,
                "langLabel": names.localizedString(forIdentifier: v.language) ?? v.language,
                "quality": quality,
                "network": false
            ]
        }
        let def = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())?.identifier ?? ""
        call.resolve(["voices": list, "defaultVoice": def])
    }

    private func utterance(_ call: CAPPluginCall) -> AVSpeechUtterance {
        let u = AVSpeechUtterance(string: call.getString("text") ?? "")
        if let id = call.getString("voice"), !id.isEmpty, let v = AVSpeechSynthesisVoice(identifier: id) {
            u.voice = v
        } else {
            u.voice = AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
        }
        // The app's speed 1 is a normal reading pace; Apple's scale is 0…1 with 0.5 as normal.
        let rate = Float(call.getDouble("rate") ?? 1)
        u.rate = min(max(AVSpeechUtteranceDefaultSpeechRate * rate, AVSpeechUtteranceMinimumSpeechRate), AVSpeechUtteranceMaximumSpeechRate)
        return u
    }

    @objc func speak(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [])
            try? AVAudioSession.sharedInstance().setActive(true)
            // A new text replaces the one being said (as on Android: QUEUE_FLUSH).
            if let old = self.speaking {
                self.speaking = nil
                old.reject("stopped")
                self.synth.stopSpeaking(at: .immediate)
            }
            self.speaking = call
            self.synth.speak(self.utterance(call))
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let old = self.speaking {
                self.speaking = nil
                old.reject("stopped")
            }
            self.synth.stopSpeaking(at: .immediate)
            call.resolve()
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        guard synthesizer === synth, let c = speaking else { return }
        speaking = nil
        c.resolve()
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        guard synthesizer === synth, let c = speaking else { return }
        speaking = nil
        c.reject("stopped")
    }

    private var cacheDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    /// One part of an ebook made into an audiobook: the text written to a WAV file.
    @objc func synthesize(_ call: CAPPluginCall) {
        guard let rel = call.getString("path"), !rel.isEmpty, !rel.contains("..") else {
            call.reject("Missing path")
            return
        }
        let out = cacheDir.appendingPathComponent(rel)
        if let size = (try? FileManager.default.attributesOfItem(atPath: out.path))?[.size] as? Int, size > 1024 {
            call.resolve(["uri": out.absoluteString])
            return
        }
        do {
            try FileManager.default.createDirectory(at: out.deletingLastPathComponent(), withIntermediateDirectories: true)
        } catch {
            call.reject("Could not create the audio cache folder")
            return
        }
        DispatchQueue.main.async {
            let w = AVSpeechSynthesizer()
            self.writer = w
            var file: AVAudioFile?
            var failed = false
            // Written under a temporary name that still ends in .wav (the file type comes from it).
            let part = out.deletingPathExtension().appendingPathExtension("part.wav")
            try? FileManager.default.removeItem(at: part)
            w.write(self.utterance(call)) { buffer in
                guard !failed, let pcm = buffer as? AVAudioPCMBuffer else { return }
                if pcm.frameLength == 0 {
                    // The end: the finished file takes its real name (a half-written part never does).
                    file = nil
                    self.writer = nil
                    try? FileManager.default.removeItem(at: out)
                    do {
                        try FileManager.default.moveItem(at: part, to: out)
                        call.resolve(["uri": out.absoluteString])
                    } catch {
                        call.reject("The voice made no audio for this section")
                    }
                    return
                }
                do {
                    if file == nil {
                        file = try AVAudioFile(forWriting: part, settings: pcm.format.settings, commonFormat: pcm.format.commonFormat, interleaved: pcm.format.isInterleaved)
                    }
                    try file?.write(from: pcm)
                } catch {
                    failed = true
                    self.writer = nil
                    call.reject("The voice could not write this section: \(error.localizedDescription)")
                }
            }
        }
    }

    @objc func clearCache(_ call: CAPPluginCall) {
        try? FileManager.default.removeItem(at: cacheDir.appendingPathComponent("tts"))
        call.resolve()
    }
}
