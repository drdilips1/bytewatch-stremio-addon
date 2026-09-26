// "Source" addons in the InkShelf declarative format: the manifest describes an
// HTTP request (with {TITLE}/{AUTHOR}/{QUERY} placeholders) and how to map the
// JSON response into results carrying a magnet link / info-hash. Inkwell hands
// the magnet to the user's TorBox or Real-Debrid account to stream it.
import { getJson, sendJson } from '../lib/http.js';
import { addons } from '../lib/store.js';
import { words } from '../lib/match.js';
import { infoHash, torboxCached } from './debrid.js';

export const isSourceManifest = (m) => !!(m && typeof m === 'object' && m.id && m.name && m.adapters?.source?.request?.url);

export const sourceAddons = () => addons.get().filter((a) => a.kind === 'source');

// ---- helpers ----------------------------------------------------------------
function fill(v, vars, encode) {
  if (typeof v === 'string')
    return v.replace(/\{(TITLE|AUTHOR|QUERY|NARRATOR|ISBN|LIMIT)\}/gi, (_, k) => {
      const val = vars[k.toUpperCase()] ?? '';
      return encode ? encodeURIComponent(val) : val;
    });
  if (Array.isArray(v)) return v.map((x) => fill(x, vars, encode));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, vars, encode)]));
  return v;
}

const at = (obj, path) =>
  !path ? obj : String(path).split('.').reduce((o, k) => (o == null ? undefined : Array.isArray(o) && /^\d+$/.test(k) ? o[+k] : o[k]), obj);

// Share of the wanted title's words found in a result title, 0..1 — release
// names carry lots of extra words (author, format, uploader), so containment
// works better than symmetric similarity here.
function similarity(wanted, title) {
  const A = new Set(words(wanted)), B = new Set(words(title));
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => B.has(w) && n++);
  return n / A.size;
}

export function fmtSize(bytes) {
  const n = Number(bytes);
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${u[i]}`;
}

// Per-addon rate limiting + short result cache.
const calls = new Map();
const cache = new Map();
// Respect an addon's requests-per-minute by waiting for a free slot instead of
// failing the search.
async function takeSlot(addon) {
  const rpm = addon.manifest.rateLimit?.requestsPerMinute;
  if (!rpm) return;
  for (let tries = 0; tries < 30; tries++) {
    const now = Date.now();
    const recent = (calls.get(addon.manifest.id) || []).filter((t) => now - t < 60e3);
    if (recent.length < rpm) {
      recent.push(now);
      calls.set(addon.manifest.id, recent);
      return;
    }
    calls.set(addon.manifest.id, recent);
    await new Promise((r) => setTimeout(r, Math.min(5000, 60e3 - (now - recent[0]) + 50)));
  }
  throw new Error(`${addon.manifest.name}: too many searches right now — try again in a minute`);
}

function cachedFlag(v) {
  if (v === true) return { any: true };
  if (!v || typeof v !== 'object') return { any: false };
  const flat = JSON.stringify(v).toLowerCase();
  return {
    torbox: /torbox|"tb"/.test(flat) && /true|cached|instant/.test(flat) ? !!(v.torbox ?? v.tb ?? v.TorBox ?? true) : false,
    realdebrid: /real|"rd"/.test(flat) && /true|cached|instant/.test(flat) ? !!(v.realdebrid ?? v.rd ?? v.RealDebrid ?? v['real-debrid'] ?? true) : false,
    any: /true|cached|instant/.test(flat),
  };
}

// ---- search ------------------------------------------------------------------
async function run(addon, params) {
  // Try the precise search first; if it finds nothing, widen it (title only, then
  // the plain query) and retry once after a network hiccup.
  const { title = '', author = '', query = '' } = params;
  const attempts = [params];
  if (author) attempts.push({ title, query });
  let lastErr = null;
  for (const p of attempts) {
    for (let retry = 0; retry < 2; retry++) {
      try {
        const r = await runOnce(addon, p);
        if (r.length) return r;
        break;
      } catch (e) {
        lastErr = e;
        if (e.final || /too many searches/.test(e.message)) throw e;
        await new Promise((res) => setTimeout(res, 1500));
      }
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function runOnce(addon, { title = '', author = '', query = '' }) {
  const src = addon.manifest.adapters.source;
  const vars = { TITLE: title || query, AUTHOR: author, QUERY: query || [title, author].filter(Boolean).join(' '), LIMIT: '20' };
  const key = addon.manifest.id + '|' + JSON.stringify(vars);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 10 * 60e3) return hit.v;
  await takeSlot(addon);

  const req = src.request || {};
  const method = (req.method || 'GET').toUpperCase();
  const url = fill(req.url, vars, true);
  const headers = req.headers || {};
  const timeout = req.timeout || 30000;
  const data =
    method === 'GET'
      ? await getJson(url, { headers, timeout, fresh: true })
      : await sendJson(url, method, fill(req.body || {}, vars, false), headers);

  const res = src.response || {};
  const list = at(data, res.resultsPath);
  // Say why nothing shows instead of failing silently (these aren't retried).
  const why = (msg) => Object.assign(new Error(msg), { final: true });
  const hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
  if ((list === undefined && hasData) || (list != null && !Array.isArray(list)))
    throw why(`unexpected reply — no result list at "${res.resultsPath || '(top level)'}" (keys: ${Object.keys(data || {}).slice(0, 6).join(', ')})`);
  const map = res.mapping || {};
  const get = (row, field) => (map[field] ? at(row, map[field]) : row[field]);
  const threshold = addon.manifest.matching?.threshold ?? 0;
  const wanted = title || query;

  const all = (Array.isArray(list) ? list : [])
    .map((row, i) => {
      const r = {
        key: `${addon.manifest.id}:${i}:${get(row, 'infoHash') || get(row, 'title')}`,
        addon: addon.manifest.name,
        title: String(get(row, 'title') || 'Untitled'),
        author: get(row, 'author') || '',
        narrator: get(row, 'narrator') || '',
        magnet: get(row, 'magnetUrl') || get(row, 'magnet') || '',
        hash: '',
        size: Number(get(row, 'sizeBytes')) || 0,
        seeders: Number(get(row, 'seeders')) || 0,
        format: get(row, 'format') || '',
        language: get(row, 'language') || '',
        date: get(row, 'date') || '',
        cache: cachedFlag(get(row, 'debridCache')),
        link: get(row, 'downloadUrl') || get(row, 'url') || get(row, 'link') || get(row, 'pageUrl') || '',
      };
      r.hash = infoHash(r.magnet, get(row, 'infoHash'));
      r.score = wanted ? similarity(wanted, r.title) : 1;
      return r;
    })
    .filter((r) => r.magnet || r.hash || /^https?:/i.test(r.link));
  if (list?.length && !all.length) throw why(`found ${list.length} result${list.length === 1 ? '' : 's'} but none had a magnet, info-hash or link — check the addon's mapping`);
  // Keep close matches; if the addon's threshold would hide everything, show the best few anyway.
  const close = all.filter((r) => r.score >= Math.min(threshold, 0.9));
  const results = close.length ? close : all.filter((r) => r.score >= 0.34).slice(0, 8);

  // Mark results TorBox can stream instantly.
  const instant = await torboxCached(results.map((r) => r.hash));
  results.forEach((r) => instant.has(r.hash) && (r.cache = { ...r.cache, torbox: true, any: true }));

  results.sort((a, b) => Number(b.cache.any) - Number(a.cache.any) || Number(b.seeders > 0) - Number(a.seeders > 0) || b.score - a.score || b.seeders - a.seeders);
  // Only remember searches that found something, so a temporary empty answer isn't sticky.
  if (results.length) cache.set(key, { t: Date.now(), v: results });
  return results;
}

/** Search all installed source addons; `onResult(addonName, results, error)` per addon. */
export function searchSources(params, onResult) {
  return Promise.all(
    sourceAddons().map((a) =>
      run(a, params)
        .then((r) => onResult(a.manifest.name, r, null))
        .catch((e) => onResult(a.manifest.name, [], e))
    )
  );
}
