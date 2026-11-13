import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UIKit

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
        CAPPluginMethod(name: "voices", returnType: CAPPluginReturnPromise)
    ]

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
        call.resolve(["voices": list])
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
        let u = AVSpeechUtterance(string: paras[at])
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
        if synth.isSpeaking { synth.pauseSpeaking(at: .word) }
        playing = false
        sendState()
        updateNowPlaying()
    }

    private func doResume() {
        guard active else { return }
        setUpAudio()
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
            MPMediaItemPropertyTitle: title.isEmpty ? "Paper to Audio" : title,
            MPMediaItemPropertyArtist: author.isEmpty ? "Paper to Audio" : author,
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
        return ["active": active, "uid": uid, "para": index, "playing": playing, "finished": finished]
    }

    private func sendState() {
        notifyListeners("state", data: state())
    }
}
