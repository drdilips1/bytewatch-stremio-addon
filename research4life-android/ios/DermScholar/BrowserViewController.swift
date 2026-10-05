import UIKit
import WebKit

/// The app's own browser for Research4Life, UpToDate, MyLOFT and journals. Logins are kept (the
/// shared cookie store). A PDF opened here goes into the library: automatically when the browser
/// was opened to get a paper's PDF (`key`), otherwise with the Save PDF button.
final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    var onPdf: ((Data, String, String) -> Void)?

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
        self.key = key
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()
        cfg.allowsInlineMediaPlayback = true
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
        webView.load(URLRequest(url: startURL))
    }

    @objc private func close() { dismiss(animated: true) }
    @objc private func goBack() { webView.goBack() }
    @objc private func goForward() { webView.goForward() }
    @objc private func reloadPage() { webView.reload() }
    @objc private func openInSafari() { UIApplication.shared.open(webView.url ?? startURL) }
    @objc private func savePdf() { if let u = pdfURL { fetchPdf(u, auto: false) } }

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
