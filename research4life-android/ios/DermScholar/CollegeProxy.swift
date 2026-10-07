import Foundation
import Network
import WebKit

/// The person's college proxy (EZproxy as an internet proxy: address, port, and the login its
/// password pop-up asks for). From iOS 17 the app's browsers use it for publisher sites, so
/// journals the college subscribes to open with its access; before iOS 17 only the system's
/// Wi-Fi proxy setting can, and the app answers its password pop-up (`credential(for:)`).
/// Search, AI, Research4Life and UpToDate never go through it.
enum CollegeProxy {
    private static let defaults = UserDefaults.standard

    static var host: String { defaults.string(forKey: "px.host") ?? "" }
    static var port: Int { defaults.integer(forKey: "px.port") }
    static var configured: Bool { !host.isEmpty && port > 0 }

    /// The browsers can be pointed at a proxy by the app itself.
    static var apiAvailable: Bool {
        if #available(iOS 17.0, *) { return true }
        return false
    }

    private static let bypass = [
        "*.ebi.ac.uk", "*.ncbi.nlm.nih.gov", "*.crossref.org", "*.openalex.org", "*.unpaywall.org", "*.semanticscholar.org",
        "*.research4life.org", "research4life.org", "*.who.int", "*.uptodate.com", "*.wolterskluwer.com",
        "*.googleapis.com", "*.google.com", "*.gstatic.com", "*.groq.com", "*.anthropic.com", "*.openai.com",
        "*.github.io", "github.com", "*.github.com", "*.githubusercontent.com", "*.myloft.xyz", "*.clinicaltrials.gov", "clinicaltrials.gov",
    ]

    static func save(host: String, port: Int) {
        var h = host.trimmingCharacters(in: .whitespaces)
        h = h.replacingOccurrences(of: "^(?i)https?://", with: "", options: .regularExpression)
        h = h.replacingOccurrences(of: "[/\\s].*$", with: "", options: .regularExpression)
        defaults.set(h, forKey: "px.host")
        defaults.set(h.isEmpty ? 0 : port, forKey: "px.port")
        apply()
    }

    /// The proxy is used only while Get PDF takes the college route; Research4Life, ClinicalKey and
    /// UpToDate stay direct, so those sign-ins aren't mistaken for the college's.
    private(set) static var active = false

    static func setActive(_ on: Bool) {
        let want = on && configured
        guard want != active else { return }
        active = want
        apply()
    }

    /// Points the app's browsers (the shared website data store) at the proxy, or back to direct.
    static func apply() {
        guard #available(iOS 17.0, *) else { return }
        let store = WKWebsiteDataStore.default()
        guard active, configured, let p = NWEndpoint.Port(rawValue: UInt16(clamping: port)) else {
            store.proxyConfigurations = []
            return
        }
        var cfg = ProxyConfiguration(httpCONNECTProxy: .hostPort(host: NWEndpoint.Host(host), port: p))
        cfg.excludedDomains = bypass
        if let login = Keychain.load(provider: "px") { cfg.applyCredential(username: login.user, password: login.password) }
        store.proxyConfigurations = [cfg]
    }

    /// The saved login for the proxy's password pop-up (a proxy challenge), tried twice at most.
    static func credential(for challenge: URLAuthenticationChallenge) -> URLCredential? {
        guard challenge.protectionSpace.isProxy(), challenge.previousFailureCount < 2,
              let login = Keychain.load(provider: "px") else { return nil }
        return URLCredential(user: login.user, password: login.password, persistence: .forSession)
    }
}
