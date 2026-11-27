// Lesionaut Settings: AI keys (kept by the phone app, encrypted with its keystore), bringing the
// keys over from the DermScholar account, appearance, updates, privacy and about.
(() => {
  'use strict';
  const L = window.LX;
  const { N, $, esc, icon, store, toast, sheet, closeSheet, bar, actions, routes, render } = L;
  const view = () => $('#view');

  const AIS = [
    ['gemini', 'Gemini', 'Free key at aistudio.google.com/apikey. Reads pictures best (recommended).', 'https://aistudio.google.com/apikey'],
    ['claude', 'Claude', 'Paid key at console.anthropic.com. Excellent with pictures and reasoning.', 'https://console.anthropic.com/settings/keys'],
    ['groq', 'Groq', 'Free key at console.groq.com. Very fast; small picture model (5 pictures at most).', 'https://console.groq.com/keys'],
    ['openrouter', 'OpenRouter', 'Key at openrouter.ai. Back-up with free models.', 'https://openrouter.ai/keys'],
  ];
  const safe = (f, d) => { try { return f(); } catch { return d; } };
  let update = null; // { state, name }

  routes.settings = () => {
    const t = store.get('theme', 'system');
    const auto = safe(() => N.aiAuto?.(), true);
    const ver = safe(() => N.version?.(), '') || 'web';
    view().innerHTML = `${bar('Settings', { back: false })}
      <div class="sec" style="margin-top:0"><div class="sec-h"><h3>AI</h3></div>
        <div class="card">${AIS.map(([p, n, d, url]) => { const has = safe(() => N.aiHasKeyFor?.(p), false); const tail = has ? safe(() => N.aiKeyTail?.(p), '') : '';
          return `<div class="li" style="cursor:default"><span class="ph">${icon('key')}</span><span><b>${n}</b><small>${has ? `Key saved${tail ? ' (…' + esc(tail) + ')' : ''}` : esc(d)}</small></span>
            <button class="btn sm ${has ? '' : 'pri'}" data-act="key-set" data-p="${p}">${has ? 'Change' : 'Add'}</button>${has ? `<button class="ib" data-act="key-del" data-p="${p}" aria-label="Remove">${icon('trash')}</button>` : ''}</div>`; }).join('')}
          <div class="li" style="cursor:default"><span><b>Use every saved AI</b><small>If one is busy or fails, the next takes over (pictures: Claude → Gemini → Groq → OpenRouter)</small></span>
            <button class="btn sm ${auto ? 'pri' : ''}" data-act="ai-auto">${auto ? 'On' : 'Off'}</button></div></div>
        <div class="card"><h4>${icon('people')} Bring keys from your DermScholar account</h4><p class="small muted">Sign in with your DermScholar account (email and password). Your AI keys are synced there encrypted with that password; Lesionaut opens them on this device only and saves them in the phone's keystore.</p>
          <button class="btn sm" data-act="acct-keys">${icon('key')}Bring my keys</button></div></div>
      <div class="sec"><div class="sec-h"><h3>Appearance</h3></div><div class="card"><div class="themes">${Object.entries(L.THEMES).map(([x, l]) => `<button class="${t === x ? 'on' : ''}" data-act="theme" data-t="${x}"><i style="background:${SWATCH[x]}"></i>${l}</button>`).join('')}</div></div></div>
      ${window.Native && N.updateCheck ? `<div class="sec"><div class="sec-h"><h3>Updates</h3></div><div class="card"><div class="li" style="cursor:default"><span><b>Lesionaut ${esc(ver)}</b><small id="upd-msg">${update?.state === 'available' ? 'Version ' + esc(update.name) + ' is available' : update?.state === 'none' ? 'You have the latest version' : update?.state === 'downloading' ? 'Downloading… ' + (update.pct >= 0 ? update.pct + '%' : '') : 'Updates install from inside the app'}</small></span>
        <button class="btn sm ${update?.state === 'available' ? 'pri' : ''}" data-act="${update?.state === 'available' ? 'upd-install' : 'upd-check'}">${update?.state === 'available' ? 'Install' : 'Check'}</button></div></div></div>` : ''}
      <div class="sec"><div class="sec-h"><h3>Privacy</h3></div><div class="card small">Cases, pictures and notes stay on this device. When you assess a case, ask a question or run a tool that uses AI, that case's pictures and history go to the AI service you set up (Google, Anthropic, Groq or OpenRouter) over an encrypted connection, under their API terms. Leave out names and faces. API keys are kept encrypted by the phone's keystore${N.aiRun && !window.Native ? ' (in this browser\'s storage on the web version)' : ''}.</div></div>
      <div class="sec"><div class="sec-h"><h3>About</h3></div><div class="card small"><b>Lesionaut ${esc(ver)}</b>: a dermatology diagnostic copilot that reads clinical photographs, dermoscopy, histopathology, immunofluorescence, microscopy and laboratory reports together and explains a ranked differential.
        <p class="muted">It is decision support for clinicians, not a validated diagnostic device: AI readings can be wrong, are not calibrated probabilities, and have not been validated across skin types, ages or populations. The clinician makes and records the diagnosis. Literature from Europe PMC.</p></div></div>`;
  };
  const SWATCH = { system: 'linear-gradient(135deg,#f3f6f7 50%,#061520 50%)', light: 'linear-gradient(135deg,#ffffff,#e1f1f5)', dark: 'linear-gradient(135deg,#0c2130,#0b3a4f)', amoled: 'linear-gradient(135deg,#000,#0a0f12)', sepia: 'linear-gradient(135deg,#fbf6ee,#efe5d4)', contrast: 'linear-gradient(135deg,#fff 50%,#000 50%)' };
  actions.theme = (b) => { store.set('theme', b.dataset.t); L.applyTheme(); routes.settings(); };
  actions['ai-auto'] = () => { N.aiSetAuto?.(!safe(() => N.aiAuto?.(), true)); routes.settings(); };
  actions['key-set'] = (b) => {
    const [p, n, d, url] = AIS.find((x) => x[0] === b.dataset.p);
    sheet(`<h3>${n} API key</h3><p class="small muted">${esc(d)}</p><button class="btn sm" data-act="open" data-url="${url}">${icon('link')}Get a key</button>
      <label class="f" style="margin-top:12px">Paste the key<input id="key-in" class="in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${p === 'gemini' ? 'AIza…' : p === 'claude' ? 'sk-ant-…' : p === 'groq' ? 'gsk_…' : 'sk-or-…'}"></label>
      <div class="acts"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn pri" data-act="key-save" data-p="${p}">Save</button></div>`);
    setTimeout(() => $('#key-in')?.focus(), 100);
  };
  actions['key-save'] = (b) => {
    const k = $('#key-in').value.trim();
    if (!k) return;
    N.aiSetKey?.(k, b.dataset.p);
    closeSheet(); toast('Key saved'); routes.settings();
  };
  actions['key-del'] = (b) => {
    if (!confirm('Remove this key from this device?')) return;
    const keep = safe(() => N.aiProvider?.(), '');
    N.aiSetProvider?.(b.dataset.p); N.aiSetKey?.('', b.dataset.p);
    if (keep && keep !== b.dataset.p) N.aiSetProvider?.(keep);
    routes.settings();
  };

  // ---- Updates (the Android app)
  L.on('update', (e) => {
    update = { ...update, ...e };
    if (e.state === 'error') toast(e.message || 'Update check failed');
    if (e.state === 'permission') toast('Allow installing apps from Lesionaut, then tap Install again');
    if (L.cur.name === 'settings') routes.settings();
  });
  actions['upd-check'] = () => { $('#upd-msg') && ($('#upd-msg').textContent = 'Checking…'); N.updateCheck(); };
  actions['upd-install'] = () => { update = { ...update, state: 'downloading', pct: 0 }; routes.settings(); N.updateInstall(); };

  // ---- AI keys from the DermScholar account (the same encrypted vault DermScholar syncs)
  const SB = 'https://gsaeozzcpeughdkbklyp.supabase.co';
  // The project's public ("anon") key: public by design; each account's row is protected by row-level security.
  const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYWVvenpjcGV1Z2hka2JrbHlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjA1MDMsImV4cCI6MjEwNTc5NjUwM30.Z6e5mMn2dr5tbgIxidITy6fJUgFXxEtNESm_kI4LjDU';
  actions['acct-keys'] = () => {
    sheet(`<h3>Bring keys from DermScholar</h3><p class="small muted">Your DermScholar account email and password. The password unlocks the keys on this device; it is not stored.</p>
      <label class="f">Email<input id="acc-email" class="in" type="email" autocomplete="email" value="${esc(store.get('acctEmail', ''))}"></label>
      <label class="f" style="margin-top:8px">Password<input id="acc-pass" class="in" type="password" autocomplete="current-password"></label>
      <div class="acts"><button class="btn" data-act="close-sheet">Cancel</button><button class="btn pri" data-act="acct-go">Bring keys</button></div>`);
  };
  actions['acct-go'] = async (b) => {
    const email = $('#acc-email').value.trim(), pass = $('#acc-pass').value;
    if (!email || !pass) { toast('Enter email and password'); return; }
    b.disabled = true; b.textContent = 'Working…';
    try {
      store.set('acctEmail', email);
      const n = await bringKeys(email, pass);
      closeSheet();
      toast(n ? `${n} AI key${n === 1 ? '' : 's'} added` : 'No new AI keys: this device already has them, or the account has none');
      routes.settings();
    } catch (e) { b.disabled = false; b.textContent = 'Bring keys'; toast(e.message || String(e)); }
  };
  async function http(path, { method = 'GET', body, token } = {}) {
    const headers = { apikey: ANON, Authorization: 'Bearer ' + (token || ANON), 'Content-Type': 'application/json' };
    let status, text;
    if (N.httpAsync) { const o = await N.httpAsync(SB + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); status = o.status; text = o.text; }
    else { const r = await fetch(SB + path, { method, headers, body: body ? JSON.stringify(body) : undefined }); status = r.status; text = await r.text(); }
    let o = null; try { o = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (status < 200 || status >= 300) throw new Error(/invalid login|invalid_grant/i.test(text || '') ? 'Wrong email or password for the DermScholar account.' : (o && (o.msg || o.error_description || o.message)) || 'The account server answered ' + status);
    return o;
  }
  const u8 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  async function bringKeys(email, pass) {
    const s = await http('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: pass } });
    const rows = await http(`/rest/v1/user_data?select=data&user_id=eq.${encodeURIComponent(s.user.id)}`, { token: s.access_token });
    const vault = rows?.[0]?.data?.dermscholar?.vault;
    if (!vault?.blob) throw new Error('No synced keys in this account yet. In DermScholar: Settings → Account & sync → Unlock, then Sync now.');
    const salt = 'dermscholar-vault:' + email.toLowerCase();
    let txt;
    if (crypto?.subtle) {
      const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 150000 }, base, 256);
      const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt']);
      const d = u8(vault.blob);
      try { txt = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.subarray(0, 12) }, key, d.subarray(12))); } catch { throw new Error('The keys didn\'t unlock with this password (was it changed after they were synced?).'); }
    } else throw new Error('This device can\'t decrypt the keys.');
    const creds = JSON.parse(txt).creds || {};
    let n = 0;
    for (const [p] of AIS) {
      const k = creds[p]?.accounts?.[0]?.pass;
      if (k && !safe(() => N.aiHasKeyFor?.(p), false)) { N.aiSetKey?.(k, p); n++; }
    }
    return n;
  }
})();
