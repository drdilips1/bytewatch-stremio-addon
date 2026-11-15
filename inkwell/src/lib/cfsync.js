// Audiohub's own sync (on the api.audiohubapp.com Worker): your data is encrypted on this
// phone with your password before it's sent — the server keeps only scrambled bytes and
// never sees your email (only a hash of it) or your password.
//
// From your email + password, one slow key derivation (PBKDF2, 210,000 rounds) gives two
// separate keys: one to sign in with (sent), one to encrypt with (never leaves the phone).
// Forgotten password = the synced copy can't be opened by anyone; this phone keeps everything.

export const SYNC_BASE = 'https://api.audiohubapp.com/sync';
const te = new TextEncoder();
const td = new TextDecoder();

const b64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Who you are to the server (a hash of the email), the sign-in key, and the encryption key. */
export async function deriveKeys(email, password) {
  const mail = String(email || '').trim().toLowerCase();
  const user = hex(await crypto.subtle.digest('SHA-256', te.encode('audiohub-user:' + mail)));
  const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('audiohub-sync:' + mail), iterations: 210000 }, base, 512);
  const all = new Uint8Array(bits);
  return { user, auth: b64(all.slice(32)), key: b64(all.slice(0, 32)) };
}

const aesKey = (key) => crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
const canZip = typeof CompressionStream !== 'undefined';
async function zip(bytes, how) {
  const s = new Blob([bytes]).stream().pipeThrough(how === 'in' ? new CompressionStream('gzip') : new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

/** Any JSON value → "v1.<z|n>.<iv>.<data>" (gzip when the phone can, then AES-GCM). */
export async function seal(value, key) {
  let bytes = te.encode(JSON.stringify(value));
  const z = canZip;
  if (z) bytes = await zip(bytes, 'in');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), bytes);
  return `v1.${z ? 'z' : 'n'}.${b64(iv)}.${b64(data)}`;
}

/** Back from seal(); throws when the password (key) doesn't fit. */
export async function open(blob, key) {
  const [v, z, iv, data] = String(blob || '').split('.');
  if (v !== 'v1' || !iv || !data) throw new Error('Not a copy this app can read');
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(key), unb64(data)));
  } catch {
    throw new Error("Your synced copy couldn't be opened with this password");
  }
  if (z === 'z') bytes = await zip(bytes, 'out');
  return JSON.parse(td.decode(bytes));
}

async function call(path, { method = 'POST', body, token } = {}) {
  const r = await fetch(SYNC_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || `Sync server: HTTP ${r.status}`), { status: r.status, data: d });
  return d;
}

export const signup = (user, auth) => call('/signup', { body: { user, auth } });
export const login = (user, auth) => call('/login', { body: { user, auth } });
export const getData = (token) => call('/data', { method: 'GET', token });
export const putData = (token, blob, base) => call('/data', { method: 'PUT', token, body: { blob, base } });
export const logout = (token) => call('/logout', { token }).catch(() => {});
export const deleteAccount = (token) => call('/delete', { token });
