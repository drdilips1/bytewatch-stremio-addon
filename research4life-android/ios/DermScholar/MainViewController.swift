import UIKit
import WebKit

/// Hosts DermScholar's screens (the same ones as the Android app, plus web/web.js) and does
/// what a web page can't: the in-app browser, sharing, files opened with the app, and fetching
/// other sites (LocalFiles' /proxy).
final class MainViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private(set) var webView: WKWebView!
    private let files = LocalFiles()
    private var ready = false
    private var queued: [[String: Any]] = []

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(files, forURLScheme: LocalFiles.scheme)
        cfg.userContentController.add(WeakScriptHandler(self), name: "ios")
        // The screens can tell which app they run in (update notice, features this app has).
        let info = Bundle.main.infoDictionary ?? [:]
        let clean = { (k: String) in ((info[k] as? String) ?? "").filter { $0.isNumber || $0 == "." } }
        cfg.userContentController.addUserScript(WKUserScript(
            source: "window.DSNative={version:'\(clean("CFBundleShortVersionString"))',build:'\(clean("CFBundleVersion"))',level:\(ScreenUpdates.nativeLevel),proxyApi:\(CollegeProxy.apiAvailable)};",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.isOpaque = false
        wv.backgroundColor = .systemBackground
        if #available(iOS 16.4, *) { wv.isInspectable = true }
        webView = wv
        view = wv
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        files.root = ScreenUpdates.root()
        CollegeProxy.apply()
        webView.load(URLRequest(url: URL(string: "\(LocalFiles.scheme)://app/index.html")!))
        // Downloaded screens that don't start within 20 s: back to the built-in ones.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self = self, !self.ready, self.files.root != ScreenUpdates.bundled else { return }
            ScreenUpdates.reject(self.files.root)
            self.files.root = ScreenUpdates.bundled
            self.webView.reload()
        }
    }

    private var checkedScreens = false
    private lazy var httpSession = URLSession(configuration: .default, delegate: ProxyAuth(), delegateQueue: nil)

    /// UpToDate read inside the app (hidden browser, same logins as the app's browser).
    private lazy var utd: UtdClient = {
        let c = UtdClient(host: view)
        c.onStatus = { [weak self] m in self?.send(["type": "utdStatus", "message": m]) }
        return c
    }()

    // MARK: messages from the screens (web.js)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "ready":
            ready = true
            if !checkedScreens { checkedScreens = true; ScreenUpdates.check(current: files.root) }
            let pending = queued
            queued = []
            pending.forEach { send($0) }
        case "fetchPdf":
            // Get PDF in the background: the app stays usable, progress shows in the tray.
            if let s = body["url"] as? String, let u = MainViewController.url(s), let key = body["key"] as? String, !key.isEmpty {
                // The ways to try in turn (Springer → college proxy → Research4Life).
                var routes: [(name: String, url: URL)] = ((body["fallbacks"] as? [[String: Any]]) ?? []).compactMap { r in
                    guard let n = r["name"] as? String, let s = r["url"] as? String, let v = MainViewController.url(s) else { return nil }
                    return (n, v)
                }
                if routes.isEmpty, (body["springer"] as? Bool) == true, let f = (body["fallback"] as? String).flatMap(MainViewController.url) { routes = [("Research4Life", f)] }
                let route = (body["route"] as? String) ?? ((body["springer"] as? Bool) == true ? "Springer Nature Link" : "")
                fetchInBackground(u, key: key, route: route, fallbacks: routes)
            }
        case "showFetch":
            showFetch(key: body["key"] as? String ?? "", url: (body["url"] as? String).flatMap(MainViewController.url))
        case "cancelFetch":
            if let key = body["key"] as? String, let nav = fetches.removeValue(forKey: key) { detach(nav) }
        case "setProxy":
            CollegeProxy.save(host: body["host"] as? String ?? "", port: body["port"] as? Int ?? 0)
        case "browse":
            if let s = body["url"] as? String, let u = MainViewController.url(s) { openBrowser(u, key: body["key"] as? String ?? "") }
        case "openApp":
            // Another app (MyLOFT, AltStore): each of its links in turn — its own scheme, then its
            // https link as the app's (never the website) — else the App Store / its site.
            var links = ((body["urls"] as? [String]) ?? []).compactMap(URL.init(string:))
            if let s = body["url"] as? String, let u = URL(string: s) { links.append(u) }
            openFirst(links, fallback: (body["store"] as? String).flatMap(URL.init(string:)))
        case "copy":
            UIPasteboard.general.string = body["text"] as? String ?? ""
        case "share":
            share(body)
        case "setCredentials":
            if let p = body["p"] as? String, let u = body["user"] as? String, let pass = body["pass"] as? String, !u.isEmpty, !pass.isEmpty {
                Keychain.save(provider: p, user: u, password: pass)
                if p == "px" { CollegeProxy.apply() }
            }
        case "utdSearch":
            utd.search(body["q"] as? String ?? "") { [weak self] r in self?.send(r.merging(["type": "utdResults"]) { _, n in n }) }
        case "utdTopic":
            utd.topic(body["url"] as? String ?? "") { [weak self] r in self?.send(r.merging(["type": "utdTopic"]) { _, n in n }) }
        case "utdShowPage":
            openBrowser(utd.currentUrl, key: "")
        case "exportSecrets":
            send(["type": "secrets", "id": body["id"] as? String ?? "", "creds": Vault.exportLogins()])
        case "importSecrets":
            let added = Vault.importLogins(body["creds"] as? [String: Any] ?? [:])
            if added["px"] != nil { CollegeProxy.apply() }
            send(["type": "secretsImported", "id": body["id"] as? String ?? "", "added": added])
        case "http":
            // The account sync's requests, made by the app itself (no browser cross-site limits).
            let id = body["id"] as? String ?? ""
            guard let s = body["url"] as? String, let u = URL(string: s), u.scheme == "https" else {
                send(["type": "http", "id": id, "status": 0, "text": "Bad link"]); return
            }
            var req = URLRequest(url: u, timeoutInterval: 30)
            req.httpMethod = body["method"] as? String ?? "GET"
            for (k, v) in (body["headers"] as? [String: String]) ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
            if let b = body["body"] as? String { req.httpBody = Data(b.utf8) }
            httpSession.dataTask(with: req) { [weak self] data, resp, error in
                let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? (error?.localizedDescription ?? "")
                DispatchQueue.main.async { self?.send(["type": "http", "id": id, "status": status, "text": text]) }
            }.resume()
        case "vault":
            // Account-sync crypto for screens without the browser's crypto (see Vault).
            let op = body["op"] as? String ?? ""
            let k = body["key"] as? String ?? ""
            let out: String? = op == "derive" ? Vault.deriveKey(password: body["password"] as? String ?? "", salt: body["salt"] as? String ?? "")
                : op == "seal" ? Vault.seal(key: k, text: body["text"] as? String ?? "")
                : op == "open" ? Vault.open(key: k, blob: body["blob"] as? String ?? "") : nil
            send(["type": "vault", "id": body["id"] as? String ?? "", "out": out ?? NSNull()])
        case "forgetCredentials":
            if let p = body["p"] as? String { Keychain.delete(provider: p) }
        case "done":
            if let id = body["id"] as? String { try? FileManager.default.removeItem(at: LocalFiles.inbox.appendingPathComponent(id)) }
        default:
            break
        }
    }

    /// Sends an event to web.js (WebNative.fromNative); kept until the screens are ready.
    func send(_ evt: [String: Any]) {
        guard ready else { queued.append(evt); return }
        guard let d = try? JSONSerialization.data(withJSONObject: evt), let json = String(data: d, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.WebNative && WebNative.fromNative(\(json)); 0", completionHandler: nil)
    }

    // MARK: files

    /// A file opened with DermScholar from another app.
    func receive(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        let isPdf = url.pathExtension.lowercased() == "pdf"
        hand(data, name: url.lastPathComponent, mime: isPdf ? "application/pdf" : "application/octet-stream", key: "", title: "")
    }

    /// Hands a file to the screens: PDFs are filed under the paper waiting for one (or `key`).
    func hand(_ data: Data, name: String, mime: String, key: String, title: String) {
        let id = UUID().uuidString + (mime == "application/pdf" ? ".pdf" : "")
        do { try data.write(to: LocalFiles.inbox.appendingPathComponent(id)) } catch { return }
        send(["type": "nativeFile", "id": id, "name": name, "mime": mime, "key": key, "title": title])
    }

    // MARK: browser and sharing

    /// A link from the screens; one with characters a URL can't hold (some DOIs) is escaped.
    static func url(_ s: String) -> URL? {
        if let u = URL(string: s) { return u }
        var allowed = CharacterSet.urlQueryAllowed
        allowed.insert(charactersIn: "#")
        return s.addingPercentEncoding(withAllowedCharacters: allowed).flatMap(URL.init(string:))
    }

    /// Get PDF browsers working out of sight, by paper.
    private var fetches: [String: UINavigationController] = [:]

    private func fetchInBackground(_ url: URL, key: String, route: String = "", fallbacks: [(name: String, url: URL)] = []) {
        if let old = fetches.removeValue(forKey: key) { detach(old) }
        let b = BrowserViewController(url: url, key: key)
        b.background = true
        b.routeName = route
        b.fallbacks = fallbacks
        CollegeProxy.setActive(route == "your college proxy")
        b.onPdf = { [weak self] data, name, title in
            self?.hand(data, name: name, mime: "application/pdf", key: key, title: title)
        }
        b.onCredentials = { [weak self] p, user in
            self?.send(["type": "credentialsSaved", "p": p, "user": user])
        }
        b.onStatus = { [weak self] m in self?.send(["type": "fetchStatus", "key": key, "message": m]) }
        b.onFailed = { [weak self] m, notIn in
            CollegeProxy.setActive(false)
            self?.send(["type": "fetchFailed", "key": key, "message": m, "canShow": true, "notInR4L": notIn])
        }
        b.onDone = { [weak self] in
            CollegeProxy.setActive(false)
            guard let self = self, let nav = self.fetches[key], nav.viewControllers.first === b else { return }
            self.fetches.removeValue(forKey: key)
            self.detach(nav)
        }
        let nav = UINavigationController(rootViewController: b)
        b.loadViewIfNeeded()
        addChild(nav)
        nav.view.frame = view.bounds
        nav.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // Present but invisible (as UtdClient): pages in a window keep running their scripts.
        nav.view.alpha = 0.01
        nav.view.isUserInteractionEnabled = false
        view.insertSubview(nav.view, at: 0)
        nav.didMove(toParent: self)
        fetches[key] = nav
    }

    private func detach(_ nav: UINavigationController) {
        nav.willMove(toParent: nil)
        nav.view.removeFromSuperview()
        nav.removeFromParent()
    }

    /// Show page from the tray: the background browser as it is, or else the paper's page.
    private func showFetch(key: String, url: URL?) {
        guard let nav = fetches.removeValue(forKey: key), let b = nav.viewControllers.first as? BrowserViewController else {
            if let u = url { openBrowser(u, key: key) }
            return
        }
        detach(nav)
        nav.view.alpha = 1
        nav.view.isUserInteractionEnabled = true
        b.bringToFront()
        b.onClose = { [weak self] in self?.send(["type": "browserClosed", "key": key]) }
        nav.modalPresentationStyle = .fullScreen
        topPresenter().present(nav, animated: true)
    }

    func openBrowser(_ url: URL, key: String) {
        let scheme = url.scheme?.lowercased() ?? ""
        if scheme != "http" && scheme != "https" {
            UIApplication.shared.open(url)
            return
        }
        let b = BrowserViewController(url: url, key: key)
        b.onPdf = { [weak self] data, name, title in
            self?.hand(data, name: name, mime: "application/pdf", key: key, title: title)
        }
        b.onClose = { [weak self] in self?.send(["type": "browserClosed", "key": key]) }
        b.onCredentials = { [weak self] p, user in
            self?.send(["type": "credentialsSaved", "p": p, "user": user])
        }
        let nav = UINavigationController(rootViewController: b)
        nav.modalPresentationStyle = .fullScreen
        let presenter = topPresenter()
        if presenter is UIAlertController || presenter is UIActivityViewController || presenter.isBeingDismissed {
            presenter.dismiss(animated: false) { [weak self] in self?.topPresenter().present(nav, animated: true) }
        } else {
            presenter.present(nav, animated: true)
        }
        // Never a tap that does nothing: if the browser didn't come up, open the page in Safari.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
            if nav.presentingViewController == nil { UIApplication.shared.open(url) }
        }
    }

    private func share(_ b: [String: Any]) {
        var items: [Any] = []
        if let b64 = b["b64"] as? String, let data = Data(base64Encoded: b64) {
            var name = (b["fileName"] as? String) ?? ""
            if name.isEmpty { name = "DermScholar.txt" }
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(name.replacingOccurrences(of: "/", with: " "))
            do { try data.write(to: file); items.append(file) } catch { return }
        } else if let s = b["url"] as? String, let u = URL(string: s) {
            items.append(u) // a link: apps' share extensions (MyLOFT…) offer to save it
        } else {
            items.append((b["text"] as? String) ?? (b["title"] as? String) ?? "")
        }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        // MyLOFT's "save" closes at once on a link shared from another app (it reads web pages as
        // Safari hands them over): then open the paper in Safari, where Share → MyLOFT saves it.
        if let s = b["url"] as? String, let u = URL(string: s), u.scheme?.hasPrefix("http") == true {
            vc.completionWithItemsHandler = { [weak self] type, completed, _, error in
                guard let self = self, let t = type?.rawValue.lowercased(), t.contains("myloft"), !completed || error != nil else { return }
                self.send(["type": "notice", "message": "MyLOFT didn't take the link from here. The paper is opening in Safari: tap Share → MyLOFT there to save it."])
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { UIApplication.shared.open(u) }
            }
        }
        // iPad: a panel in the middle of the screen, anchored to the view it's shown from.
        let show: (UIViewController) -> Void = { p in
            if let pop = vc.popoverPresentationController, let host = p.view {
                pop.sourceView = host
                pop.sourceRect = CGRect(x: host.bounds.midX, y: host.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
            p.present(vc, animated: true)
        }
        let presenter = topPresenter()
        if presenter is UIAlertController || presenter.isBeingDismissed {
            presenter.dismiss(animated: false) { [weak self] in if let self = self { show(self.topPresenter()) } }
        } else {
            show(presenter)
        }
        // Never a tap that does nothing: if the panel didn't come up, say so (MyLOFT: open its app).
        let forMyLoft = (b["then"] as? String) == "myloft"
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, vc.presentingViewController == nil else { return }
            if forMyLoft {
                self.send(["type": "notice", "message": "The share panel didn't open: the link is copied and MyLOFT is opening. Paste it there."])
                self.openFirst(["myloft://", "https://app.myloft.xyz/"].compactMap(URL.init(string:)), fallback: URL(string: "itms-apps://apps.apple.com/search?term=MyLOFT"))
            } else {
                self.send(["type": "notice", "message": "The share panel didn't open. The link is copied: paste it where you need it."])
            }
        }
    }

    private func openFirst(_ links: [URL], fallback: URL?) {
        guard let u = links.first else {
            if let f = fallback { UIApplication.shared.open(f) } else { send(["type": "notice", "message": "That app isn't installed on this device."]) }
            return
        }
        let only: [UIApplication.OpenExternalURLOptionsKey: Any] = u.scheme == "https" ? [.universalLinksOnly: true] : [:]
        UIApplication.shared.open(u, options: only) { [weak self] ok in
            if !ok { self?.openFirst(Array(links.dropFirst()), fallback: fallback) }
        }
    }

    private func topPresenter() -> UIViewController {
        var v: UIViewController = self
        while let p = v.presentedViewController { v = p }
        return v
    }

    // MARK: navigation: the screens stay in the app; any other link opens in the browser

    /// The college proxy's password pop-up (a Wi-Fi proxy set in Settings): answered with the saved login.
    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        if let c = CollegeProxy.credential(for: challenge) { completionHandler(.useCredential, c) } else { completionHandler(.performDefaultHandling, nil) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { decisionHandler(.allow); return }
        if scheme == LocalFiles.scheme || scheme == "about" || scheme == "blob" || scheme == "data" || action.targetFrame?.isMainFrame == false {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        openBrowser(url, key: "")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { openBrowser(url, key: "") }
        return nil
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        ready = false
        webView.reload()
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        topPresenter().present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        topPresenter().present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        topPresenter().present(a, animated: true)
    }
}

/// Avoids a retain cycle between the web view's content controller and its message handler.
final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
