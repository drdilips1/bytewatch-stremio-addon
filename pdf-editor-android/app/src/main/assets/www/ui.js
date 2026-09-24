'use strict';
/* Toolbar tabs, themes & settings, error reporting, and optional account/cloud sync (Supabase). */

// ------------------------------------------------------------------ toolbar tabs
function toolTab(tool) {
  const b = document.querySelector(`#toolRow .tool[data-tool="${tool}"]`);
  return b ? b.dataset.cat : null;
}

function showToolTab(cat) {
  if (!cat) return;
  $$('#toolTabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === cat));
  $$('#toolRow .tool').forEach(b => { b.hidden = b.dataset.cat !== cat; });
  $('#toolRow').scrollLeft = 0;
}

// ------------------------------------------------------------------ themes
const ACCENTS = [
  { name: 'Red', c: '#d93025', d: '#b3261e' },
  { name: 'Blue', c: '#1a73e8', d: '#1558b0' },
  { name: 'Teal', c: '#00897b', d: '#00695c' },
  { name: 'Green', c: '#188038', d: '#0d652d' },
  { name: 'Purple', c: '#8430ce', d: '#681da8' },
  { name: 'Pink', c: '#d01884', d: '#a0106a' },
  { name: 'Orange', c: '#e8710a', d: '#b85600' },
  { name: 'Slate', c: '#455a64', d: '#263238' }
];

function loadSettings() {
  try { return Object.assign({ mode: 'system', accent: 'Red' }, JSON.parse(localStorage.getItem('settings') || '{}')); } catch (e) { return { mode: 'system', accent: 'Red' }; }
}

function saveSettings(st) {
  try { localStorage.setItem('settings', JSON.stringify(st)); } catch (e) { /* ignore */ }
  settingsChanged();
}

const darkQuery = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;

function applyTheme() {
  const st = loadSettings();
  const dark = st.mode === 'dark' || (st.mode === 'system' && darkQuery && darkQuery.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  const a = ACCENTS.find(x => x.name === st.accent) || ACCENTS[0];
  const n = parseInt(a.c.slice(1), 16);
  root.style.setProperty('--accent', dark ? a.c : a.c);
  root.style.setProperty('--accent-dark', dark ? a.d : a.d);
  root.style.setProperty('--accent-soft', `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${dark ? 0.22 : 0.12})`);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', a.d);
}

function openSettings() {
  const st = loadSettings();
  showOptions('Theme & settings', `<div class="opt-form">
    <label class="prop-label">Appearance</label>
    <div class="seg" id="setMode">
      <button class="chip" data-mode="system">System</button>
      <button class="chip" data-mode="light">Light</button>
      <button class="chip" data-mode="dark">Dark</button>
    </div>
    <label class="prop-label">Accent colour</label>
    <div class="accents" id="setAccent">${ACCENTS.map(a => `<button class="swatch" title="${a.name}" data-accent="${a.name}" style="background:${a.c}"></button>`).join('')}</div>
    <hr style="border:0;border-top:1px solid var(--line);width:100%">
    <button class="chip" id="setAccount"><span data-icon="account"></span>Account &amp; sync</button>
    <div class="opt-note">Theme and signatures sync to your other devices when you are signed in.</div>
  </div>`);
  const mark = () => {
    const s = loadSettings();
    $$('#setMode .chip').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    $$('#setAccent .swatch').forEach(b => b.classList.toggle('on', b.dataset.accent === s.accent));
  };
  mark();
  $$('#setMode .chip').forEach(b => { b.onclick = () => { saveSettings(Object.assign(loadSettings(), { mode: b.dataset.mode })); applyTheme(); mark(); }; });
  $$('#setAccent .swatch').forEach(b => { b.onclick = () => { saveSettings(Object.assign(loadSettings(), { accent: b.dataset.accent })); applyTheme(); mark(); }; });
  $('#setAccount').onclick = () => { closeOptions(); openAccount(); };
  void st;
}

// ------------------------------------------------------------------ errors never fail silently
function reportError(msg) {
  if (!msg || /ResizeObserver|Script error\.?$/i.test(msg)) return;
  if (!$('#busy').hidden && !busy.cancel) busy(false);
  toast('Something went wrong: ' + String(msg).slice(0, 140), 6000);
}

// ------------------------------------------------------------------ account & cloud sync (Supabase)
const CFG = window.PDF_EDITOR_CONFIG || {};
const syncConfigured = () => !!(CFG.supabaseUrl && CFG.supabaseKey);
let sb = null;          // supabase client
let sbUser = null;

async function getClient() {
  if (sb) return sb;
  if (!window.supabase) await loadScript('lib/supabase.js');
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  sb.auth.onAuthStateChange((event, session) => {
    const was = sbUser && sbUser.id;
    sbUser = session ? session.user : null;
    updateAccountLabel();
    if (event === 'PASSWORD_RECOVERY') setNewPassword();
    if (sbUser && sbUser.id !== was) pullSettings();
  });
  return sb;
}

function updateAccountLabel() {
  const el = $('#menuAcct');
  if (el) el.textContent = sbUser ? sbUser.email : (syncConfigured() ? 'Not signed in' : 'Offline mode');
}

function netError(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  toast(/fetch|network|Failed to/i.test(m) ? 'No internet connection' : m, 5000);
}

async function openAccount() {
  if (!syncConfigured()) {
    showOptions('Account & sync', `<div class="opt-form">
      <div class="opt-note">Sign-in and syncing are not switched on in this copy of the app yet.
      Everything still works offline on this device.</div>
      <div class="opt-note">(For the app owner: create a free Supabase project, run <b>supabase-setup.sql</b>,
      and put its URL and public key in <b>config.js</b>.)</div>
    </div>`);
    return;
  }
  try { await getClient(); } catch (e) { netError(e); return; }
  if (!sbUser) {
    const { data } = await sb.auth.getSession();
    sbUser = data && data.session ? data.session.user : null;
  }
  if (!sbUser) return showLogin();
  showOptions('Account & sync', `<div class="opt-form">
    <div class="acct-card"><div class="acct-avatar">${(sbUser.email || '?')[0].toUpperCase()}</div>
      <div style="flex:1;min-width:0"><b style="word-break:break-all">${escapeHtml(sbUser.email)}</b><div class="opt-note">Theme and signatures are synced.</div></div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="chip primary" id="acUpload"${S.pages.length ? '' : ' disabled'}><span data-icon="cloud"></span>Save current PDF to cloud</button>
      <button class="chip" id="acRefresh">Refresh</button>
    </div>
    <label class="prop-label">Cloud files</label>
    <div class="cloud-list" id="cloudList"><div class="opt-note">Loading…</div></div>
    <button class="chip" id="acLogout"><span data-icon="logout"></span>Sign out</button>
  </div>`);
  $('#acUpload').onclick = () => saveToCloud().then(renderCloudList);
  $('#acRefresh').onclick = renderCloudList;
  $('#acLogout').onclick = async () => { await sb.auth.signOut(); sbUser = null; updateAccountLabel(); closeOptions(); toast('Signed out'); };
  renderCloudList();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function showLogin() {
  showOptions('Sign in', `<div class="opt-form">
    <div class="opt-note">Sign in to keep your PDFs, signatures and theme in sync on all your devices.</div>
    <input type="email" id="lgEmail" placeholder="Email" autocomplete="email">
    <input type="password" id="lgPass" placeholder="Password (min. 6 characters)" autocomplete="current-password">
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="chip primary" id="lgIn">Sign in</button>
      <button class="chip" id="lgUp">Create account</button>
    </div>
    <button class="chip" id="lgForgot" style="align-self:flex-start">Forgot password?</button>
  </div>`);
  const creds = () => ({ email: $('#lgEmail').value.trim(), password: $('#lgPass').value });
  $('#lgIn').onclick = async () => {
    const c = creds();
    if (!c.email || !c.password) { toast('Enter email and password'); return; }
    busy(true, 'Signing in…');
    const { data, error } = await sb.auth.signInWithPassword(c).catch(e => ({ error: e }));
    busy(false);
    if (error) { netError(error); return; }
    sbUser = data.user;
    updateAccountLabel();
    toast('Signed in');
    openAccount();
  };
  $('#lgUp').onclick = async () => {
    const c = creds();
    if (!c.email || c.password.length < 6) { toast('Enter an email and a password of at least 6 characters'); return; }
    busy(true, 'Creating account…');
    const { data, error } = await sb.auth.signUp(Object.assign(c, { options: { emailRedirectTo: CFG.webAppUrl } })).catch(e => ({ error: e }));
    busy(false);
    if (error) { netError(error); return; }
    if (data.session) { sbUser = data.user; updateAccountLabel(); toast('Account created'); openAccount(); }
    else await dialog({ title: 'Check your email', body: `We sent a confirmation link to ${c.email}. Open it, then come back and sign in.`, cancel: null });
  };
  $('#lgForgot').onclick = async () => {
    const email = $('#lgEmail').value.trim();
    if (!email) { toast('Enter your email first'); return; }
    busy(true, 'Sending…');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: CFG.webAppUrl }).catch(e => ({ error: e }));
    busy(false);
    if (error) { netError(error); return; }
    await dialog({ title: 'Check your email', body: 'We sent a link to set a new password.', cancel: null });
  };
}

async function setNewPassword() {
  const pw = await dialog({ title: 'Set a new password', input: { type: 'password' }, ok: 'Save' });
  if (!pw) return;
  const { error } = await sb.auth.updateUser({ password: pw });
  if (error) netError(error); else toast('Password updated');
}

const userPath = p => `${sbUser.id}/${p}`;

async function renderCloudList() {
  const box = $('#cloudList');
  if (!box || !sbUser) return;
  const { data, error } = await sb.storage.from('pdfs').list(userPath('files'), { limit: 200, sortBy: { column: 'updated_at', order: 'desc' } }).catch(e => ({ error: e }));
  if (!$('#cloudList')) return;
  if (error) { box.innerHTML = `<div class="opt-note">Could not load: ${escapeHtml(error.message || error)}</div>`; return; }
  const files = (data || []).filter(f => f.name && !f.name.startsWith('.'));
  if (!files.length) { box.innerHTML = '<div class="opt-note">No files yet. Open a PDF and use “Save current PDF to cloud”.</div>'; return; }
  box.innerHTML = files.map((f, i) => `<div class="cloud-item">
      <span data-icon="blank"></span>
      <div class="nm">${escapeHtml(f.name)}<div class="meta">${f.metadata && f.metadata.size ? fmtSize(f.metadata.size) + ' · ' : ''}${f.updated_at ? new Date(f.updated_at).toLocaleString() : ''}</div></div>
      <button class="chip" data-open="${i}">Open</button>
      <button class="chip danger" data-del="${i}" title="Delete"><span data-icon="delete"></span></button>
    </div>`).join('');
  applyIcons(box);
  box.querySelectorAll('[data-open]').forEach(b => { b.onclick = () => openCloudFile(files[+b.dataset.open].name); });
  box.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      const name = files[+b.dataset.del].name;
      const ok = await dialog({ title: 'Delete from cloud?', body: name, ok: 'Delete' });
      if (!ok) return;
      const { error } = await sb.storage.from('pdfs').remove([userPath('files/' + name)]);
      if (error) netError(error); else renderCloudList();
    };
  });
}

async function openCloudFile(name) {
  if (S.dirty && S.pages.length) {
    const ok = await dialog({ title: 'Open ' + name + '?', body: 'Unsaved changes to the current document will be lost.', ok: 'Open' });
    if (!ok) return;
  }
  closeOptions();
  busy(true, 'Downloading…');
  const { data, error } = await sb.storage.from('pdfs').download(userPath('files/' + name)).catch(e => ({ error: e }));
  busy(false);
  if (error) { netError(error); return; }
  await openPdf(await data.arrayBuffer(), name);
}

async function saveToCloud() {
  if (!syncConfigured()) { openAccount(); return; }
  await getClient();
  if (!sbUser) { toast('Sign in first'); showLogin(); return; }
  if (!S.pages.length) return;
  finishEditing();
  busy(true, 'Uploading to cloud…');
  try {
    const { bytes } = await buildPdf(S.pages, false);
    const name = S.name.toLowerCase().endsWith('.pdf') ? S.name : S.name + '.pdf';
    const { error } = await sb.storage.from('pdfs').upload(userPath('files/' + name), new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' });
    if (error) throw error;
    S.dirty = false;
    toast('Saved to cloud: ' + name);
  } catch (e) {
    netError(e);
  } finally {
    busy(false);
  }
}

// Settings (theme, signatures, OCR language) as one small JSON file per user.
function localSyncData() {
  let sigs = [];
  try { sigs = JSON.parse(localStorage.getItem('signatures') || '[]'); } catch (e) { /* ignore */ }
  let ocrLang = 'eng';
  try { ocrLang = localStorage.getItem('ocrLang') || 'eng'; } catch (e) { /* ignore */ }
  return { settings: loadSettings(), signatures: sigs, ocrLang, updatedAt: Date.now() };
}

let pushTimer = null;
let applyingRemote = false;
function settingsChanged() {
  if (applyingRemote || !sbUser) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSettings, 1500);
}

async function pushSettings() {
  if (!sbUser) return;
  const blob = new Blob([JSON.stringify(localSyncData())], { type: 'application/json' });
  await sb.storage.from('pdfs').upload(userPath('settings.json'), blob, { upsert: true, contentType: 'application/json' }).catch(() => {});
}

async function pullSettings() {
  if (!sbUser) return;
  const { data, error } = await sb.storage.from('pdfs').download(userPath('settings.json')).catch(e => ({ error: e }));
  if (error || !data) { pushSettings(); return; }
  try {
    const remote = JSON.parse(await data.text());
    applyingRemote = true;
    if (remote.settings) localStorage.setItem('settings', JSON.stringify(remote.settings));
    const local = localSyncData().signatures;
    const merged = [...(remote.signatures || []), ...local.filter(s => !(remote.signatures || []).includes(s))].slice(0, 6);
    localStorage.setItem('signatures', JSON.stringify(merged));
    if (remote.ocrLang) localStorage.setItem('ocrLang', remote.ocrLang);
    applyTheme();
  } catch (e) { /* ignore corrupt file */ } finally {
    applyingRemote = false;
  }
  pushSettings();
}

// ------------------------------------------------------------------ wiring
(function initUi() {
  applyTheme();
  if (darkQuery && darkQuery.addEventListener) darkQuery.addEventListener('change', applyTheme);
  $$('#toolTabs button').forEach(b => { b.onclick = () => showToolTab(b.dataset.tab); });
  showToolTab('edit');
  $('#busyCancel').onclick = () => { if (busy.cancel) busy.cancel(); };
  window.addEventListener('error', e => reportError(e.message));
  window.addEventListener('unhandledrejection', e => reportError(e.reason && (e.reason.message || e.reason)));
  $$('[data-home="cloud"]').forEach(b => { b.onclick = openAccount; });
  $$('[data-home="settings"]').forEach(b => { b.onclick = openSettings; });
  updateAccountLabel();
  // Restore a signed-in session (and handle e-mail links) when sync is set up.
  if (syncConfigured() && navigator.onLine !== false) {
    getClient().then(c => c.auth.getSession()).then(({ data }) => {
      sbUser = data && data.session ? data.session.user : null;
      updateAccountLabel();
      if (sbUser) pullSettings();
    }).catch(() => {});
  }
})();
