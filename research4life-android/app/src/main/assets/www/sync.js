// DermScholar account, sync and in-app updates.
// Sign in with email/password (or Google, when the sync server allows it) on the same server
// as Paper2Audio and Inkwell, so one account works across the apps. What syncs: the saved
// library (papers, statuses, collections, notes), highlights and notes, projects and notebooks,
// watched questions, follows, history and settings, AI answers already written, and — encrypted
// with a key made from the account password, so the server can't read them — the logins
// (Research4Life, UpToDate, Springer, college proxy) and AI keys. PDFs themselves stay on each
// phone; papers whose PDF another device has can be fetched again in one tap.
// Data lives in the account's row of public.user_data under the key "dermscholar"; other
// apps' keys in that row are left untouched.
(() => {
  const D = window.DS;
  if (!D) return;
  const { Native, ext, $, esc, icon, sheet, closeSheet, toast, store, db, actions, render } = D;

  const URL_ = 'https://gsaeozzcpeughdkbklyp.supabase.co';
  // The project's public ("anon") key: public by design; each user's row is protected by row-level security.
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzYWVvenpjcGV1Z2hka2JrbHlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyMjA1MDMsImV4cCI6MjEwNTc5NjUwM30.Z6e5mMn2dr5tbgIxidITy6fJUgFXxEtNESm_kI4LjDU';
  const SECTION = 'dermscholar';
  const REDIRECT = 'dermscholar://auth';

  // ---------------------------------------------------------------- session
  const S = {
    get: () => store.get('sync.session', null),
    set: (s) => store.set('sync.session', s),
    clear: () => localStorage.removeItem('ds.sync.session'),
  };
  const signedIn = () => !!S.get()?.refresh;
  let status = '';

  async function call(path, { method = 'GET', body, token, prefer } = {}) {
    const headers = { apikey: KEY, Authorization: 'Bearer ' + (token || KEY) };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    let r;
    try {
      r = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      // "Load failed" / "Failed to fetch": the server couldn't be reached at all.
      const e = new Error('Couldn\'t reach the sync server. Check the internet connection; if a VPN (Tailscale) or a Wi-Fi proxy is on, turn it off and try again.');
      e.code = 0;
      throw e;
    }
    const text = await r.text();
    if (!r.ok) {
      let o = null;
      try { o = JSON.parse(text); } catch { /* not JSON */ }
      let m = (o && (o.msg || o.error_description || o.message || o.error)) || 'Server error ' + r.status;
      // Plain words for the usual sign-in answers.
      if (/invalid login credentials|invalid_grant/i.test(m) && /grant_type=password/.test(path)) m = 'Wrong email or password, or there is no DermScholar account for this email yet (tap Create account). Note: this is the DermScholar account, not Research4Life.';
      else if (/email not confirmed/i.test(m)) m = 'This account\'s email isn\'t confirmed yet: open the confirmation email (check spam), tap its link, then sign in.';
      else if (/already registered|already exists/i.test(m)) m = 'There is already a DermScholar account for this email: tap Sign in (or Forgot password).';
      const e = new Error(m);
      e.code = r.status;
      throw e;
    }
    return text ? JSON.parse(text) : null;
  }
  function saveSession(o, user) {
    const u = user || o.user || {};
    const prev = S.get() || {};
    S.set({ access: o.access_token, refresh: o.refresh_token, expires: Date.now() + (o.expires_in || 3600) * 1000,
      user: u.id || prev.user, email: u.email || prev.email });
  }
  async function token(force = false) {
    const s = S.get();
    if (!s?.refresh) throw new Error('Not signed in');
    if (!force && s.access && Date.now() < s.expires - 60000) return s.access;
    try {
      saveSession(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh } }));
    } catch (e) {
      if (e.code >= 400 && e.code < 500) { S.set({ ...s, refresh: null, access: null }); throw new Error('Your sign-in ran out. Sign in again to keep syncing.'); }
      throw e;
    }
    return S.get().access;
  }

  // ---------------------------------------------------------------- what syncs
  const SKIP = /^ds\.(sync\.|stub\.|intel\.|groqModels|r4l|acc\.|accs\.|utdLoggedIn)/;
  const MAX_VALUE = 400000;
  const syncKeys = () => Object.keys(localStorage).filter((k) => k.startsWith('ds.') && !SKIP.test(k) && (localStorage.getItem(k) || '').length < MAX_VALUE);
  const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); };
  // Large fields (full text, rendered models) are rebuilt on each phone, not synced.
  const slim = (a) => {
    const o = {};
    for (const [k, v] of Object.entries(a)) {
      if (k === 'fullText' || k === 'model' || k === 'html') continue;
      if (typeof v === 'string' && v.length > 20000) continue;
      o[k] = v;
    }
    return o;
  };

  // Every library change is time-stamped (newest wins on merge); removals leave a tombstone.
  const origPut = db.put.bind(db);
  const origDel = db.del.bind(db);
  db.put = (o) => { if (o && !o._fromSync) o._t = Date.now(); if (o) delete o._fromSync; schedule(); return origPut(o); };
  db.del = (id) => {
    const t = store.get('sync.deleted', {});
    t[id] = Date.now();
    store.set('sync.deleted', t);
    schedule();
    return origDel(id);
  };
  const origSet = store.set;
  store.set = (k, v) => { origSet(k, v); if (!String(k).startsWith('sync.')) schedule(); };

  let timer = null;
  function schedule() {
    if (!signedIn()) return;
    clearTimeout(timer);
    timer = setTimeout(() => sync(), 20000);
  }

  // ---------------------------------------------------------------- encrypted logins
  // The key is made from the account password (PBKDF2-SHA256, 150,000 rounds, salted with the
  // email) and kept on this device only; logins and AI keys are sealed with AES-GCM before they
  // leave it. Screens without the browser's crypto (the iPhone app) use the app's own (Vault).
  const subtle = (() => { try { return window.isSecureContext !== false && crypto?.subtle ? crypto.subtle : null; } catch { return null; } })();
  const u8 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const b64of = (buf) => { const a = new Uint8Array(buf); let s0 = ''; for (let i = 0; i < a.length; i += 8192) s0 += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s0); };
  const vaultSalt = (email) => 'dermscholar-vault:' + String(email || '').trim().toLowerCase();
  const VK = 'ds.sync.vk';
  const canVault = () => !!subtle || !!Native.vault;
  async function vDerive(password, email) {
    if (subtle) {
      const base = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
      const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(vaultSalt(email)), iterations: 150000 }, base, 256);
      return b64of(bits);
    }
    return Native.vault ? Native.vault('derive', { password, salt: vaultSalt(email) }) : null;
  }
  async function vSeal(key, text) {
    if (subtle) {
      const k = await subtle.importKey('raw', u8(key), 'AES-GCM', false, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(text)));
      const out = new Uint8Array(12 + ct.length);
      out.set(iv); out.set(ct, 12);
      return b64of(out);
    }
    return Native.vault ? Native.vault('seal', { key, text }) : null;
  }
  async function vOpen(key, blob) {
    try {
      if (subtle) {
        const d = u8(blob);
        const k = await subtle.importKey('raw', u8(key), 'AES-GCM', false, ['decrypt']);
        return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv: d.subarray(0, 12) }, k, d.subarray(12)));
      }
      return Native.vault ? await Native.vault('open', { key, blob }) : null;
    } catch { return null; }
  }
  async function getSecrets() {
    try {
      if (Native.exportSecretsAsync) return await Native.exportSecretsAsync();
      return Native.exportSecrets ? Native.exportSecrets() : null;
    } catch { return null; }
  }
  async function putSecrets(json) {
    try {
      if (Native.importSecretsAsync) await Native.importSecretsAsync(json);
      else Native.importSecrets?.(json);
    } catch { /* old app */ }
  }
  const hasSecrets = (json) => { try { const o = JSON.parse(json); return Object.keys(o.creds || {}).length > 0 || !!o.px?.host; } catch { return false; } };
  let vaultState = ''; // '' | 'locked' (no key yet) | 'wrong' (the account's logins didn't unlock)
  async function syncVault(mine) {
    let vault = mine.vault || null;
    const vk = localStorage.getItem(VK);
    if (!canVault() || !(Native.exportSecrets || Native.exportSecretsAsync)) return vault;
    if (!vk) { vaultState = 'locked'; return vault; }
    vaultState = '';
    const replace = store.get('sync.vaultReplace', false);
    if (vault?.blob && (vault.t || 0) > store.get('sync.vaultT', 0) && !replace) {
      const txt = await vOpen(vk, vault.blob);
      if (txt == null) { vaultState = 'wrong'; return vault; }
      await putSecrets(txt);
      origSet('sync.vaultT', vault.t);
    }
    const cur = await getSecrets();
    if (cur && hasSecrets(cur)) {
      const h = hash(cur);
      if (h !== store.get('sync.vaultH', '') || replace) {
        const blob = await vSeal(vk, cur);
        if (blob) {
          vault = { t: Date.now(), blob };
          origSet('sync.vaultT', vault.t);
          origSet('sync.vaultH', h);
          origSet('sync.vaultReplace', false);
        }
      }
    }
    return vault;
  }
  /** Makes this device's key from the account password (at sign-in, or when asked in Settings). */
  async function unlockVault(password, email) {
    if (!canVault() || !password) return;
    const k = await vDerive(password, email || S.get()?.email);
    if (k) localStorage.setItem(VK, k);
  }
  // A login or AI key changed in Settings: sync it soon.
  ext.secretsChanged = () => schedule();

  // ---------------------------------------------------------------- AI answers
  // Answers, evidence maps and explanations already written: the newest ones go along (within a
  // size budget), so the other device opens them at once instead of asking the AI again.
  const INTEL_BUDGET = 1200000;
  function intelOut() {
    const all = Object.keys(localStorage).filter((k) => k.startsWith('ds.intel.')).map((k) => {
      const v = localStorage.getItem(k) || '';
      let at = 0;
      try { at = JSON.parse(v)?.at || 0; } catch { /* not ours */ }
      return [k, v, at];
    }).filter(([, v]) => v.length < 60000).sort((x, y) => y[2] - x[2]);
    const out = {};
    let size = 0;
    for (const [k, v] of all) { if (size + v.length > INTEL_BUDGET) break; out[k] = v; size += v.length; }
    return out;
  }
  function intelIn(remote) {
    for (const [k, v] of Object.entries(remote || {})) {
      if (!k.startsWith('ds.intel.') || typeof v !== 'string' || localStorage.getItem(k) != null) continue;
      try { localStorage.setItem(k, v); } catch { return; }
    }
  }

  // ---------------------------------------------------------------- sync
  let running = false;
  let again = false;
  async function readRow(tok) {
    const uid = S.get()?.user;
    const rows = await call(`/rest/v1/user_data?select=data&user_id=eq.${encodeURIComponent(uid)}`, { token: tok });
    return rows && rows.length ? rows[0].data || {} : null;
  }
  async function sync({ quiet = true } = {}) {
    if (!signedIn()) return;
    if (running) { again = true; return; }
    running = true;
    status = 'Syncing…';
    paint();
    let changed = false;
    try {
      do {
        again = false;
        changed = (await syncOnce()) || changed;
      } while (again);
      status = '';
      store.set('sync.at', Date.now());
      if (!quiet) toast('Synced');
      if (changed) {
        await D.loadSaved?.();
        toast('Synced from your other devices');
        // Settings and lists are read at start-up: reload the screen to show what came in.
        setTimeout(() => location.reload(), 900);
      }
    } catch (e) {
      status = 'Sync failed: ' + (e.message || 'network error') + (/user_data/.test(e.message || '') ? ' (the sync server isn\'t set up yet)' : '');
      if (!quiet) toast(status);
    } finally {
      running = false;
      paint();
    }
  }
  async function syncOnce() {
    let tok = await token();
    if (!S.get().user) {
      const u = await call('/auth/v1/user', { token: tok });
      S.set({ ...S.get(), user: u.id, email: u.email });
    }
    let row;
    try { row = await readRow(tok); } catch (e) {
      if (e.code !== 401) throw e;
      tok = await token(true);
      row = await readRow(tok);
    }
    const mine = row?.[SECTION] || {};
    let changed = false;

    // Tombstones: newest removal per paper (kept 90 days).
    const deleted = { ...(mine.deleted || {}) };
    for (const [id, t] of Object.entries(store.get('sync.deleted', {}))) deleted[id] = Math.max(deleted[id] || 0, t);
    const cutoff = Date.now() - 90 * 864e5;
    for (const id of Object.keys(deleted)) if (deleted[id] < cutoff) delete deleted[id];
    origSet('sync.deleted', deleted);

    // Library: newest copy of each paper wins.
    const local = new Map((await db.all()).map((a) => [a.id, a]));
    const remote = mine.articles || {};
    const out = {};
    for (const id of new Set([...local.keys(), ...Object.keys(remote)])) {
      const l = local.get(id);
      const r = remote[id];
      const lt = l ? (l._t || l.savedAt || 0) : -1;
      const rt = r ? (r._t || r.savedAt || 0) : -1;
      const winT = Math.max(lt, rt);
      if (deleted[id] && deleted[id] >= winT) {
        if (l) { await origDel(id); changed = true; }
        continue;
      }
      if (rt > lt) {
        await origPut({ ...(l || {}), ...r });
        changed = true;
        out[id] = r;
      } else out[id] = slim(l);
      // Which papers have their PDF on some device (fetched again here in one tap).
      if (out[id] && (out[id].hadPdf || Native.hasPdf?.(id))) out[id] = { ...out[id], hadPdf: true };
    }

    // Settings, notes, highlights, projects…: newest value of each key wins.
    // On this phone's first sync, what's already in the account wins (a fresh install's
    // defaults must not overwrite it); after that, the newest change wins.
    const first = localStorage.getItem('ds.sync.sent') == null;
    const sent = store.get('sync.sent', {});
    const times = store.get('sync.times', {});
    const now = Date.now();
    for (const k of syncKeys()) {
      const h = hash(localStorage.getItem(k));
      if (sent[k] !== h) { times[k] = first ? 0 : now; sent[k] = h; }
    }
    for (const [k, rv] of Object.entries(mine.keys || {})) {
      if (!k.startsWith('ds.') || SKIP.test(k) || !rv || typeof rv.v !== 'string') continue;
      if ((first || (rv.t || 0) > (times[k] || 0)) && localStorage.getItem(k) !== rv.v) {
        try { localStorage.setItem(k, rv.v); changed = true; } catch { continue; }
        times[k] = rv.t;
        sent[k] = hash(rv.v);
      }
    }
    const keys = {};
    for (const k of syncKeys()) keys[k] = { v: localStorage.getItem(k), t: times[k] || (mine.keys?.[k] ? 0 : now) };
    origSet('sync.sent', sent);
    origSet('sync.times', times);

    intelIn(mine.intel);
    const vault = await syncVault(mine);
    const section = { v: 1, articles: out, deleted, keys, intel: intelOut(), updatedAt: Date.now() };
    if (vault) section.vault = vault;
    // Read again just before writing, so another app's changes made meanwhile are kept.
    let data = row || {};
    try { data = (await readRow(tok)) || data; } catch { /* use the first read */ }
    data[SECTION] = section;
    await call('/rest/v1/user_data', { method: 'POST', token: tok, prefer: 'resolution=merge-duplicates,return=minimal',
      body: { user_id: S.get().user, data, updated_at: new Date().toISOString() } });
    return changed;
  }

  // ---------------------------------------------------------------- sign-in screens
  async function signIn(email, password) {
    saveSession(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: email.trim(), password } }));
    await unlockVault(password, email);
    await sync();
  }
  async function signUp(email, password) {
    if (password.length < 6) throw new Error('Use a password of at least 6 characters');
    const o = await call('/auth/v1/signup', { method: 'POST', body: { email: email.trim(), password } });
    if (o && o.access_token) { saveSession(o); await unlockVault(password, email); await sync(); return 'Account created. You\'re signed in and syncing.'; }
    return `Account created. Open the confirmation email sent to ${email.trim()}, then sign in here.`;
  }
  async function googleAvailable() {
    try { return !!(await call('/auth/v1/settings'))?.external?.google; } catch { return false; }
  }
  ext.events.authRedirect = async (evt) => {
    try {
      const u = new URL(evt.url.replace('dermscholar://', 'https://x/'));
      const p = new URLSearchParams((u.hash || '').slice(1) || u.search.slice(1));
      if (p.get('error_description')) throw new Error(p.get('error_description').replace(/\+/g, ' '));
      const access = p.get('access_token');
      const refresh = p.get('refresh_token');
      if (!access || !refresh) throw new Error('Google sign-in didn\'t finish');
      const user = await call('/auth/v1/user', { token: access });
      saveSession({ access_token: access, refresh_token: refresh, expires_in: +p.get('expires_in') || 3600 }, user);
      toast('Signed in with Google. Syncing…');
      await sync();
      if (D.current.name === 'settings') render();
    } catch (e) { toast(e.message || 'Google sign-in didn\'t finish'); }
  };

  async function accountSheet() {
    sheet(`<h3>Sign in to sync</h3>
      <p class="muted small" style="margin-top:-4px">Your library, notes, highlights, projects and settings follow you to any phone. Same account as Paper2Audio.</p>
      <div id="g-slot"></div>
      <form data-form="acct">
        <label class="field">Email</label><input type="email" name="e" autocomplete="email" autocapitalize="none" value="${esc(S.get()?.email || '')}">
        <label class="field">Password</label><input type="password" name="p" autocomplete="current-password">
        <div class="actions"><button type="button" class="btn" data-act="acct-up">Create account</button><button class="btn primary">Sign in</button></div>
        <button type="button" class="linkish" data-act="acct-reset" style="margin-top:8px">Forgot password?</button>
      </form>`);
    const form = $('[data-form=acct]');
    const val = () => [form.e.value.trim(), form.p.value];
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const [em, pw] = val();
      if (!em || !pw) { toast('Enter your email and password'); return; }
      try { toast('Signing in…'); await signIn(em, pw); closeSheet(true); toast('Signed in. Syncing your library'); render(); } catch (err) { toast(err.message); }
    });
    actions['acct-up'] = async () => {
      const [em, pw] = val();
      if (!em || !pw) { toast('Enter an email and a password'); return; }
      try { const m = await signUp(em, pw); closeSheet(true); toast(m); render(); } catch (err) { toast(err.message); }
    };
    actions['acct-reset'] = async () => {
      const [em] = val();
      if (!em) { toast('Type your email first'); return; }
      try { await call('/auth/v1/recover', { method: 'POST', body: { email: em } }); toast('If there\'s an account for ' + em + ', a reset email is on its way.'); } catch (err) { toast(err.message); }
    };
    if (await googleAvailable()) {
      const slot = $('#g-slot');
      if (slot) slot.innerHTML = '<button class="btn full" data-act="acct-google" style="margin-bottom:10px">Continue with Google</button>';
      actions['acct-google'] = () => { closeSheet(true); Native.openBrowser?.(`${URL_}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(REDIRECT)}`); };
    }
  }

  // ---------------------------------------------------------------- updates
  let update = store.get('sync.update', null); // {name, code} of a newer build
  // "4.10" > "4.9": compare version names part by part.
  const newer = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  // Already installed (e.g. the update just went in): forget the offer.
  if (update && !newer(update.name, Native.version?.() || '0')) { update = null; localStorage.removeItem('ds.sync.update'); }
  ext.events.update = (evt) => {
    if (evt.state === 'available' && !newer(evt.name, Native.version?.() || '0')) evt.state = 'none';
    if (evt.state === 'available') { update = { name: evt.name, code: evt.code }; origSet('sync.update', update); paint(); if (manualCheck) offerUpdate(); }
    else if (evt.state === 'none') { update = null; localStorage.removeItem('ds.sync.update'); if (manualCheck) toast(`You have the latest version (${evt.current})`); paint(); }
    else if (evt.state === 'downloading') { const el = $('#upd-bar'); if (el) el.textContent = evt.pct >= 0 ? `Downloading the update… ${evt.pct}%` : 'Downloading the update…'; }
    else if (evt.state === 'permission') toast('Allow DermScholar to install updates, then tap Update again');
    else if (evt.state === 'installing') { const el = $('#upd-bar'); if (el) el.textContent = 'Opening the installer…'; }
    else if (evt.state === 'error') { if (manualCheck || $('#upd-bar')) toast(evt.message); paint(); }
    manualCheck = false;
  };
  let manualCheck = false;
  function offerUpdate() {
    if (!update) return;
    sheet(`<h3>Update available</h3><p class="small">DermScholar ${esc(update.name)} is ready (you have ${esc(Native.version?.() || '')}). It installs over this one; your library, notes and PDFs stay.</p>
      <button class="btn primary full" data-act="upd-go">${icon('download')}Update now</button>`);
  }
  actions['upd-go'] = () => {
    closeSheet(true);
    let el = $('#upd-bar');
    if (!el) { document.body.insertAdjacentHTML('beforeend', '<div id="upd-bar" class="upd-bar">Downloading the update…</div>'); el = $('#upd-bar'); }
    Native.updateInstall?.();
  };
  actions['upd-check'] = () => { manualCheck = true; toast('Checking for updates…'); Native.updateCheck?.(); };
  actions['upd-offer'] = () => offerUpdate();

  // ---------------------------------------------------------------- Settings card
  const prevSection = ext.settingsSection;
  ext.settingsSection = () => {
    const s = S.get();
    const at = store.get('sync.at', 0);
    const acct = signedIn()
      ? `<div class="acc-card"><div class="acc-ico">${icon('check')}</div><div class="body"><b>${esc(s.email || 'Signed in')}</b>
          <span id="sync-status">${esc(status || (at ? 'Synced ' + new Date(at).toLocaleString() : 'Not synced yet'))}</span></div>
          <button class="btn xs" data-act="sync-now">Sync now</button><button class="btn xs" data-act="acct-out">Sign out</button></div>`
      : `<div class="acc-card"><div class="acc-ico">${icon('key')}</div><div class="body"><b>Not signed in</b>
          <span>Sign in with email or Google to sync your library, notes and projects across phones.</span></div>
          <button class="btn xs primary" data-act="acct-in">Sign in</button></div>`;
    // Logins and AI keys: synced encrypted (or why not yet).
    const vk = !!localStorage.getItem(VK);
    const vault = !signedIn() || !canVault() ? '' : `<div class="acc-card"><div class="acc-ico">${icon('key')}</div><div class="body"><b>Logins & AI keys</b>
        <span>${vaultState === 'wrong' ? 'The logins in your account didn\'t unlock (password changed?). Tap Unlock.'
          : vk ? 'Synced encrypted: Research4Life, UpToDate, Springer, college proxy and AI keys follow you to every device.'
          : 'Not syncing yet: enter your DermScholar password once on this device to sync them, encrypted.'}</span></div>
        ${!vk || vaultState === 'wrong' ? '<button class="btn xs primary" data-act="vault-unlock">Unlock</button>' : ''}</div>`;
    const ver = Native.version?.() || '';
    const upd = `<div class="acc-card"><div class="acc-ico">${icon('download')}</div><div class="body"><b>DermScholar ${esc(ver)}</b>
        <span>${update ? 'Version ' + esc(update.name) + ' is available' : 'Updates install from inside the app'}</span></div>
        ${update ? '<button class="btn xs primary" data-act="upd-offer">Update</button>' : '<button class="btn xs" data-act="upd-check">Check for updates</button>'}</div>`;
    return `<div class="section"><div class="section-h"><h3>Account & sync</h3></div>${acct}${vault}</div>
      <div class="section"><div class="section-h"><h3>App updates</h3></div>${upd}</div>` + (prevSection ? prevSection() : '');
  };
  actions['acct-in'] = () => accountSheet();
  actions['vault-unlock'] = () => {
    const wrong = vaultState === 'wrong';
    sheet(`<h3>Sync logins & AI keys</h3>
      <p class="muted small" style="margin-top:-4px">Enter your DermScholar account password (${esc(S.get()?.email || '')}). Your logins are encrypted with it on this device before they're synced: the server can't read them.</p>
      <form data-form="vault"><label class="field">DermScholar password</label><input type="password" name="p" autocomplete="current-password">
        <div class="actions"><button type="button" class="btn" data-act="vault-cancel">Cancel</button><button class="btn primary">Unlock</button></div>
        ${wrong ? '<button type="button" class="linkish" data-act="vault-replace" style="margin-top:8px">Still not unlocking? Replace them with this device\'s logins</button>' : ''}</form>`);
    const form = $('[data-form=vault]');
    actions['vault-cancel'] = () => closeSheet(true);
    actions['vault-replace'] = async () => {
      const pw = form.p.value;
      if (!pw) { toast('Enter your password first'); return; }
      await unlockVault(pw);
      store.set('sync.vaultReplace', true);
      closeSheet(true);
      await sync({ quiet: false });
      render();
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = form.p.value;
      if (!pw) return;
      try {
        // Check the password with the account itself (a wrong one would lock the logins).
        await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: S.get()?.email, password: pw } }).then((o) => saveSession(o));
      } catch { toast('That isn\'t your DermScholar password'); return; }
      await unlockVault(pw);
      closeSheet(true);
      toast('Syncing your logins…');
      await sync({ quiet: false });
      render();
    });
  };
  actions['acct-out'] = () => {
    const tok = S.get()?.access;
    call('/auth/v1/logout', { method: 'POST', token: tok }).catch(() => {});
    S.clear();
    localStorage.removeItem(VK);
    toast('Signed out. Your library stays on this phone.');
    render();
  };
  actions['sync-now'] = () => sync({ quiet: false });

  // A small banner on the home screen when an update is waiting.
  const prevAfterHome = ext.afterHome;
  ext.afterHome = () => {
    prevAfterHome?.();
    if (!update || $('#upd-banner')) return;
    const top = $('.home, main, #view') || document.body;
    top.insertAdjacentHTML('afterbegin', `<button id="upd-banner" class="upd-banner" data-act="upd-offer">${icon('download')}DermScholar ${esc(update.name)} is ready — tap to update</button>`);
  };
  // Papers whose PDF another device has: fetch them here in one tap (logins come with the sync).
  const prevLibTop = ext.libraryTop;
  ext.libraryTop = (p) => {
    const before = prevLibTop ? prevLibTop(p) : '';
    if (p.q || p.f || p.c) return before;
    const want = [...(D.saved?.values() || [])].filter((a) => a.hadPdf && a.doi && !Native.hasPdf?.(a.id));
    if (!want.length || store.get('sync.pdfDismiss', 0) === want.length) return before;
    return before + `<div class="panel small" style="margin-top:8px;display:flex;gap:8px;align-items:center">${icon('download')}
      <span style="flex:1">${want.length} paper${want.length > 1 ? 's have their PDF' : ' has its PDF'} on your other device.</span>
      <button class="btn xs primary" data-act="pdf-pull">Get ${want.length > 1 ? 'them' : 'it'}</button>
      <button class="icon-btn" data-act="pdf-pull-x" aria-label="Hide">${icon('x')}</button></div>`;
  };
  actions['pdf-pull-x'] = () => { store.set('sync.pdfDismiss', [...(D.saved?.values() || [])].filter((a) => a.hadPdf && a.doi && !Native.hasPdf?.(a.id)).length); render(); };
  let pulling = false;
  actions['pdf-pull'] = async () => {
    if (pulling) { toast('Already getting them'); return; }
    pulling = true;
    const want = [...(D.saved?.values() || [])].filter((a) => a.hadPdf && a.doi && !Native.hasPdf?.(a.id));
    toast(`Getting ${want.length} PDF${want.length > 1 ? 's' : ''}… you can keep using the app`);
    // One at a time (each signs in and finds its PDF), so the sites aren't flooded.
    for (const a of want) {
      if (Native.hasPdf?.(a.id)) continue;
      try { await D.getPdf(a, { skipAsk: true }); } catch { continue; }
      for (let i = 0; i < 60 && !Native.hasPdf?.(a.id); i++) await new Promise((r) => setTimeout(r, 2000));
    }
    pulling = false;
    D.refreshPdfs?.();
  };
  function paint() {
    const el = $('#sync-status');
    if (el) el.textContent = status || 'Synced ' + new Date(store.get('sync.at', Date.now())).toLocaleString();
  }

  // ---------------------------------------------------------------- start
  const prevResume = window.App?.onResume;
  if (window.App) {
    window.App.onResume = async function () {
      const r = prevResume ? await prevResume.apply(this, arguments) : undefined;
      if (signedIn() && Date.now() - store.get('sync.at', 0) > 5 * 60000) sync();
      return r;
    };
  }
  setTimeout(() => {
    if (signedIn()) sync();
    // Updates: check at most every 6 hours.
    if (Native.updateCheck && Date.now() - store.get('sync.updCheckedAt', 0) > 6 * 3600e3) {
      origSet('sync.updCheckedAt', Date.now());
      Native.updateCheck();
    }
  }, 2500);
})();
