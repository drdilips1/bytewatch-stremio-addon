import Foundation
import Capacitor

/// Send to Kindle on iPhone: downloads the book and e-mails it straight to the Kindle's
/// @kindle.com address through your mail server (SMTP) — Gmail with an app password, Outlook,
/// iCloud… or your own server — with no e-mail app in between. The same `mailFile` call and
/// options as the Android app (InkwellWeb.mailFile → GmailSender), so the app's Send to Kindle
/// code works as it is. Encrypted from the start (SSL, usually 465), upgraded with STARTTLS
/// (usually 587), or plain. Nothing is stored here.
@objc(InkwellMailPlugin)
public class InkwellMailPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "InkwellMailPlugin"
    public let jsName = "InkwellMail"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "mailFile", returnType: CAPPluginReturnPromise)
    ]

    /// Most servers take 25 MB per message; the attachment grows by a third when encoded.
    private static let maxBytes = 18 * 1024 * 1024

    @objc func mailFile(_ call: CAPPluginCall) {
        guard let link = call.getString("url"), let url = URL(string: link) ?? URL(string: link.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") else {
            call.reject("Missing book")
            return
        }
        let name = (call.getString("name") ?? "book.epub").replacingOccurrences(of: "[\\\\/:*?\"<>|]", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        let mime = call.getString("mime") ?? "application/epub+zip"
        let from = call.getString("from") ?? ""
        let password = call.getString("password") ?? ""
        let host = call.getString("host") ?? "smtp.gmail.com"
        let port = call.getInt("port") ?? 465
        let security = call.getString("security") ?? "ssl"
        let user = call.getString("user") ?? from
        let to = (call.getArray("to", String.self) ?? []).filter { !$0.isEmpty }
        if to.isEmpty || from.isEmpty || password.isEmpty {
            call.reject("Missing book, Kindle address or sender")
            return
        }
        Task.detached {
            do {
                let (file, response) = try await URLSession.shared.download(from: url)
                defer { try? FileManager.default.removeItem(at: file) }
                if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
                    throw MailError("the download failed (HTTP \(http.statusCode))")
                }
                let data = try Data(contentsOf: file)
                if Self.looksLikeWebPage(data) { throw MailError("the link gave a web page instead of the ebook file") }
                if data.count > Self.maxBytes { throw MailError("the book is \(data.count / (1024 * 1024)) MB — mail servers send up to about 18 MB") }
                let subject = name.replacingOccurrences(of: "\\.[A-Za-z0-9]{2,5}$", with: "", options: .regularExpression)
                let smtp = SMTP(host: host, port: port, security: security)
                try smtp.send(user: user.isEmpty ? from : user, password: password, from: from, to: to, subject: subject, data: data, fileName: name, mime: mime)
                call.resolve()
            } catch {
                call.reject("Couldn't send it: \((error as? MailError)?.message ?? error.localizedDescription)")
            }
        }
    }

    private static func looksLikeWebPage(_ data: Data) -> Bool {
        let head = String(decoding: data.prefix(256), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return head.hasPrefix("<!doctype html") || head.hasPrefix("<html")
    }
}

struct MailError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

/// A plain blocking SMTP conversation over Foundation streams (they can switch to TLS in the
/// middle of the connection, which STARTTLS needs). Runs on a background task, never the main thread.
final class SMTP {
    private let host: String
    private let port: Int
    private let security: String
    private var input: InputStream!
    private var output: OutputStream!
    private var buffer = Data()
    private var last = ""
    private var server: String { host == "smtp.gmail.com" ? "Gmail" : host }
    private let timeout: TimeInterval = 60

    init(host: String, port: Int, security: String) {
        self.host = host
        self.port = port
        self.security = security
    }

    func send(user: String, password: String, from: String, to: [String], subject: String, data: Data, fileName: String, mime: String) throws {
        try connect()
        defer { input.close(); output.close() }
        try expect(220)
        try command("EHLO audioyam", 250)
        if security == "starttls" {
            // Upgrade the plain connection to an encrypted one, then introduce ourselves again.
            try command("STARTTLS", 220)
            buffer.removeAll()
            startTLS()
            try command("EHLO audioyam", 250)
        }
        try command("AUTH LOGIN", 334)
        try command(b64(user), 334)
        let pass = server == "Gmail" ? password.replacingOccurrences(of: " ", with: "") : password
        if try command(b64(pass), nil) != 235 {
            throw MailError("\(server) didn't accept the password for \(user) (check it in Settings → Send to Kindle)")
        }
        try command("MAIL FROM:<\(from)>", 250)
        for t in to { try command("RCPT TO:<\(t)>", 250) }
        try command("DATA", 354)

        let boundary = "ay-\(UUID().uuidString)"
        let ascii = fileName.unicodeScalars.map { (0x20...0x7e).contains($0.value) ? String($0) : "_" }.joined().replacingOccurrences(of: "\"", with: "'")
        let encodedName = fileName.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ascii
        var head = ""
        head += "From: <\(from)>\r\n"
        head += "To: \(to.joined(separator: ", "))\r\n"
        head += "Subject: \(encodeWord(subject))\r\n"
        head += "MIME-Version: 1.0\r\n"
        head += "Content-Type: multipart/mixed; boundary=\"\(boundary)\"\r\n\r\n"
        head += "--\(boundary)\r\n"
        head += "Content-Type: text/plain; charset=UTF-8\r\n\r\n"
        head += "Sent from Audiohub\r\n\r\n"
        head += "--\(boundary)\r\n"
        head += "Content-Type: \(mime); name=\"\(ascii)\"\r\n"
        head += "Content-Transfer-Encoding: base64\r\n"
        head += "Content-Disposition: attachment; filename=\"\(ascii)\"; filename*=UTF-8''\(encodedName)\r\n\r\n"
        try write(Data(head.utf8))
        // The file, base64 in 76-character lines (no line can start with "." so no dot-stuffing).
        try write(data.base64EncodedData(options: [.lineLength76Characters, .endLineWithCarriageReturn, .endLineWithLineFeed]))
        try write(Data("\r\n--\(boundary)--\r\n.\r\n".utf8))
        try expect(250)
        _ = try? command("QUIT", nil)
    }

    // MARK: the connection

    private func connect() throws {
        var i: InputStream?
        var o: OutputStream?
        Stream.getStreamsToHost(withName: host, port: port, inputStream: &i, outputStream: &o)
        guard let i, let o else { throw MailError("couldn't reach \(server)") }
        input = i
        output = o
        if security == "ssl" { startTLS() }
        input.open()
        output.open()
        let until = Date().addingTimeInterval(timeout)
        while input.streamStatus == .opening || output.streamStatus == .opening {
            if Date() > until { throw MailError("\(server) didn't answer") }
            usleep(20_000)
        }
        if let e = input.streamError ?? output.streamError { throw MailError("couldn't reach \(server): \(e.localizedDescription)") }
    }

    /// TLS on the streams (before opening for SSL; after the server's "go ahead" for STARTTLS).
    /// The server's certificate is checked against its name.
    private func startTLS() {
        input.setProperty(StreamSocketSecurityLevel.negotiatedSSL, forKey: .socketSecurityLevelKey)
        output.setProperty(StreamSocketSecurityLevel.negotiatedSSL, forKey: .socketSecurityLevelKey)
    }

    private func write(_ data: Data) throws {
        var sent = 0
        let until = Date().addingTimeInterval(timeout)
        while sent < data.count {
            if let e = output.streamError { throw MailError("\(server) connection broke: \(e.localizedDescription)") }
            if !output.hasSpaceAvailable {
                if Date() > until { throw MailError("\(server) stopped taking the book") }
                usleep(10_000)
                continue
            }
            let n = data[sent...].withUnsafeBytes { raw -> Int in
                output.write(raw.bindMemory(to: UInt8.self).baseAddress!, maxLength: min(raw.count, 64 * 1024))
            }
            if n < 0 { throw MailError("\(server) connection broke") }
            sent += n
        }
    }

    /// One line from the server (without CRLF).
    private func readLine() throws -> String {
        let until = Date().addingTimeInterval(timeout)
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            if let r = buffer.range(of: Data("\r\n".utf8)) {
                let line = String(decoding: buffer[buffer.startIndex..<r.lowerBound], as: UTF8.self)
                buffer.removeSubrange(buffer.startIndex..<r.upperBound)
                return line
            }
            if let e = input.streamError { throw MailError("\(server) connection broke: \(e.localizedDescription)") }
            if input.streamStatus == .atEnd || input.streamStatus == .closed { throw MailError("\(server) closed the connection") }
            if input.hasBytesAvailable {
                let n = input.read(&chunk, maxLength: chunk.count)
                if n > 0 { buffer.append(chunk, count: n); continue }
                if n < 0 { throw MailError("\(server) connection broke") }
            }
            if Date() > until { throw MailError("\(server) didn't answer") }
            usleep(10_000)
        }
    }

    /// One reply, which may span several "250-…" lines; returns its code.
    private func reply() throws -> Int {
        var line: String
        repeat { line = try readLine() } while line.count > 3 && line[line.index(line.startIndex, offsetBy: 3)] == "-"
        last = line.count > 4 ? String(line.dropFirst(4)) : line
        guard let code = Int(line.prefix(3)) else { throw MailError("\(server) gave an odd answer (\(line))") }
        return code
    }

    @discardableResult
    private func expect(_ code: Int) throws -> Int {
        let got = try reply()
        if got != code { throw MailError("\(server) answered \(got) (\(last))") }
        return got
    }

    /// Send a command and check the reply code (nil: return it unchecked).
    @discardableResult
    private func command(_ line: String, _ expected: Int?) throws -> Int {
        try write(Data((line + "\r\n").utf8))
        if let expected { return try expect(expected) }
        return try reply()
    }

    private func b64(_ v: String) -> String { Data(v.utf8).base64EncodedString() }

    private func encodeWord(_ v: String) -> String {
        v.unicodeScalars.allSatisfy { (0x20...0x7e).contains($0.value) } ? v : "=?UTF-8?B?\(b64(v))?="
    }
}
