import Foundation
import Capacitor
import UIKit
import AVFoundation
import PDFKit
import UniformTypeIdentifiers

/// Your own audiobooks and ebooks on iPhone, with the same calls as the Android plugin, so the
/// app's "On this phone" code works as it is.
///
/// iPhone apps can't be handed a folder to read whenever they like, so the books live in the
/// app's own folder, which the Files app shows as On My iPhone → Audiohub (the build turns that
/// on). Put books there from the Files app, a computer or AirDrop — or tap Add folder / Add files
/// in the app: what you choose is copied in. Scanning reads that folder: a folder per book
/// ("Author/Title/01.mp3"), loose files one book each, EPUB / PDF as ebooks.
@objc(InkwellLocalPlugin)
public class InkwellLocalPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "InkwellLocalPlugin"
    public let jsName = "InkwellLocal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickFolder", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cover", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickBook", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "incoming", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeIncoming", returnType: CAPPluginReturnPromise)
    ]

    private static let audio: Set<String> = ["mp3", "m4b", "m4a", "aac", "flac", "ogg", "oga", "opus", "wav", "wma", "mka"]
    private static let ebook: Set<String> = ["epub", "pdf"]
    private static let image: Set<String> = ["jpg", "jpeg", "png", "webp"]
    private static let maxFiles = 20000

    /// The picker that's open: what was asked for, and the call to answer.
    private var picking: (call: CAPPluginCall, books: Bool)?

    private var documents: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    // MARK: choosing what to add

    /// Add folder: choose folders or audio files (copied into the Audiohub folder). Always
    /// answers with the Audiohub folder itself — the one the app reads — even if you only
    /// close the picker (books may already be there from the Files app).
    @objc func pickFolder(_ call: CAPPluginCall) {
        var types: [UTType] = [.folder, .audio, .mp3, .mpeg4Audio]
        if let m4b = UTType(filenameExtension: "m4b") { types.append(m4b) }
        present(types, call: call, books: false)
    }

    /// Add files: EPUB / PDF ebooks, copied in. Answers { books: [{ path, name, format, size }] }.
    @objc func pickBook(_ call: CAPPluginCall) {
        var types: [UTType] = [.pdf]
        if let epub = UTType(filenameExtension: "epub") { types.append(epub) }
        present(types, call: call, books: true)
    }

    private func present(_ types: [UTType], call: CAPPluginCall, books: Bool) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("The picker can't open right now")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: false)
            picker.allowsMultipleSelection = true
            picker.delegate = self
            self.picking = (call, books)
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let open = picking else { return }
        picking = nil
        let call = open.call, books = open.books
        // Copying a long audiobook takes a while: off the main thread.
        DispatchQueue.global(qos: .userInitiated).async {
            let into = books ? self.documents.appendingPathComponent("Ebooks", isDirectory: true) : self.documents
            try? FileManager.default.createDirectory(at: into, withIntermediateDirectories: true)
            var added: [[String: Any]] = []
            var failed = ""
            for url in urls {
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                let target = self.freeName(in: into, for: url.lastPathComponent)
                do {
                    try FileManager.default.copyItem(at: url, to: target)
                    let ext = target.pathExtension.lowercased()
                    added.append([
                        "path": target.path,
                        "name": target.lastPathComponent,
                        "format": ext == "pdf" ? "PDF" : "EPUB",
                        "size": self.size(of: target)
                    ])
                } catch {
                    failed = "Couldn't copy \(url.lastPathComponent): \(error.localizedDescription)"
                }
            }
            if books {
                if added.isEmpty && !failed.isEmpty { call.reject(failed) } else { call.resolve(["books": added]) }
            } else {
                call.resolve(self.folderAnswer())
            }
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let open = picking else { return }
        picking = nil
        let call = open.call, books = open.books
        if books { call.reject("cancelled") } else { call.resolve(folderAnswer()) }
    }

    private func folderAnswer() -> [String: Any] {
        ["uri": documents.absoluteString, "name": "Audiohub folder (Files app)"]
    }

    /// "Book.mp3" taken already: "Book 2.mp3".
    private func freeName(in dir: URL, for name: String) -> URL {
        var url = dir.appendingPathComponent(name)
        let base = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        return url
    }

    private func size(of url: URL) -> Int {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
    }

    // MARK: reading the folder

    /// { files: [{ uri, name, dir, size }], covers: [{ uri, dir }] } — as the Android plugin.
    @objc func scan(_ call: CAPPluginCall) {
        let given = call.getString("uri") ?? ""
        // The folder saved before an app update has moved: read today's Audiohub folder.
        let saved = URL(string: given).flatMap { $0.isFileURL ? $0 : nil }
        let root = saved.flatMap { FileManager.default.fileExists(atPath: $0.path) ? $0 : nil } ?? documents
        DispatchQueue.global(qos: .userInitiated).async {
            var files: [[String: Any]] = []
            var covers: [[String: Any]] = []
            let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey]
            let walker = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles, .skipsPackageDescendants])
            let rootPath = root.standardizedFileURL.path
            while let url = walker?.nextObject() as? URL {
                if files.count >= Self.maxFiles { break }
                let values = try? url.resourceValues(forKeys: Set(keys))
                if values?.isDirectory == true {
                    if url.lastPathComponent == ".Trash" { walker?.skipDescendants() }
                    continue
                }
                let ext = url.pathExtension.lowercased()
                var dir = url.deletingLastPathComponent().standardizedFileURL.path
                dir = dir.hasPrefix(rootPath) ? String(dir.dropFirst(rootPath.count)) : dir
                dir = dir.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                if Self.audio.contains(ext) || Self.ebook.contains(ext) {
                    files.append(["uri": url.absoluteString, "name": url.lastPathComponent, "dir": dir, "size": values?.fileSize ?? 0])
                } else if Self.image.contains(ext) {
                    covers.append(["uri": url.absoluteString, "dir": dir])
                }
            }
            call.resolve(["files": files, "covers": covers])
        }
    }

    // MARK: covers

    /// A small JPEG cover in the app's caches: the folder's image, else the art inside the
    /// audio file, else an ebook's cover (sent as data) or a PDF's first page. { path } ("" = none).
    @objc func cover(_ call: CAPPluginCall) {
        let image = call.getString("image") ?? ""
        let audio = call.getString("audio") ?? ""
        let pdf = call.getString("pdf") ?? ""
        let data = call.getString("data") ?? ""
        let key = (call.getString("key") ?? "cover").replacingOccurrences(of: "[^A-Za-z0-9_-]", with: "_", options: .regularExpression)
        DispatchQueue.global(qos: .utility).async {
            let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("local-covers", isDirectory: true)
            try? FileManager.default.createDirectory(at: caches, withIntermediateDirectories: true)
            let out = caches.appendingPathComponent(key + ".jpg")
            if FileManager.default.fileExists(atPath: out.path) {
                call.resolve(["path": out.path])
                return
            }
            var picture: UIImage?
            if !image.isEmpty, let url = Self.fileURL(image) { picture = UIImage(contentsOfFile: url.path) }
            if picture == nil, !audio.isEmpty, let url = Self.fileURL(audio) {
                let asset = AVURLAsset(url: url)
                for item in asset.commonMetadata where item.commonKey == .commonKeyArtwork {
                    if let d = item.dataValue, let img = UIImage(data: d) { picture = img; break }
                }
            }
            if picture == nil, !data.isEmpty, let d = Data(base64Encoded: data, options: .ignoreUnknownCharacters) { picture = UIImage(data: d) }
            if picture == nil, !pdf.isEmpty, let url = Self.fileURL(pdf), let doc = PDFDocument(url: url), let page = doc.page(at: 0) {
                picture = page.thumbnail(of: CGSize(width: 500, height: 700), for: .mediaBox)
            }
            guard let img = picture, let jpeg = Self.small(img).jpegData(compressionQuality: 0.85) else {
                call.resolve(["path": ""])
                return
            }
            do {
                try jpeg.write(to: out)
                call.resolve(["path": out.path])
            } catch {
                call.resolve(["path": ""])
            }
        }
    }

    /// At most ~500 px wide, so covers stay small.
    private static func small(_ img: UIImage) -> UIImage {
        let w = img.size.width
        guard w > 500 else { return img }
        let size = CGSize(width: 500, height: img.size.height * 500 / w)
        return UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
    }

    /// "file:///…" or a plain path.
    private static func fileURL(_ s: String) -> URL? {
        if s.hasPrefix("file:") { return URL(string: s) }
        if s.hasPrefix("/") { return URL(fileURLWithPath: s) }
        return nil
    }

    // MARK: ebooks opened with Audiohub (not on iPhone yet)

    @objc func incoming(_ call: CAPPluginCall) {
        call.resolve([:])
    }

    /// Remove a copy that was added (Add files).
    @objc func removeIncoming(_ call: CAPPluginCall) {
        if let path = call.getString("path"), path.hasPrefix(documents.path) {
            try? FileManager.default.removeItem(atPath: path)
        }
        call.resolve()
    }
}
