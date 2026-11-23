import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UIKit
import Vision

/// Reads the book aloud with the iPhone's own voices, by itself: the page hands over the
/// paragraphs once, then this keeps reading with the screen off or in another app, shows the
/// book on the lock screen (play/pause, next/previous paragraph) and pauses for calls.
/// It tells the page where it is through "state" events, the same as the Android app's engine.
@objc(PaperSpeechPlugin)
public class PaperSpeechPlugin: CAPPlugin, CAPBridgedPlugin, AVSpeechSynthesizerDelegate {
    public let identifier = "PaperSpeechPlugin"
    public let jsName = "PaperSpeech"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "resume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVoice", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "packs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadPack", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeOpened", returnType: CAPPluginReturnPromise)
    ]

    /// Where each chapter starts (paragraph numbers), for the sleep timer's "end of chapter".
    private var chapterStarts: [Int] = []
    /// The listener's pronunciations ("Nguyen" → "Win"), for every voice.
    private var pronounce: [String: String] = [:]
    private var sleepTimer: DispatchSourceTimer?
    private var sleepUntil: Date?
    /// Pause when reading reaches this paragraph (the next chapter's start).
    private var sleepAtPara: Int?
    /// Files opened in the app from elsewhere (Files, Mail, Share → Open in), until the page takes them.
    private var opened: [[String: Any]] = []

    /// Paper to Audio's own voices (Supertonic, Kokoro, real readers), made on the phone.
    private let neural = NeuralReader()
    private var usingNeural = false
    private var lastError: String?
    private var lang: String?

    private let synth = AVSpeechSynthesizer()
    private var paras: [String] = []
    private var index = 0
    private var uid = ""
    private var title = ""
    private var author = ""
    private var rate: Float = 1
    private var voiceId = ""
    private var active = false
    private var playing = false
    private var finished = false
    /// The utterance being spoken: callbacks for older ones (after a seek or stop) are ignored.
    private var current: AVSpeechUtterance?
    private var commandsReady = false

    public override func load() {
        synth.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(openedURL(_:)), name: Notification.Name.capacitorOpenURL, object: nil)
        neural.onState = { [weak self] para, isPlaying, isFinished, error in
            guard let self = self, self.usingNeural else { return }
            self.index = para
            self.playing = isPlaying
            self.finished = isFinished
            self.lastError = error
            self.sendState()
            self.updateNowPlaying()
        }
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)),
                                               name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(routeChanged(_:)),
                                               name: AVAudioSession.routeChangeNotification, object: nil)
    }

    // MARK: - Calls from the page

    @objc func start(_ call: CAPPluginCall) {
        let list: [String] = (call.getArray("paras") ?? []).map { ($0 as? String) ?? "" }
        DispatchQueue.main.async {
            self.paras = list
            self.uid = call.getString("uid") ?? ""
            self.title = call.getString("title") ?? ""
            self.author = call.getString("author") ?? ""
            self.rate = Float(call.getDouble("rate") ?? 1)
            if let v = call.getString("voice"), !v.isEmpty { self.voiceId = v }
            self.lang = call.getString("lang")
            self.chapterStarts = (call.getArray("chapters") ?? []).compactMap { ($0 as? [String: Any])?["para"] as? Int }.sorted()
            if let p = call.getObject("pronounce") {
                self.pronounce = p.compactMapValues { $0 as? String }
            }
            self.active = true
            self.finished = false
            self.setUpAudio()
            self.speak(from: max(0, min(call.getInt("from") ?? 0, max(0, list.count - 1))))
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.doPause()
            call.resolve()
        }
    }

    @objc func resume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.doResume()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.active = false
            self.playing = false
            self.current = nil
            self.synth.stopSpeaking(at: .immediate)
            self.neural.stop()
            self.usingNeural = false
            // The voice model takes a lot of memory: freed when reading stops.
            DispatchQueue.global().async { NeuralEngine.shared.release() }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            self.sendState()
            call.resolve()
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let to = call.getInt("para") ?? 0
        DispatchQueue.main.async {
            guard self.active, !self.paras.isEmpty else { return call.resolve() }
            self.speak(from: max(0, min(to, self.paras.count - 1)))
            call.resolve()
        }
    }

    @objc func setRate(_ call: CAPPluginCall) {
        let r = Float(call.getDouble("rate") ?? 1)
        DispatchQueue.main.async {
            self.rate = r
            // The new speed applies from the start of the paragraph being read.
            if self.active && self.playing { self.speak(from: self.index) }
            call.resolve()
        }
    }

    @objc func setVoice(_ call: CAPPluginCall) {
        let v = call.getString("voice") ?? ""
        DispatchQueue.main.async {
            self.voiceId = v
            if self.active && self.playing { self.speak(from: self.index) }
            call.resolve()
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        DispatchQueue.main.async { call.resolve(self.state()) }
    }

    /// The iPhone's voices, for the voice list (identifier, name, language, quality).
    @objc func voices(_ call: CAPPluginCall) {
        let list = AVSpeechSynthesisVoice.speechVoices().map { v -> [String: Any] in
            var q = "default"
            if v.quality == .enhanced { q = "enhanced" }
            if #available(iOS 16.0, *), v.quality == .premium { q = "premium" }
            return ["id": v.identifier, "name": v.name, "lang": v.language, "quality": q]
        }
        call.resolve(["voices": list, "neural": VoiceCatalog.listForChooser(), "packs": packStatus()])
    }

    // MARK: - Sleep timer (runs here, so it works with the screen off)

    /// {minutes}: pause after that many minutes; -1: at the end of this chapter; 0: off.
    @objc func sleep(_ call: CAPPluginCall) {
        let minutes = call.getInt("minutes") ?? 0
        DispatchQueue.main.async {
            self.sleepTimer?.cancel()
            self.sleepTimer = nil
            self.sleepUntil = nil
            self.sleepAtPara = nil
            if minutes > 0 {
                let t = DispatchSource.makeTimerSource(queue: .main)
                t.schedule(deadline: .now() + .seconds(minutes * 60))
                t.setEventHandler { [weak self] in
                    guard let self = self else { return }
                    self.sleepTimer = nil
                    self.sleepUntil = nil
                    self.doPause()
                }
                t.resume()
                self.sleepTimer = t
                self.sleepUntil = Date().addingTimeInterval(TimeInterval(minutes * 60))
            } else if minutes < 0 {
                // The first chapter start after where reading is now (else the end of the book).
                self.sleepAtPara = self.chapterStarts.first { $0 > self.index } ?? Int.max
            }
            self.sendState()
            call.resolve()
        }
    }

    // MARK: - Text in photos (Apple's on-device text recognition)

    /// {images: [base64 JPEG/PNG]} → {pages: [text]}, lines joined into paragraphs by the gaps between them.
    @objc func recognize(_ call: CAPPluginCall) {
        let images = (call.getArray("images") ?? []).compactMap { $0 as? String }
        DispatchQueue.global(qos: .userInitiated).async {
            var pages: [String] = []
            for b64 in images {
                guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters), let img = UIImage(data: data)?.cgImage else {
                    pages.append("")
                    continue
                }
                let request = VNRecognizeTextRequest()
                request.recognitionLevel = .accurate
                request.usesLanguageCorrection = true
                let handler = VNImageRequestHandler(cgImage: img, orientation: Self.orientation(UIImage(data: data)), options: [:])
                try? handler.perform([request])
                let lines = (request.results ?? []).compactMap { o -> (String, CGRect)? in
                    guard let t = o.topCandidates(1).first?.string else { return nil }
                    return (t, o.boundingBox)
                }.sorted { $0.1.maxY > $1.1.maxY } // top of the page first (Vision measures from the bottom)
                let heights = lines.map { $0.1.height }.sorted()
                let lineHeight = heights.isEmpty ? 0.02 : heights[heights.count / 2]
                var text = ""
                var lastBottom: CGFloat?
                for (t, box) in lines {
                    if let b = lastBottom {
                        if (b - box.maxY) > lineHeight * 0.9 {
                            text += "\n\n" // a bigger gap than between lines: a new paragraph
                        } else if text.hasSuffix("-") {
                            text.removeLast() // a word split at the end of the line
                        } else {
                            text += " "
                        }
                    }
                    text += t
                    lastBottom = box.minY
                }
                pages.append(text)
            }
            call.resolve(["pages": pages])
        }
    }

    private static func orientation(_ image: UIImage?) -> CGImagePropertyOrientation {
        switch image?.imageOrientation ?? .up {
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        default: return .up
        }
    }

    // MARK: - Files opened in the app from elsewhere

    @objc private func openedURL(_ note: Notification) {
        guard let info = note.object as? [String: Any], let url = info["url"] as? URL, url.isFileURL else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let file: [String: Any] = ["name": url.lastPathComponent, "data": data.base64EncodedString()]
        DispatchQueue.main.async {
            self.opened.append(file)
            self.notifyListeners("opened", data: ["count": self.opened.count])
        }
    }

    /// The files opened from elsewhere since last asked ({files: [{name, data (base64)}]}).
    @objc func takeOpened(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let files = self.opened
            self.opened = []
            call.resolve(["files": files])
        }
    }

    // MARK: - Voice packs

    private func packStatus() -> [[String: Any]] {
        VoiceCatalog.packs.map { p in
            ["key": p.key, "title": p.title, "mb": p.mb, "installed": Packs.shared.isInstalled(p), "downloading": Packs.shared.isDownloading(p)]
        }
    }

    @objc func packs(_ call: CAPPluginCall) {
        call.resolve(["packs": packStatus()])
    }

    /// Downloads a voice pack; progress comes as "download" events ({key, progress, message, done, error}).
    @objc func downloadPack(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), let p = VoiceCatalog.packs.first(where: { $0.key == key }) else {
            return call.reject("Unknown voice pack")
        }
        if Packs.shared.isInstalled(p) { return call.resolve(["installed": true]) }
        Packs.shared.install(p, progress: { [weak self] pct, message in
            self?.notifyListeners("download", data: ["key": key, "progress": pct, "message": message, "done": false])
        }, done: { [weak self] error in
            var data: [String: Any] = ["key": key, "progress": error == nil ? 100 : 0, "done": true]
            if let e = error { data["error"] = e }
            self?.notifyListeners("download", data: data)
        })
        call.resolve(["started": true])
    }

    // MARK: - Reading

    private func voice() -> AVSpeechSynthesisVoice? {
        if !voiceId.isEmpty {
            if let v = AVSpeechSynthesisVoice(identifier: voiceId) { return v }
            if let v = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.name == voiceId }) { return v }
        }
        return AVSpeechSynthesisVoice(language: AVSpeechSynthesisVoice.currentLanguageCode())
    }

    private func speak(from i: Int) {
        lastError = nil
        if VoiceCatalog.isNeural(voiceId) {
            // Paper to Audio's own voices: the neural reader makes and plays the audio.
            current = nil
            if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
            usingNeural = true
            finished = false
            index = i
            neural.pronounce = pronounce
            neural.start(paras: paras, from: i, voice: voiceId, rate: rate, lang: lang)
            return
        }
        if usingNeural {
            neural.stop()
            usingNeural = false
        }
        current = nil
        if synth.isSpeaking || synth.isPaused { synth.stopSpeaking(at: .immediate) }
        // Paragraphs with nothing to say (skipped contents, pictures) are passed over.
        var at = i
        while at < paras.count && paras[at].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { at += 1 }
        guard at < paras.count else {
            index = max(0, paras.count - 1)
            playing = false
            finished = true
            sendState()
            updateNowPlaying()
            return
        }
        index = at
        let u = AVSpeechUtterance(string: TextPrep.applyPronunciations(paras[at], pronounce))
        u.voice = voice()
        let base = AVSpeechUtteranceDefaultSpeechRate
        u.rate = min(AVSpeechUtteranceMaximumSpeechRate, max(AVSpeechUtteranceMinimumSpeechRate, base * rate))
        // A short breath after each paragraph, as a reader would take.
        u.postUtteranceDelay = 0.25
        current = u
        playing = true
        finished = false
        synth.speak(u)
        sendState()
        updateNowPlaying()
    }

    private func doPause() {
        guard active else { return }
        if usingNeural {
            neural.pause()
            return
        }
        if synth.isSpeaking { synth.pauseSpeaking(at: .word) }
        playing = false
        sendState()
        updateNowPlaying()
    }

    private func doResume() {
        guard active else { return }
        setUpAudio()
        if usingNeural {
            if finished { speak(from: 0) } else if lastError != nil { speak(from: index) } else { neural.resume() }
            return
        }
        if synth.isPaused {
            synth.continueSpeaking()
            playing = true
            sendState()
            updateNowPlaying()
        } else {
            speak(from: finished ? 0 : index)
        }
    }

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        DispatchQueue.main.async {
            guard utterance === self.current, self.active else { return }
            self.speak(from: self.index + 1)
        }
    }

    // MARK: - Audio session, lock screen, interruptions

    private func setUpAudio() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .spokenAudio, options: [])
        try? s.setActive(true)
        guard !commandsReady else { return }
        commandsReady = true
        DispatchQueue.main.async { UIApplication.shared.beginReceivingRemoteControlEvents() }
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in self?.doResume(); return .success }
        c.pauseCommand.addTarget { [weak self] _ in self?.doPause(); return .success }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            if self.playing { self.doPause() } else { self.doResume() }
            return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            guard let self = self, self.active else { return .commandFailed }
            self.speak(from: min(self.index + 1, max(0, self.paras.count - 1)))
            return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            guard let self = self, self.active else { return .commandFailed }
            self.speak(from: max(0, self.index - 1))
            return .success
        }
    }

    private func updateNowPlaying() {
        guard active else { return }
        let total = max(1, paras.count)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = [
            MPMediaItemPropertyTitle: title.isEmpty ? "Narrato" : title,
            MPMediaItemPropertyArtist: author.isEmpty ? "Narrato" : author,
            MPMediaItemPropertyPlaybackDuration: Double(total),
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(index),
            MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0
        ]
    }

    @objc private func interrupted(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            if type == .began {
                if self.playing { self.doPause() }
            } else if let o = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt,
                      AVAudioSession.InterruptionOptions(rawValue: o).contains(.shouldResume), self.active {
                self.doResume()
            }
        }
    }

    /// Headphones unplugged: pause, as music apps do.
    @objc private func routeChanged(_ note: Notification) {
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
              AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async { if self.playing { self.doPause() } }
    }

    // MARK: - State for the page

    private func state() -> [String: Any] {
        var st: [String: Any] = ["active": active, "uid": uid, "para": index, "playing": playing, "finished": finished, "voice": voiceId,
                                 "total": paras.count]
        if let until = sleepUntil { st["sleep"] = max(0, Int(until.timeIntervalSinceNow)) }
        if sleepAtPara != nil { st["sleep"] = "chapter" }
        if let e = lastError { st["error"] = e }
        return st
    }

    private func sendState() {
        // The sleep timer's "end of chapter": the next chapter has started.
        if let stop = sleepAtPara, index >= stop, playing {
            sleepAtPara = nil
            doPause()
            return
        }
        notifyListeners("state", data: state())
    }
}
