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
            source: "window.DSNative={version:'\(clean("CFBundleShortVersionString"))',build:'\(clean("CFBundleVersion"))',level:\(ScreenUpdates.nativeLevel)};",
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
        case "browse":
            if let s = body["url"] as? String, let u = MainViewController.url(s) { openBrowser(u, key: body["key"] as? String ?? "") }
        case "openApp":
            // Another app's own link (MyLOFT): its app when installed, else the App Store.
            guard let s = body["url"] as? String, let u = URL(string: s) else { break }
            let store = (body["store"] as? String).flatMap(URL.init(string:))
            // https: only as the app's own link (else the website would open); altstore://… as is.
            let only: [UIApplication.OpenExternalURLOptionsKey: Any] = u.scheme == "https" ? [.universalLinksOnly: true] : [:]
            UIApplication.shared.open(u, options: only) { ok in
                if !ok { UIApplication.shared.open(store ?? u) }
            }
        case "copy":
            UIPasteboard.general.string = body["text"] as? String ?? ""
        case "share":
            share(body)
        case "setCredentials":
            if let p = body["p"] as? String, let u = body["user"] as? String, let pass = body["pass"] as? String, !u.isEmpty, !pass.isEmpty {
                Keychain.save(provider: p, user: u, password: pass)
            }
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
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.maxY - 80, width: 1, height: 1)
        topPresenter().present(vc, animated: true)
    }

    private func topPresenter() -> UIViewController {
        var v: UIViewController = self
        while let p = v.presentedViewController { v = p }
        return v
    }

    // MARK: navigation: the screens stay in the app; any other link opens in the browser

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
