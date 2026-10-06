import Foundation
import WebKit

/// Serves the app's screens from the bundle at dsapp://app/…, files handed over by the native side
/// at /native/<id>, and /proxy?u=<url>: another site fetched natively, without the browser's
/// cross-site limits (like the Android app's /proxy/), with the in-app browser's logins.
final class LocalFiles: NSObject, WKURLSchemeHandler {
    static let scheme = "dsapp"
    static let userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    static let inbox: URL = {
        let u = FileManager.default.temporaryDirectory.appendingPathComponent("inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()

    /// The screens being served: the built-in ones, or newer downloaded ones (ScreenUpdates).
    var root = ScreenUpdates.bundled
    private var stopped = Set<ObjectIdentifier>()
    private lazy var session: URLSession = {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 60
        return URLSession(configuration: c, delegate: ProxyAuth(), delegateQueue: nil)
    }()

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path
        if path == "/proxy" { proxy(task, url); return }
        if path.hasPrefix("/native/") {
            let id = String(path.dropFirst("/native/".count)).replacingOccurrences(of: "/", with: "")
            serveFile(task, LocalFiles.inbox.appendingPathComponent(id), url: url)
            return
        }
        let rel = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let file = root.appendingPathComponent(rel.isEmpty ? "index.html" : rel).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path) else { respond(task, url: url, status: 403, mime: "text/plain", data: Data()); return }
        serveFile(task, file, url: url)
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func serveFile(_ task: WKURLSchemeTask, _ file: URL, url: URL) {
        guard let data = try? Data(contentsOf: file) else {
            respond(task, url: url, status: 404, mime: "text/plain", data: Data("Not found".utf8))
            return
        }
        respond(task, url: url, status: 200, mime: LocalFiles.mime(file.pathExtension), data: data)
    }

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, mime: String, data: Data, extra: [String: String] = [:]) {
        let id = ObjectIdentifier(task)
        if stopped.contains(id) { stopped.remove(id); return }
        var headers = ["Content-Type": mime, "Content-Length": String(data.count), "Access-Control-Allow-Origin": "*", "Cache-Control": "no-cache"]
        for (k, v) in extra { headers[k] = v }
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else { return }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    private func proxy(_ task: WKURLSchemeTask, _ url: URL) {
        guard let s = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "u" })?.value,
              let target = URL(string: s), ["http", "https"].contains(target.scheme?.lowercased() ?? "") else {
            respond(task, url: url, status: 400, mime: "text/plain", data: Data("Bad link".utf8))
            return
        }
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            var req = URLRequest(url: target)
            req.setValue(LocalFiles.userAgent, forHTTPHeaderField: "User-Agent")
            Cookies.apply(cookies, to: &req)
            self.session.dataTask(with: req) { data, resp, error in
                DispatchQueue.main.async {
                    let http = resp as? HTTPURLResponse
                    if let data = data, let http = http {
                        let type = http.value(forHTTPHeaderField: "Content-Type") ?? (http.mimeType ?? "application/octet-stream")
                        self.respond(task, url: url, status: http.statusCode, mime: type, data: data,
                                     extra: ["X-Final-Url": http.url?.absoluteString ?? s])
                    } else {
                        self.respond(task, url: url, status: 502, mime: "text/plain", data: Data((error?.localizedDescription ?? "Couldn't open that page").utf8))
                    }
                }
            }.resume()
        }
    }

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        case "pdf": return "application/pdf"
        case "wasm": return "application/wasm"
        case "txt", "md": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}

/// Cookies from the in-app browser, so native downloads use its Research4Life/MyLOFT/journal logins.
enum Cookies {
    static func apply(_ cookies: [HTTPCookie], to req: inout URLRequest) {
        guard let url = req.url, let host = url.host?.lowercased() else { return }
        let path = url.path.isEmpty ? "/" : url.path
        let matching = cookies.filter { c in
            var d = c.domain.lowercased()
            if d.hasPrefix(".") { d.removeFirst() }
            let hostOk = host == d || host.hasSuffix("." + d)
            let pathOk = path.hasPrefix(c.path)
            let secureOk = !c.isSecure || url.scheme?.lowercased() == "https"
            let fresh = c.expiresDate.map { $0 > Date() } ?? true
            return hostOk && pathOk && secureOk && fresh
        }
        for (k, v) in HTTPCookie.requestHeaderFields(with: matching) { req.setValue(v, forHTTPHeaderField: k) }
    }
}

/// Answers the college proxy's password request (a Wi-Fi proxy set in Settings) for the app's own fetches.
final class ProxyAuth: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if let c = CollegeProxy.credential(for: challenge) { completionHandler(.useCredential, c) } else { completionHandler(.performDefaultHandling, nil) }
    }
}
