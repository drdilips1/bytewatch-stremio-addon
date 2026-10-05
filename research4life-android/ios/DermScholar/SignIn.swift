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
        if host == "uptodate.com" || host.hasSuffix(".uptodate.com") || host.hasSuffix("wolterskluwer.com") { return "utd" }
        return nil
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
    ||[].slice.call(document.querySelectorAll('button,input[type=submit]')).filter(vis).filter(function(b){return /sign\s*in|log\s*in|login|submit|continue/i.test(b.textContent||b.value||'');})[0];
    if(btn)btn.click();else if(form){form.requestSubmit?form.requestSubmit():form.submit();}},500);}
    else if(!f&&AUTO&&!window.__dsStep1){var u=[].slice.call(document.querySelectorAll('input[type=email],input[autocomplete=username],input[name*=user i],input[id*=user i],input[name*=email i]')).filter(vis)[0];
    var nb=[].slice.call(document.querySelectorAll('button,input[type=submit]')).filter(vis).filter(function(b){return /continue|next|sign\s*in|log\s*in/i.test(b.textContent||b.value||'');})[0];
    if(u&&nb&&!u.value){window.__dsStep1=1;set(u,U);setTimeout(function(){nb.click();},400);}}
    if(tries>40)clearInterval(t);},400);
    """#
}
