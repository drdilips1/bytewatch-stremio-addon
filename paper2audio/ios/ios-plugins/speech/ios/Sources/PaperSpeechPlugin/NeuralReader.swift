import Foundation
import AVFoundation

/// Reads paragraphs with an on-device voice: makes each piece (about a sentence) a few pieces ahead on a
/// background queue and plays them one after another, with a reader's pauses between them (as on Android:
/// Speaker.pauseAfter). Speed beyond what the engine makes itself is applied by the player, pitch kept.
final class NeuralReader {
    struct Piece {
        let para: Int
        let text: String
        let lastInParagraph: Bool
    }

    /// (paragraph being read, playing, finished, error)
    var onState: ((Int, Bool, Bool, String?) -> Void)?

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let pitch = AVAudioUnitTimePitch()
    private let synthQueue = DispatchQueue(label: "p2a.synth", qos: .userInitiated)
    private var format: AVAudioFormat?
    private var run = 0
    private var voice = ""
    private var rate: Float = 1
    private var paras: [String] = []
    private var lang: String?
    private(set) var current = 0
    private(set) var playing = false

    init() {
        engine.attach(player)
        engine.attach(pitch)
    }

    // MARK: - Control (main thread)

    func start(paras: [String], from: Int, voice: String, rate: Float, lang: String?) {
        run += 1
        stopPlayback()
        pending.removeAll()
        self.paras = paras
        self.voice = voice
        self.rate = rate
        self.lang = lang
        current = from
        playing = true
        onState?(current, true, false, nil)
        let myRun = run
        // At most three pieces made ahead of the one playing.
        let ahead = DispatchSemaphore(value: 3)
        let engineSpeed = min(rate, NeuralEngine.maxSpeed(voice))
        let playback: Float = voice.hasPrefix("super:") ? (rate / engineSpeed) * NeuralEngine.supertonicPlayback
            : voice.hasPrefix("clone:") ? rate : rate / engineSpeed
        synthQueue.async { [weak self] in
            self?.makeAhead(run: myRun, from: from, engineSpeed: engineSpeed, playback: playback, ahead: ahead)
        }
    }

    func pause() {
        guard playing else { return }
        player.pause()
        playing = false
        onState?(current, false, false, nil)
    }

    func resume() {
        if !engine.isRunning { try? engine.start() }
        player.play()
        playing = true
        onState?(current, true, false, nil)
    }

    func stop() {
        run += 1
        stopPlayback()
        pending.removeAll()
        playing = false
    }

    private func stopPlayback() {
        player.stop()
        if engine.isRunning { engine.pause() }
    }

    // MARK: - Making ahead (background queue)

    private func piecesOf(_ para: Int) -> [Piece] {
        let text = TextPrep.normalize(paras[para]).trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty || !text.contains(where: { $0.isLetter || $0.isNumber }) { return [] }
        let parts = TextPrep.pieces(text, voice: voice)
        return parts.enumerated().map { Piece(para: para, text: $0.element, lastInParagraph: $0.offset == parts.count - 1) }
    }

    /// Silence after a piece, in seconds (Speaker.pauseAfter, standard style).
    private func pauseAfter(_ p: Piece) -> Double {
        let own = voice.hasPrefix("clone:") ? (VoiceCatalog.reader(String(voice.dropFirst(6)))?.pause ?? 0) : 0
        let sentence = own > 0 ? own : 380
        let paragraph = own > 0 ? max(610, own * 2) : 610
        if p.lastInParagraph { return Double(paragraph) / 1000 }
        guard let last = p.text.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: CharacterSet(charactersIn: "\u{201D}\u{2019}\"')")).last else {
            return 0.12
        }
        switch last {
        case ".", "!", "?", "\u{2026}": return Double(sentence) / 1000
        case ",", ";", ":", "\u{2014}", "\u{2013}": return Double(sentence) / 2000
        default: return 0.12
        }
    }

    private func makeAhead(run myRun: Int, from: Int, engineSpeed: Float, playback: Float, ahead: DispatchSemaphore) {
        var para = from
        var first = true
        while para < paras.count {
            if myRun != run { return }
            for piece in piecesOf(para) {
                // Waits for room ahead, giving up when reading moved on (a seek or stop starts a new run).
                while ahead.wait(timeout: .now() + 0.3) == .timedOut {
                    if myRun != run { return }
                }
                if myRun != run { ahead.signal(); return }
                let audio: NeuralEngine.Audio
                do {
                    audio = try NeuralEngine.shared.synthesize(voice: voice, text: piece.text, speed: engineSpeed, lang: lang)
                } catch {
                    let message = error.localizedDescription
                    DispatchQueue.main.async { [weak self] in
                        guard let self = self, myRun == self.run else { return }
                        self.playing = false
                        self.onState?(self.current, false, false, message)
                    }
                    return
                }
                let isFirst = first
                first = false
                let gap = pauseAfter(piece)
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, myRun == self.run else { ahead.signal(); return }
                    self.schedule(audio, gap: gap, piece: piece, playback: playback, start: isFirst, ahead: ahead, run: myRun)
                }
            }
            para += 1
        }
        // Everything is made: when the last piece has played, the book is finished.
        DispatchQueue.main.async { [weak self] in
            guard let self = self, myRun == self.run else { return }
            let finish = {
                self.playing = false
                self.onState?(self.current, false, true, nil)
            }
            // Nothing was played (nothing left to read): finished now.
            guard let fmt = self.format, self.engine.isRunning || !self.pending.isEmpty,
                  let end = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: 1) else { return finish() }
            end.frameLength = 1
            end.floatChannelData?[0][0] = 0
            self.player.scheduleBuffer(end) { [weak self] in
                DispatchQueue.main.async {
                    guard let self = self, myRun == self.run else { return }
                    finish()
                }
            }
        }
    }

    // MARK: - Playing (main thread)

    private func schedule(_ audio: NeuralEngine.Audio, gap: Double, piece: Piece, playback: Float, start: Bool, ahead: DispatchSemaphore, run myRun: Int) {
        let sr = Double(audio.rate)
        if format?.sampleRate != sr || start {
            let f = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1)!
            if format?.sampleRate != sr {
                engine.disconnectNodeOutput(player)
                engine.disconnectNodeOutput(pitch)
                engine.connect(player, to: pitch, format: f)
                engine.connect(pitch, to: engine.mainMixerNode, format: f)
            }
            format = f
        }
        pitch.rate = max(1.0 / 32, min(32, playback))
        let silence = Int(gap * sr)
        let total = audio.samples.count + silence
        guard let fmt = format, let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(total)), let ch = buf.floatChannelData else {
            ahead.signal()
            return
        }
        buf.frameLength = AVAudioFrameCount(total)
        audio.samples.withUnsafeBufferPointer { src in
            ch[0].update(from: src.baseAddress!, count: audio.samples.count)
        }
        for i in audio.samples.count..<total { ch[0][i] = 0 }
        if start {
            current = piece.para
            if !engine.isRunning { try? engine.start() }
        }
        player.scheduleBuffer(buf) { [weak self] in
            ahead.signal()
            DispatchQueue.main.async {
                guard let self = self, myRun == self.run else { return }
                // The next piece (if made) starts now: its paragraph is the one being read.
                self.advancePast(piece)
            }
        }
        pending.append(piece)
        if start && playing { player.play() }
        if start { onState?(current, playing, false, nil) }
    }

    /// Pieces scheduled and not yet finished, in order.
    private var pending: [Piece] = []

    private func advancePast(_ piece: Piece) {
        if !pending.isEmpty { pending.removeFirst() }
        if let next = pending.first, next.para != current {
            current = next.para
            onState?(current, playing, false, nil)
        }
    }
}
