import UIKit
import WebKit

/// UpToDate inside the app, as on Android (UtdClient.java): a hidden browser with the same logins
/// as the app's browser loads UpToDate's search or topic, signs in with the saved UpToDate login
/// when asked, and reads the results or the article back for the screens.
final class UtdClient: NSObject, WKNavigationDelegate {
    static let base = "https://www.uptodate.com"
    private static let pollSeconds = 0.7
    private static let timeoutSeconds = 60.0
    private static let maxLogins = 2

    var onStatus: ((String) -> Void)?
    private let web: WKWebView
    private var token = 0
    private var kind = ""
    private var target: URL!
    private var request = ""
    private var callback: (([String: Any]) -> Void)?
    private var started = Date()
    private var logins = 0
    private var returnedToTarget = false
    private var continueClicks = 0
    private var lastProgress = Date()
    private var lastPayload: String?
    private var stableCount = 0
    private var lastLength = -1
    private var topicUrl: URL?
    private var triedFullPage = false
    private var stageStarted = Date()
    private var lastReport = Date()

    init(host: UIView) {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        web = WKWebView(frame: host.bounds, configuration: cfg)
        super.init()
        web.customUserAgent = LocalFiles.userAgent
        web.navigationDelegate = self
        // Present but invisible: pages in a window keep running their scripts.
        web.alpha = 0.01
        web.isUserInteractionEnabled = false
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.insertSubview(web, at: 0)
    }

    /// Where the hidden page is now (for Show page).
    var currentUrl: URL { web.url ?? URL(string: UtdClient.base + "/contents/search")! }

    func search(_ query: String, cb: @escaping ([String: Any]) -> Void) {
        var c = URLComponents(string: UtdClient.base + "/contents/search")!
        c.queryItems = [URLQueryItem(name: "search", value: query), URLQueryItem(name: "sp", value: "0"),
                        URLQueryItem(name: "searchType", value: "PLAIN_TEXT"), URLQueryItem(name: "source", value: "USER_INPUT"),
                        URLQueryItem(name: "searchControl", value: "TOP_PULLDOWN"), URLQueryItem(name: "autoComplete", value: "false")]
        start("search", c.url!, query, cb)
    }

    func topic(_ link: String, cb: @escaping ([String: Any]) -> Void) {
        guard let u = URL(string: link), let host = u.host?.lowercased(), host == "uptodate.com" || host.hasSuffix(".uptodate.com") else {
            cb(["state": "error", "message": "Not an UpToDate link"])
            return
        }
        topicUrl = u
        triedFullPage = false
        // The print view is plain text: quicker to load and to read than the full interactive page.
        var c = URLComponents(url: u, resolvingAgainstBaseURL: false)!
        if !c.path.hasSuffix("/print") { c.path = c.path.replacingOccurrences(of: "/+$", with: "", options: .regularExpression) + "/print" }
        start("topic", c.url ?? u, link, cb)
    }

    private func start(_ kind: String, _ url: URL, _ request: String, _ cb: @escaping ([String: Any]) -> Void) {
        token += 1
        self.kind = kind
        target = url
        self.request = request
        callback = cb
        started = Date()
        lastProgress = started
        logins = 0
        returnedToTarget = false
        continueClicks = 0
        lastPayload = nil
        stableCount = 0
        lastLength = -1
        stageStarted = started
        lastReport = started
        report(kind == "search" ? "Searching UpToDate…" : "Opening topic…")
        web.stopLoading()
        web.load(URLRequest(url: url))
        let t = token
        DispatchQueue.main.asyncAfter(deadline: .now() + UtdClient.timeoutSeconds) { [weak self] in self?.hardTimeout(t) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in self?.poll(t) }
    }

    private func tryFullPage() {
        guard let u = topicUrl else { return }
        triedFullPage = true
        target = u
        stageStarted = Date()
        lastPayload = nil
        stableCount = 0
        lastLength = -1
        report("Loading the full topic page…")
        web.load(URLRequest(url: u))
    }

    private func report(_ m: String) { onStatus?(m) }

    static func isLoginUrl(_ u: URL?) -> Bool {
        guard let u = u else { return false }
        let p = u.path.lowercased(), h = (u.host ?? "").lowercased()
        return p.range(of: "login|signin|sign-in|logon|authorize|oauth", options: .regularExpression) != nil
            || h.hasPrefix("login.") || h.hasPrefix("auth.") || h.hasPrefix("id.") || h.contains("wolterskluwer")
    }

    /// The page is the request made (UpToDate's home page is also /contents/search).
    private func atTarget(_ u: URL?) -> Bool {
        guard let u = u, let t = target, u.path == t.path else { return false }
        return kind != "search" || (URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems ?? []).contains { $0.name == "search" }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard callback != nil, let url = webView.url else { return }
        web.evaluateJavaScript(UtdScripts.pro) { [weak self] v, _ in
            if (v as? String) == "clicked" { self?.report("Continuing as a healthcare professional…") }
        }
        if UtdClient.isLoginUrl(url) { signIn(); return }
        // Signed in, but UpToDate usually lands on its home page: go back to the request.
        if logins > 0 && !returnedToTarget && !atTarget(url) {
            returnedToTarget = true
            report(kind == "search" ? "Signed in. Searching…" : "Signed in. Opening topic…")
            web.load(URLRequest(url: target))
        }
    }

    private func signIn() {
        guard let login = Keychain.load(provider: "utd") else {
            finish(["state": "login", "message": "Sign in to UpToDate once to see its results here."])
            return
        }
        if logins >= UtdClient.maxLogins {
            web.evaluateJavaScript(UtdScripts.hint) { [weak self] v, _ in
                guard let self = self, self.callback != nil else { return }
                let where_ = (v as? String) ?? ""
                self.finish(["state": "login", "message": "UpToDate didn't finish signing in" + (where_.isEmpty ? "" : " (the page shows: “\(where_)”)")
                    + ". Tap Show page, finish there, then come back — the app tries again by itself."])
            }
            return
        }
        web.evaluateJavaScript(UtdScripts.pro, completionHandler: nil)
        logins += 1
        lastProgress = Date()
        report("Signing in to UpToDate…")
        // A fresh guard each attempt, so a second try on the same page still runs.
        web.evaluateJavaScript("window.__dsSignIn=0;window.__dsStep1=0;" + SignIn.script(user: login.user, password: login.password, auto: true), completionHandler: nil)
    }

    private func poll(_ t: Int) {
        guard t == token, callback != nil else { return }
        let now = Date()
        if kind == "topic" && !triedFullPage && now.timeIntervalSince(stageStarted) > 12 { tryFullPage() }
        if now.timeIntervalSince(lastReport) > 5 {
            lastReport = now
            report((kind == "search" ? "Searching UpToDate… " : "Loading topic… ") + "\(Int(now.timeIntervalSince(started)))s")
        }
        web.evaluateJavaScript(kind == "search" ? UtdScripts.search : UtdScripts.topic) { [weak self] value, _ in
            guard let self = self, t == self.token, self.callback != nil else { return }
            defer { DispatchQueue.main.asyncAfter(deadline: .now() + UtdClient.pollSeconds) { [weak self] in self?.poll(t) } }
            guard let json = value as? String, let data = json.data(using: .utf8),
                  let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
            let state = o["state"] as? String ?? ""
            let since = Date().timeIntervalSince(self.lastProgress)
            if state == "paywall" {
                // The signed-out preview: go to the sign-in page; after signing in, return to the topic.
                if self.logins < UtdClient.maxLogins && since > 3 {
                    self.lastProgress = Date()
                    if Keychain.load(provider: "utd") == nil {
                        self.finish(["state": "login", "message": "UpToDate shows only a preview until you sign in. Save your UpToDate login in Settings, or tap Show page to sign in once."])
                        return
                    }
                    self.report("UpToDate wants a sign-in: signing in…")
                    self.returnedToTarget = false
                    self.web.load(URLRequest(url: URL(string: UtdClient.base + "/login")!))
                } else if self.logins >= UtdClient.maxLogins {
                    self.finish(["state": "login", "message": "UpToDate still shows only the preview after signing in. Check your login in Settings, or tap Show page."])
                }
            } else if state == "login" {
                // A sign-in form on the page (possibly a pop-up, not a /login address).
                if since > 6 || self.logins == 0 { self.signIn() }
            } else if state == "ok" && self.kind == "topic" && !self.triedFullPage && ((o["html"] as? String) ?? "").count < 3000 {
                // Too little for a topic: the print view probably isn't available; wait for the fallback.
            } else if state == "results" || state == "ok" || state == "empty" {
                // Settled once the content stops growing.
                if json.count <= self.lastLength || json == self.lastPayload { self.stableCount += 1 } else { self.stableCount = 0 }
                self.lastLength = max(self.lastLength, json.count)
                self.lastPayload = json
                if self.stableCount >= 1 && (self.logins == 0 || self.atTarget(self.web.url)) { self.finish(o) }
            } else if since > 5 && self.continueClicks < 4 {
                // Nothing recognisable yet: a notice ("Continue", "Accept", other session) may be waiting.
                self.continueClicks += 1
                self.lastProgress = Date()
                self.web.evaluateJavaScript(UtdScripts.pro, completionHandler: nil)
                self.web.evaluateJavaScript(UtdScripts.proceed) { [weak self] v, _ in
                    if (v as? String) == "clicked" { self?.report("Continuing past an UpToDate notice…") }
                }
            }
        }
    }

    private func hardTimeout(_ t: Int) {
        guard t == token, callback != nil else { return }
        web.stopLoading()
        web.evaluateJavaScript(UtdScripts.hint) { [weak self] v, _ in
            guard let self = self, self.callback != nil else { return }
            let where_ = (v as? String) ?? self.web.title ?? ""
            self.finish(["state": "stuck", "message": "UpToDate is taking too long" + (where_.isEmpty ? "" : " (the page shows: “\(where_)”)")
                + ". Tap Show page to see what it needs, or try again."])
        }
    }

    private func finish(_ result: [String: Any]) {
        guard let cb = callback else { return }
        callback = nil
        token += 1
        var o = result
        o["kind"] = kind
        o["request"] = request
        if o["url"] == nil { o["url"] = web.url?.absoluteString ?? "" }
        cb(o)
    }
}
