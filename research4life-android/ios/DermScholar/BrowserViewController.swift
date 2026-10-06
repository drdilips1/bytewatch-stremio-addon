import UIKit
import WebKit

/// The app's own browser for Research4Life, UpToDate, MyLOFT and journals. Logins are kept (the
/// shared cookie store). A PDF opened here goes into the library: automatically when the browser
/// was opened to get a paper's PDF (`key`), otherwise with the Save PDF button.
final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    var onPdf: ((Data, String, String) -> Void)?
    /// The browser closed (Done, or by itself after saving the paper's PDF).
    var onClose: (() -> Void)?
    /// A login typed on a sign-in page (provider, user): saved in the Keychain, shown in Settings.
    var onCredentials: ((String, String) -> Void)?
    private var autoSignIns = 0
    private var signedIn = false
    private var reopened = false
    /// Where the browser starts: an Elsevier article first goes through Research4Life's
    /// ClinicalKey link (or its portal, to tap ClinicalKey once), then to the article.
    private var firstURL: URL
    private var ckArticle: URL?
    /// The link last tapped on a Research4Life page (its way into ClinicalKey, once ClinicalKey opens).
    private var tappedOnR4L: URL?
    private var recovered = false

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

    @objc private func close() { onClose?(); dismiss(animated: true) }
    @objc private func goBack() { webView.goBack() }
    @objc private func goForward() { webView.goForward() }
    @objc private func reloadPage() { webView.reload() }
    @objc private func openInSafari() { UIApplication.shared.open(webView.url ?? startURL) }
    /// The PDF on show, or else the article page's own PDF link (its citation_pdf_url, PDF button…).
    @objc private func savePdf() {
        if let u = pdfURL { download(u, auto: false); return }
        webView.evaluateJavaScript(BrowserViewController.findPdfScript) { [weak self] v, _ in
            guard let self = self else { return }
            guard let s = v as? String, let u = URL(string: s) else {
                self.notice("No PDF found on this page yet. Open the article's PDF (its PDF or Download button), then tap Save PDF.")
                return
            }
            self.download(u, auto: !self.key.isEmpty)
        }
    }

    static let findPdfScript = #"""
    (function(){function abs(u){try{return new URL(u,location.href).href}catch(e){return null}}
    var m=document.querySelector('meta[name="citation_pdf_url"]');if(m&&m.content)return abs(m.content);
    var a=[].slice.call(document.querySelectorAll('a[href]'));
    var best=a.filter(function(x){var h=x.getAttribute('href')||'',t=(x.textContent||'')+' '+(x.getAttribute('aria-label')||'')+' '+(x.title||'');
    return /\.pdf($|[?#])|\/pdf(\/|$|\?)|pdfdirect|epdf|download/i.test(h)&&/pdf|download/i.test(t+' '+h);})[0];
    return best?(abs(best.getAttribute('href'))||'').replace('/doi/epdf/','/doi/pdfdirect/'):null;})()
    """#

    // MARK: sign-in

    /// On a Research4Life / UpToDate sign-in page: fill in the saved login and send it (twice at
    /// most, so a wrong password doesn't loop); a login typed there is remembered.
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Elsevier's "Something went wrong" (a sign-in step opened on its own): forget that link and
        // start again at Research4Life, where tapping ClinicalKey teaches the right one.
        if SignIn.isHandoverError(webView.url), !recovered {
            recovered = true
            SignIn.clinicalKeyEntry = nil
            UserDefaults.standard.removeObject(forKey: "ckEntry")
            if SignIn.isClinicalKeyArticle(startURL) { ckArticle = startURL }
            navigationItem.prompt = "Tap ClinicalKey on Research4Life once: the app remembers it"
            webView.load(URLRequest(url: SignIn.portal))
            return
        }
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

    /// The link tapped on a Research4Life page; when it leads to ClinicalKey, it is Research4Life's
    /// way into ClinicalKey (SignIn.clinicalKeyEntry). Only a tapped link is kept, never the
    /// sign-in hand-over steps in between (those can't be opened again on their own).
    private func noteClinicalKeyEntry(_ action: WKNavigationAction) {
        guard let u = action.request.url, let host = u.host else { return }
        if (action.navigationType == .linkActivated || action.targetFrame == nil),
           SignIn.isR4LHost(webView.url?.host), (action.request.httpMethod ?? "GET") == "GET", SignIn.reopenable(u) {
            tappedOnR4L = u
        }
        if SignIn.isClinicalKeyHost(host) {
            if let t = tappedOnR4L, !SignIn.isClinicalKeyArticle(t) { SignIn.clinicalKeyEntry = t }
            tappedOnR4L = nil
        }
    }

    // MARK: PDFs

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let mime = response.response.mimeType?.lowercased() ?? ""
        let url = response.response.url
        let named = (response.response.suggestedFilename ?? url?.lastPathComponent ?? "").lowercased().hasSuffix(".pdf")
        let isPdf = mime == "application/pdf" || mime == "application/x-pdf" || (mime == "application/octet-stream" && named)
        if response.isForMainFrame && isPdf {
            pdfURL = url
            // Opened to get this paper's PDF: keep it straight away. WebKit downloads it itself, with
            // the page's own logins and context (publishers refuse a separate re-download).
            if !key.isEmpty { title = "Saving PDF…"; decisionHandler(.download); return }
        } else if response.isForMainFrame {
            pdfURL = nil
        }
        if !response.canShowMIMEType {
            decisionHandler(isPdf ? .download : .cancel)
            return
        }
        decisionHandler(.allow)
    }

    // A link that downloads (the journal's own Download button) becomes a WebKit download too.
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        start(download, auto: !key.isEmpty)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        start(download, auto: !key.isEmpty)
    }

    /// Downloads a PDF through the browser itself (its logins and cookies) for the library.
    private func download(_ url: URL, auto: Bool) {
        title = "Saving PDF…"
        var req = URLRequest(url: url)
        if let here = webView.url { req.setValue(here.absoluteString, forHTTPHeaderField: "Referer") }
        webView.startDownload(using: req) { [weak self] d in self?.start(d, auto: auto) }
    }

    private var downloads: [ObjectIdentifier: (file: URL, name: String, auto: Bool)] = [:]

    private func start(_ d: WKDownload, auto: Bool) {
        d.delegate = self
        downloads[ObjectIdentifier(d)] = (FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString), "", auto)
        fetching.insert(String(describing: ObjectIdentifier(d)))
        title = "Saving PDF…"
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let id = ObjectIdentifier(download)
        guard let d = downloads[id] else { completionHandler(nil); return }
        downloads[id] = (d.file, suggestedFilename, d.auto)
        completionHandler(d.file)
    }

    func downloadDidFinish(_ download: WKDownload) {
        let id = ObjectIdentifier(download)
        fetching.remove(String(describing: id))
        guard let d = downloads.removeValue(forKey: id) else { return }
        let data = try? Data(contentsOf: d.file)
        try? FileManager.default.removeItem(at: d.file)
        guard let pdf = data, pdf.prefix(1024).range(of: Data("%PDF".utf8)) != nil else {
            title = webView.title
            notice("That download wasn't a PDF (the site sent a page instead). Open the PDF itself, then tap Save PDF.")
            return
        }
        onPdf?(pdf, d.name.isEmpty ? "paper.pdf" : d.name, webView.title ?? "")
        if d.auto { onClose?(); dismiss(animated: true) } else { title = "Saved to your library" }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let id = ObjectIdentifier(download)
        fetching.remove(String(describing: id))
        if let d = downloads.removeValue(forKey: id) { try? FileManager.default.removeItem(at: d.file) }
        title = webView.title
        notice("The PDF didn't download (\(error.localizedDescription)). Try the page's PDF button again, or the Safari button.")
    }

    private func notice(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default))
        present(a, animated: true)
    }

    // MARK: links

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let scheme = url.scheme?.lowercased() else { decisionHandler(.allow); return }
        if action.targetFrame?.isMainFrame ?? true { noteClinicalKeyEntry(action) }
        if action.shouldPerformDownload { decisionHandler(.download); return }
        if ["http", "https", "about", "blob", "data"].contains(scheme) { decisionHandler(.allow); return }
        decisionHandler(.cancel)
        UIApplication.shared.open(url) // mailto:, the MyLOFT app's own links…
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.targetFrame == nil {
            noteClinicalKeyEntry(action)
            var req = action.request
            if req.value(forHTTPHeaderField: "Referer") == nil, let here = webView.url { req.setValue(here.absoluteString, forHTTPHeaderField: "Referer") }
            webView.load(req)
        }
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
