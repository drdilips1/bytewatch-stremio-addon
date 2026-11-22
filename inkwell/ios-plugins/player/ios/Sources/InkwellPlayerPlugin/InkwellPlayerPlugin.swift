import Foundation
import Capacitor
import AVFoundation
import MediaPlayer
import UIKit

/// The audiobook player on iPhone / iPad, with the same calls and events as the Android player
/// (InkwellPlayerPlugin.java), so the app's player code works as it is.
///
/// Apple's own player (AVQueuePlayer) streams big single-file books from TorBox / Real-Debrid
/// far better than the web view's audio did (it buffered and stopped), sends a sign-in with every
/// request (Easynews, your server), plays with the screen off, and shows the lock-screen controls.
///
/// Events: "state", "progress", "ended", "error", "advanced", "remote" — as on Android.
@objc(InkwellPlayerPlugin)
public class InkwellPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkwellPlayerPlugin"
    public let jsName = "InkwellPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "queue", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSkips", returnType: CAPPluginReturnPromise),
        // Android-only extras: accepted, nothing to do here.
        CAPPluginMethod(name: "setSkipSilence", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBoost", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSleepDetect", returnType: CAPPluginReturnPromise)
    ]

    private var player: AVQueuePlayer?
    /// The parts loaded, in order: the one `load` started, then those `queue` added after it.
    private var items: [AVPlayerItem] = []
    private var headers: [String: String] = [:]
    private var rate: Float = 1
    private var wantPlay = false
    private var ended = false
    private var timeObserver: Any?
    private var statusObserver: NSKeyValueObservation?
    private var itemObservers: [NSKeyValueObservation] = []
    private var skipForward: Double = 30
    private var skipBack: Double = 15
    private var nowInfo: [String: Any] = [:]
    private var remoteReady = false

    // MARK: setup

    private func ensurePlayer() -> AVQueuePlayer {
        if let p = player { return p }
        let p = AVQueuePlayer()
        p.automaticallyWaitsToMinimizeStalling = true
        p.actionAtItemEnd = .advance
        player = p
        // Every half second: where we are (the app's progress bar, your saved place).
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            self?.emit("progress")
            self?.updateNowPlaying()
        }
        statusObserver = p.observe(\.timeControlStatus, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.emit("state"); self?.updateNowPlaying() }
        }
        NotificationCenter.default.addObserver(self, selector: #selector(itemEnded(_:)), name: .AVPlayerItemDidPlayToEndTime, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(interrupted(_:)), name: AVAudioSession.interruptionNotification, object: nil)
        setupRemote()
        return p
    }

    private func activateSession() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .spokenAudio, options: [])
        try? s.setActive(true)
    }

    /// An address the player can open: web links as they are; the app's own file links
    /// ("/_capacitor_file_/…", "capacitor://localhost/_capacitor_file_/…") as the files themselves.
    private func urlOf(_ s: String) -> URL? {
        if let r = s.range(of: "/_capacitor_file_") {
            let path = String(s[r.upperBound...]).removingPercentEncoding ?? String(s[r.upperBound...])
            return URL(fileURLWithPath: path)
        }
        if s.hasPrefix("file:") || s.hasPrefix("http:") || s.hasPrefix("https:") { return URL(string: s) ?? Self.encoded(s) }
        if s.hasPrefix("/") { return URL(fileURLWithPath: s) }
        return URL(string: s) ?? Self.encoded(s)
    }

    /// A link with spaces or brackets left in (some file servers hand them out like that): older
    /// iOS won't take it as it is, so those characters are encoded (what's already encoded stays).
    private static func encoded(_ s: String) -> URL? {
        var allowed = CharacterSet.urlQueryAllowed
        allowed.insert(charactersIn: "%#")
        return s.addingPercentEncoding(withAllowedCharacters: allowed).flatMap { URL(string: $0) }
    }

    /// `mime`: the file's type from its name ("video/mp4" for an audiobook packed as .mp4). Cloud
    /// links often have no extension and say "plain file": Apple's player works MP3 out by itself
    /// but won't open an MP4 it isn't told about (it played on Android, not here).
    private func makeItem(_ address: String, mime: String? = nil) -> AVPlayerItem? {
        guard let url = urlOf(address) else { return nil }
        var options: [String: Any] = url.isFileURL || headers.isEmpty ? [:] : ["AVURLAssetHTTPHeaderFieldsKey": headers]
        if let m = mime, !m.isEmpty, !url.isFileURL { options["AVURLAssetOutOfBandMIMETypeKey"] = m }
        let item = AVPlayerItem(asset: AVURLAsset(url: url, options: options))
        item.preferredForwardBufferDuration = 120 // a long lead rides out patchy mobile data
        item.audioTimePitchAlgorithm = .timeDomain // speech at 1.5× without chipmunks
        let obs = item.observe(\.status, options: [.new]) { [weak self] it, _ in
            if it.status == .readyToPlay {
                // An .mp4 audiobook carries a still picture as video: switched off, so iOS keeps
                // playing it with the screen locked (it pauses players that show video).
                for t in it.tracks where t.assetTrack?.mediaType == .video { t.isEnabled = false }
                return
            }
            guard it.status == .failed else { return }
            DispatchQueue.main.async { self?.failed(it) }
        }
        itemObservers.append(obs)
        return item
    }

    // MARK: calls from the app

    @objc func load(_ call: CAPPluginCall) {
        guard let address = call.getString("url"), !address.isEmpty else { call.reject("Missing url"); return }
        var h: [String: String] = [:]
        for (k, v) in call.getObject("headers") ?? [:] { if let s = v as? String { h[k] = s } }
        let position = call.getDouble("position") ?? 0
        let autoplay = call.getBool("autoplay") ?? true
        let mime = call.getString("mime")
        rate = Float(call.getDouble("rate") ?? 1)
        DispatchQueue.main.async {
            self.headers = h
            let p = self.ensurePlayer()
            self.activateSession()
            p.pause()
            p.removeAllItems()
            self.items = []
            self.itemObservers = []
            self.ended = false
            guard let item = self.makeItem(address, mime: mime) else { call.reject("Can't open that address"); return }
            self.items = [item]
            p.insert(item, after: nil)
            if position > 0 { item.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero, completionHandler: nil) }
            self.nowInfo = [
                MPMediaItemPropertyTitle: call.getString("title") ?? "",
                MPMediaItemPropertyArtist: call.getString("artist") ?? "",
                MPMediaItemPropertyAlbumTitle: call.getString("album") ?? ""
            ]
            self.loadArtwork(call.getString("artwork") ?? "")
            self.wantPlay = autoplay
            if autoplay { p.playImmediately(atRate: self.rate) }
            self.emit("state")
            call.resolve()
        }
    }

    /// Replace what plays after the current part: [{ url, title, … }].
    @objc func queue(_ call: CAPPluginCall) {
        let list: [JSObject] = (call.getArray("items") ?? []).compactMap { $0 as? JSObject }
        DispatchQueue.main.async {
            let p = self.ensurePlayer()
            let cur = self.currentIndex()
            // Drop the parts after the current one, then add the new ones.
            for it in self.items.suffix(from: min(self.items.count, cur + 1)) { p.remove(it) }
            self.items = Array(self.items.prefix(cur + 1))
            var last = self.items.last
            for x in list {
                guard let address = x["url"] as? String, !address.isEmpty, let item = self.makeItem(address, mime: x["mime"] as? String) else { continue }
                p.insert(item, after: last)
                self.items.append(item)
                last = item
            }
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let p = self.ensurePlayer()
            self.activateSession()
            if self.ended, let first = self.items.first {
                // At the end: from the start of the last part again (as Android does).
                self.ended = false
                if p.currentItem == nil { p.insert(first, after: nil) }
                p.seek(to: .zero)
            }
            self.wantPlay = true
            p.playImmediately(atRate: self.rate)
            self.emit("state")
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.wantPlay = false
            self.player?.pause()
            self.emit("state")
            call.resolve()
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let to = max(0, call.getDouble("position") ?? 0)
        DispatchQueue.main.async {
            self.player?.seek(to: CMTime(seconds: to, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                DispatchQueue.main.async { self.emit("progress") }
            }
            call.resolve()
        }
    }

    @objc func setRate(_ call: CAPPluginCall) {
        rate = Float(call.getDouble("rate") ?? 1)
        DispatchQueue.main.async {
            if let p = self.player, p.timeControlStatus != .paused || self.wantPlay { p.rate = self.rate }
            self.updateNowPlaying()
            call.resolve()
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        let v = Float(call.getDouble("volume") ?? 1)
        DispatchQueue.main.async {
            self.player?.volume = max(0, min(1, v))
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.wantPlay = false
            self.player?.pause()
            self.player?.removeAllItems()
            self.items = []
            self.itemObservers = []
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            self.emit("state")
            call.resolve()
        }
    }

    /// Skip lengths (Settings), for the lock screen's and headphones' skip buttons.
    @objc func setSkips(_ call: CAPPluginCall) {
        skipForward = max(5, call.getDouble("forward") ?? 30)
        skipBack = max(5, call.getDouble("back") ?? 15)
        DispatchQueue.main.async {
            let c = MPRemoteCommandCenter.shared()
            c.skipForwardCommand.preferredIntervals = [NSNumber(value: self.skipForward)]
            c.skipBackwardCommand.preferredIntervals = [NSNumber(value: self.skipBack)]
            call.resolve()
        }
    }

    @objc func setSkipSilence(_ call: CAPPluginCall) { call.resolve() }
    @objc func setBoost(_ call: CAPPluginCall) { call.resolve() }
    @objc func setSleepDetect(_ call: CAPPluginCall) { call.resolve() }

    // MARK: events

    private func currentIndex() -> Int {
        guard let cur = player?.currentItem, let i = items.firstIndex(of: cur) else { return max(0, items.count - 1) }
        return i
    }

    private func snapshot() -> [String: Any] {
        guard let p = player else { return [:] }
        let item = p.currentItem
        let pos = item.map { CMTimeGetSeconds($0.currentTime()) } ?? 0
        let d = item.map { CMTimeGetSeconds($0.duration) } ?? 0
        let buffered = item?.loadedTimeRanges.last.map { r -> Double in
            let tr = r.timeRangeValue
            return CMTimeGetSeconds(tr.start) + CMTimeGetSeconds(tr.duration)
        } ?? 0
        return [
            "position": pos.isFinite ? pos : 0,
            "duration": d.isFinite ? d : 0,
            "buffered": buffered.isFinite ? buffered : 0,
            "playing": p.timeControlStatus == .playing,
            "playWhenReady": wantPlay,
            "buffering": p.timeControlStatus == .waitingToPlayAtSpecifiedRate,
            "ended": ended,
            "item": currentIndex(),
            "idle": item == nil && !ended,
            "suppressed": false
        ]
    }

    private func emit(_ name: String) {
        notifyListeners(name, data: snapshot())
    }

    @objc private func itemEnded(_ n: Notification) {
        guard let done = n.object as? AVPlayerItem, let i = items.firstIndex(of: done) else { return }
        DispatchQueue.main.async {
            if i + 1 < self.items.count {
                // Moved on to the next queued part by itself: tell the app which one.
                self.notifyListeners("advanced", data: ["item": i + 1])
                self.emit("progress")
            } else {
                self.ended = true
                self.wantPlay = false
                self.emit("state")
                self.notifyListeners("ended", data: [:])
            }
        }
    }

    private func failed(_ item: AVPlayerItem) {
        let e = item.error as NSError?
        var message = e?.localizedDescription ?? "Playback failed"
        if let underlying = e?.userInfo[NSUnderlyingErrorKey] as? NSError {
            if underlying.code == -1009 { message = "No internet connection" }
            else if underlying.code == -1001 { message = "The server took too long to answer" }
            else if underlying.domain == "CoreMediaErrorDomain" && underlying.code == -12938 { message = "The file was not found on the server (HTTP 404)." }
        }
        // Apple's bare "Cannot Open": the player didn't recognise the file's format.
        if e?.domain == AVFoundationErrorDomain && (e?.code == -11828 || e?.code == -11829) {
            message = "iPhone couldn't open this file's format"
        }
        notifyListeners("error", data: ["code": "\(e?.code ?? 0)", "message": message])
    }

    /// A call or another app took the audio: when it hands back, carry on if we were playing.
    @objc private func interrupted(_ n: Notification) {
        guard let info = n.userInfo, let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt, let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        DispatchQueue.main.async {
            if type == .ended {
                let opts = AVAudioSession.InterruptionOptions(rawValue: (info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0)
                if opts.contains(.shouldResume) && self.wantPlay {
                    self.activateSession()
                    self.player?.playImmediately(atRate: self.rate)
                }
            }
            self.emit("state")
        }
    }

    // MARK: lock screen and headphones

    private func setupRemote() {
        guard !remoteReady else { return }
        remoteReady = true
        UIApplication.shared.beginReceivingRemoteControlEvents()
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            guard let self = self, let p = self.player else { return .commandFailed }
            self.activateSession()
            self.wantPlay = true
            p.playImmediately(atRate: self.rate)
            return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            self?.wantPlay = false
            self?.player?.pause()
            return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self, let p = self.player else { return .commandFailed }
            if p.timeControlStatus == .paused { self.wantPlay = true; p.playImmediately(atRate: self.rate) } else { self.wantPlay = false; p.pause() }
            return .success
        }
        c.skipForwardCommand.preferredIntervals = [NSNumber(value: skipForward)]
        c.skipBackwardCommand.preferredIntervals = [NSNumber(value: skipBack)]
        c.skipForwardCommand.addTarget { [weak self] _ in self?.skip(self?.skipForward ?? 30, "next"); return .success }
        c.skipBackwardCommand.addTarget { [weak self] _ in self?.skip(-(self?.skipBack ?? 15), "previous"); return .success }
        // Next / previous track buttons (car, some headphones): the same skips, as on Android.
        c.nextTrackCommand.addTarget { [weak self] _ in self?.skip(self?.skipForward ?? 30, "next"); return .success }
        c.previousTrackCommand.addTarget { [weak self] _ in self?.skip(-(self?.skipBack ?? 15), "previous"); return .success }
        c.changePlaybackPositionCommand.addTarget { [weak self] e in
            guard let e = e as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.player?.seek(to: CMTime(seconds: e.positionTime, preferredTimescale: 600))
            return .success
        }
    }

    /// Skip within the part here; across into another part, the app does it (it knows the parts).
    private func skip(_ seconds: Double, _ action: String) {
        DispatchQueue.main.async {
            guard let p = self.player, let item = p.currentItem else { return }
            let pos = CMTimeGetSeconds(item.currentTime())
            let d = CMTimeGetSeconds(item.duration)
            let to = pos + seconds
            if d.isFinite && to >= 0 && to < d - 1 {
                p.seek(to: CMTime(seconds: to, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
                self.emit("progress")
            } else if to < 0 && self.currentIndex() == 0 {
                p.seek(to: .zero)
                self.emit("progress")
            } else {
                self.notifyListeners("remote", data: ["action": action])
            }
        }
    }

    private func updateNowPlaying() {
        guard let p = player, let item = p.currentItem else { return }
        var info = nowInfo
        let pos = CMTimeGetSeconds(item.currentTime())
        let d = CMTimeGetSeconds(item.duration)
        if pos.isFinite { info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = pos }
        if d.isFinite && d > 0 { info[MPMediaItemPropertyPlaybackDuration] = d }
        info[MPNowPlayingInfoPropertyPlaybackRate] = p.timeControlStatus == .playing ? Double(rate) : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    /// The cover for the lock screen: a web picture, a picture kept in the app, or a data: image.
    private func loadArtwork(_ art: String) {
        guard !art.isEmpty else { return }
        let set: (UIImage) -> Void = { [weak self] img in
            DispatchQueue.main.async {
                self?.nowInfo[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                self?.updateNowPlaying()
            }
        }
        if art.hasPrefix("data:"), let comma = art.firstIndex(of: ","), art[..<comma].contains(";base64") {
            if let d = Data(base64Encoded: String(art[art.index(after: comma)...]), options: .ignoreUnknownCharacters), let img = UIImage(data: d) { set(img) }
            return
        }
        if let r = art.range(of: "/_capacitor_file_") {
            let path = String(art[r.upperBound...]).removingPercentEncoding ?? ""
            if let img = UIImage(contentsOfFile: path) { set(img) }
            return
        }
        guard let url = URL(string: art.replacingOccurrences(of: "http://", with: "https://")), url.scheme == "https" else { return }
        URLSession.shared.dataTask(with: url) { data, _, _ in
            if let data = data, let img = UIImage(data: data) { set(img) }
        }.resume()
    }
}
