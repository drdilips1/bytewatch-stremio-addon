import UIKit
import WebKit

/// The app's own browser for Research4Life, UpToDate, MyLOFT and journals. Logins are kept (the
/// shared cookie store). A PDF opened here goes into the library: automatically when the browser
/// was opened to get a paper's PDF (`key`), otherwise with the Save PDF button.
final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var onPdf: ((Data, String, String) -> Void)?
    /// A login typed on a sign-in page (provider, user): saved in the Keychain, shown in Settings.
    var onCredentials: ((String, String) -> Void)?
    private var autoSignIns = 0
    private var signedIn = false
    private var reopened = false
    /// Where the browser starts: an Elsevier article first goes through Research4Life's
    /// ClinicalKey link (or its portal, to tap ClinicalKey once), then to the article.
    private var firstURL: URL
    private var ckArticle: URL?
    private var fromR4LPage = false
    private var chainStart: URL?

    private let startURL: URL
    private let key: String
    private var webView: WKWebView!
    private var pdfURL: URL?
    private var fetching = Set<String>()
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var observers: [NSKeyValueObservation] = []
    private lazy var saveButton = UIBarButtonItem(title: "Save PDF", style: .done, target: self, action: #selector(savePdf))
    private lazy var backButton = UIBarButtonItem(image: UIImage(systemName: "chevron.backward"), style: .plain, target: self, action: #selector(goBack))
    private lazy var forwardButton = UIBarButtonItem(image: UIImage(systemName: "chevron.forward"), style: .plain, target: self, action: #selector(goForward))

    init(url: URL, key: String) {
        startURL = url
        if SignIn.isClinicalKeyArticle(url) {
            ckArticle = url
            firstURL = SignIn.clinicalKeyEntry ?? SignIn.portal
        } else {
            firstURL = url
        }
        self.key = key
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
        cfg.userContentController.add(WeakScriptHandler(self), name: "dsr4l")
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = self
        wv.uiDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        webView = wv
        view = wv
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(close))
        navigationItem.rightBarButtonItem = saveButton
        saveButton.isEnabled = false
        backButton.isEnabled = false
        forwardButton.isEnabled = false
        let flex = UIBarButtonItem(barButtonSystemItem: .flexibleSpace, target: nil, action: nil)
        let reload = UIBarButtonItem(barButtonSystemItem: .refresh, target: self, action: #selector(reloadPage))
        let safari = UIBarButtonItem(image: UIImage(systemName: "safari"), style: .plain, target: self, action: #selector(openInSafari))
        toolbarItems = [backButton, flex, forwardButton, flex, reload, flex, safari]
        navigationController?.isToolbarHidden = false

        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
        ])
        observers = [
            webView.observe(\.estimatedProgress, options: [.new]) { [weak self] wv, _ in
                self?.progress.progress = Float(wv.estimatedProgress)
                self?.progress.isHidden = wv.estimatedProgress >= 1
            },
            webView.observe(\.title, options: [.new]) { [weak self] wv, _ in
                guard let self = self, self.fetching.isEmpty else { return }
                self.title = wv.title
            },
            webView.observe(\.canGoBack, options: [.new]) { [weak self] wv, _ in self?.backButton.isEnabled = wv.canGoBack },
            webView.observe(\.canGoForward, options: [.new]) { [weak self] wv, _ in self?.forwardButton.isEnabled = wv.canGoForward },
        ]
        webView.customUserAgent = LocalFiles.userAgent
        if ckArticle != nil && SignIn.clinicalKeyEntry == nil {
            navigationItem.prompt = "Tap ClinicalKey on Research4Life once: the app remembers it"
        }
        webView.load(URLRequest(url: firstURL))
    }

    @objc private func close() { dismiss(animated: true) }
    @objc private func goBack() { webView.goBack() }
    @objc private func goForward() { webView.goForward() }
    @objc private func reloadPage() { webView.reload() }
    @objc private func openInSafari() { UIApplication.shared.open(webView.url ?? startURL) }
    @objc private func savePdf() { if let u = pdfURL { fetchPdf(u, auto: false) } }

    // MARK: sign-in

    /// On a Research4Life / UpToDate sign-in page: fill in the saved login and send it (twice at
    /// most, so a wrong password doesn't loop); a login typed there is remembered.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // ClinicalKey reached through Research4Life: now open the article.
        if let art = ckArticle, SignIn.isClinicalKeyHost(webView.url?.host) {
            ckArticle = nil
            navigationItem.prompt = nil
            if webView.url?.absoluteString != art.absoluteString {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in self?.webView.load(URLRequest(url: art)) }
            }
            return
        }
        guard let p = SignIn.provider(for: webView.url) else { return }
        // Signed in, but Research4Life landed on its own home page: open the paper again (once).
        let path = webView.url?.path.lowercased() ?? ""
        if signedIn, !reopened, p == "r4l", SignIn.provider(for: firstURL) == nil || firstURL == SignIn.clinicalKeyEntry,
           webView.url != firstURL, !path.contains("signin"), !path.contains("login") {
            // Wait a moment: sign-in pages pass through a few self-submitting steps.
            let here = webView.url
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                guard let self = self, !self.reopened, self.webView.url == here, !self.webView.isLoading else { return }
                self.reopened = true
                self.webView.load(URLRequest(url: self.firstURL))
            }
            return
        }
        let saved = Keychain.load(provider: p)
        webView.evaluateJavaScript(SignIn.script(user: saved?.user, password: saved?.password, auto: autoSignIns < 2), completionHandler: nil)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if body["status"] as? String == "signing-in" { autoSignIns += 1; signedIn = true; return }
        guard let user = body["u"] as? String, let pass = body["p"] as? String, !user.isEmpty, !pass.isEmpty,
              let p = SignIn.provider(for: webView.url) else { return }
        signedIn = true
        if let saved = Keychain.load(provider: p), saved.user == user, saved.password == pass { return }
        Keychain.save(provider: p, user: user, password: pass)
        autoSignIns = 0
        onCredentials?(p, user)
    }

    /// The first link followed from a Research4Life page; when it leads to ClinicalKey, it is
    /// Research4Life's way into ClinicalKey (SignIn.clinicalKeyEntry).
    private func noteClinicalKeyEntry(_ u: URL) {
        guard let host = u.host else { return }
        if SignIn.isR4LHost(host) && !u.path.hasPrefix("/tacgw") {
            fromR4LPage = true
            chainStart = nil
            return
        }
        if fromR4LPage && chainStart == nil { chainStart = u }
        if SignIn.isClinicalKeyHost(host) {
            if let c = chainStart, !SignIn.isClinicalKeyArticle(c) { SignIn.clinicalKeyEntry = c }
            fromR4LPage = false
            chainStart = nil
        }
    }

    // MARK: PDFs

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let mime = response.response.mimeType?.lowercased() ?? ""
        let url = response.response.url
        let named = (response.response.suggestedFilename ?? url?.lastPathComponent ?? "").lowercased().hasSuffix(".pdf")
        let isPdf = mime == "application/pdf" || mime == "application/x-pdf" || (mime == "application/octet-stream" && named)
        if response.isForMainFrame {
            pdfURL = isPdf ? url : nil
            saveButton.isEnabled = isPdf
            if isPdf, let u = url, !key.isEmpty { fetchPdf(u, auto: true) }
        }
        if !response.canShowMIMEType {
            decisionHandler(.cancel)
            if isPdf, let u = url, key.isEmpty { fetchPdf(u, auto: false) }
            return
        }
        decisionHandler(.allow)
    }

    /// Downloads the PDF with this browser's logins and hands it to the library.
    private func fetchPdf(_ url: URL, auto: Bool) {
        guard !fetching.contains(url.absoluteString) else { return }
        fetching.insert(url.absoluteString)
        saveButton.isEnabled = false
        title = "Saving PDF…"
        webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self = self else { return }
            var req = URLRequest(url: url)
            req.setValue(LocalFiles.userAgent, forHTTPHeaderField: "User-Agent")
            Cookies.apply(cookies, to: &req)
            URLSession.shared.dataTask(with: req) { data, resp, _ in
                DispatchQueue.main.async {
                    self.fetching.remove(url.absoluteString)
                    guard let data = data, data.prefix(1024).range(of: Data("%PDF".utf8)) != nil else {
                        self.title = self.webView.title
                        self.saveButton.isEnabled = self.pdfURL != nil
                        self.notice("This PDF couldn't be saved from here. Tap the Safari button, then Share → DermScholar.")
                        return
                    }
                    let name = resp?.suggestedFilename ?? url.lastPathComponent
                    self.onPdf?(data, name, self.webView.title ?? "")
                    if auto {
                        self.dismiss(animated: true)
                    } else {
                        self.title = "Saved to your library"
                    }
                }
            }.resume()
        }
    }

    private func notice(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }

    // MARK: links

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { decisionHandler(.allow); return }
        if action.targetFrame?.isMainFrame ?? true { noteClinicalKeyEntry(url) }
        if ["http", "https", "about", "blob", "data"].contains(scheme) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        UIApplication.shared.open(url) // mailto:, the MyLOFT app's own links…
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil, let url = action.request.url { webView.load(URLRequest(url: url)) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
}
