import Foundation

/// Fills and submits the Research4Life / UpToDate sign-in pages in the app's browser with the
/// saved login, and remembers a login typed there (the same helper as the Android app's
/// R4LSession.signInScript).
enum SignIn {
    /// Which saved login a page's sign-in form belongs to (Research4Life's proxied journal pages
    /// under /tacsgr1… are the journals' own, not its sign-in).
    static func provider(for url: URL?) -> String? {
        guard let u = url, let host = u.host?.lowercased() else { return nil }
        if host == "research4life.org" || host.hasSuffix(".research4life.org") { return u.path.hasPrefix("/tacsgr1") ? nil : "r4l" }
        // Research4Life's own login (WHO's sign-in service), used on the way into ClinicalKey.
        if host == "stsr4l.who.int" { return "r4l" }
        // Springer Nature Link's sign-in (the person's own Springer account).
        if host.hasPrefix("idp."), host.hasSuffix("springer.com") || host.hasSuffix("springernature.com") { return "spr" }
        if host == "link.springer.com", u.path.lowercased().hasPrefix("/signup-login") || u.path.lowercased().hasPrefix("/login") { return "spr" }
        if host == "uptodate.com" || host.hasSuffix(".uptodate.com") || host.hasSuffix("wolterskluwer.com") { return "utd" }
        return nil
    }

    static func isR4LHost(_ host: String?) -> Bool {
        guard let h = host?.lowercased() else { return false }
        return h == "research4life.org" || h.hasSuffix(".research4life.org")
    }

    static func isClinicalKeyHost(_ host: String?) -> Bool {
        guard let h = host?.lowercased() else { return false }
        return h == "clinicalkey.com" || h.hasSuffix(".clinicalkey.com")
    }

    /// An article on ClinicalKey (Elsevier journals: JAAD…), as Get PDF opens it.
    static func isClinicalKeyArticle(_ url: URL) -> Bool {
        isClinicalKeyHost(url.host) && url.absoluteString.contains("#!/content/")
    }

    /// Research4Life's link into ClinicalKey, learned the first time ClinicalKey is opened from
    /// Research4Life in the app's browser. ClinicalKey only lets Research4Life users in when they
    /// arrive through Research4Life, so Elsevier papers go through this link first.
    static var clinicalKeyEntry: URL? {
        get { UserDefaults.standard.string(forKey: "ckEntry").flatMap(URL.init(string:)).flatMap { reopenable($0) ? $0 : nil } }
        set { UserDefaults.standard.set(newValue.flatMap { reopenable($0) ? $0.absoluteString : nil }, forKey: "ckEntry") }
    }

    /// A link that can be opened again on its own: not one of the sign-in hand-over steps
    /// (SAML/Shibboleth receivers such as auth.elsevier.com/SHIRE/SAML2/POST only take a posted form).
    static func reopenable(_ u: URL) -> Bool {
        u.absoluteString.range(of: "saml|shire|shibboleth|/sso/|/idp/profile", options: [.regularExpression, .caseInsensitive]) == nil
    }

    /// Elsevier's sign-in receiver showing its error (opened without the hand-over form).
    static func isHandoverError(_ u: URL?) -> Bool {
        guard let u = u, let h = u.host?.lowercased(), h.hasSuffix("elsevier.com") else { return false }
        return !reopenable(u)
    }

    /// Research4Life's sign-in page: the saved login fills in there (its home page stays signed out).
    static let portal = URL(string: "https://portal.research4life.org/signin")!

    /// Research4Life's way into ClinicalKey (the owner's link from the Research4Life portal):
    /// Elsevier's institution login through WHO's Research4Life sign-in, returning to `article`.
    static func clinicalKeyLogin(returningTo article: URL) -> URL {
        var c = URLComponents(string: "https://auth.elsevier.com/ShibAuth/institutionLogin")!
        c.queryItems = [URLQueryItem(name: "entityID", value: "http://stsr4l.who.int/adfs/services/trust"),
                        URLQueryItem(name: "appReturnURL", value: article.absoluteString)]
        return c.url!
    }

    /// ClinicalKey's PDF for the article on show (its PDF button's address), as the Android app uses.
    static func clinicalKeyPdf(for url: URL?) -> URL? {
        guard let s = url?.absoluteString, isClinicalKeyHost(url?.host),
              let r = s.range(of: "1-s2\\.0-S[0-9X]{15,17}", options: .regularExpression) else { return nil }
        return URL(string: "https://www.clinicalkey.com/service/content/pdf/watermarked/" + s[r] + ".pdf?locale=en_US&searchIndex=")
    }

    static func script(user: String?, password: String?, auto: Bool) -> String {
        let pair: [Any] = [user.map { $0 as Any } ?? NSNull(), password.map { $0 as Any } ?? NSNull()]
        let args = (try? JSONSerialization.data(withJSONObject: pair, options: []))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[null,null]"
        return "(function(){var A=\(args),AUTO=\(auto);" + body + "})();"
    }

    private static let body = #"""
    if(!window.DSR4L)window.DSR4L={credentials:function(u,p){try{webkit.messageHandlers.dsr4l.postMessage({u:u,p:p})}catch(e){}},status:function(s){try{webkit.messageHandlers.dsr4l.postMessage({status:s})}catch(e){}}};
    if(window.__dsSignIn)return;window.__dsSignIn=1;
    var U=A[0],P=A[1];
    function vis(e){return e&&e.offsetParent!==null&&!e.disabled;}
    function fields(){var pw=[].slice.call(document.querySelectorAll('input[type=password]')).filter(vis)[0];if(!pw)return null;
    var scope=pw.form||document;var us=[].slice.call(scope.querySelectorAll('input')).filter(function(e){return vis(e)&&/^(text|email|tel|)$/i.test(e.getAttribute('type')||'')&&e!==pw;});
    return {pw:pw,user:us[0]};}
    function report(){var f=fields();if(f&&f.user&&f.user.value&&f.pw.value)DSR4L.credentials(f.user.value,f.pw.value);}
    document.addEventListener('submit',report,true);
    document.addEventListener('click',function(e){if(e.target.closest&&e.target.closest('button,input[type=submit],[role=button]'))report();},true);
    document.addEventListener('keydown',function(e){if(e.key==='Enter')report();},true);
    if(!U||!P)return;
    function set(el,v){var d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(el,v);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}
    var tries=0;var t=setInterval(function(){tries++;var f=fields();
    if(f&&(f.user||window.__dsStep1||tries>6)){clearInterval(t);if(f.user)set(f.user,U);set(f.pw,P);
    if(!AUTO)return;DSR4L.status('signing-in');setTimeout(function(){var form=f.pw.form;
    var btn=(form&&form.querySelector('button[type=submit],input[type=submit],button:not([type])'))
    ||[].slice.call(document.querySelectorAll('button,input[type=submit],[role=button]')).filter(vis).filter(function(b){return /sign\s*in|log\s*in|login|submit|continue/i.test(b.textContent||b.value||'');})[0];
    if(btn)btn.click();else if(form){form.requestSubmit?form.requestSubmit():form.submit();}},500);}
    else if(!f&&AUTO&&!window.__dsStep1){var u=[].slice.call(document.querySelectorAll('input[type=email],input[autocomplete=username],input[name*=user i],input[id*=user i],input[name*=email i]')).filter(vis)[0];
    var nb=[].slice.call(document.querySelectorAll('button,input[type=submit],[role=button]')).filter(vis).filter(function(b){return /continue|next|sign\s*in|log\s*in/i.test(b.textContent||b.value||'');})[0];
    if(u&&nb&&!u.value){window.__dsStep1=1;set(u,U);setTimeout(function(){nb.click();},400);}}
    if(tries>40)clearInterval(t);},400);
    """#
}
