// Community catalog addons speaking the Stremio addon protocol
// (manifest.json + /catalog, /meta, /stream). Install any addon by URL.
import { getJson } from '../lib/http.js';
import { addons } from '../lib/store.js';

export function normalizeUrl(u) {
  u = u.trim().replace(/^stremio:\/\//i, 'https://');
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  if (!/manifest\.json(\?.*)?$/.test(u)) u = u.replace(/\/+$/, '') + '/manifest.json';
  return u;
}

const baseOf = (url) => url.replace(/\/manifest\.json(\?.*)?$/, '');
const enc = encodeURIComponent;

export async function install(rawUrl) {
  const url = normalizeUrl(rawUrl);
  const manifest = await getJson(url, { fresh: true });
  if (!manifest?.id || !manifest?.name) throw new Error('That URL is not a valid addon manifest');
  addons.set((list) => [...list.filter((a) => a.manifest.id !== manifest.id), { url, manifest }]);
  return manifest;
}

export function uninstall(id) {
  addons.set((list) => list.filter((a) => a.manifest.id !== id));
}

const hasResource = (m, name) => (m.resources || []).some((r) => (typeof r === 'string' ? r : r.name) === name);

function toBook(addon, meta) {
  return {
    uid: `addon:${addon.manifest.id}|${meta.type}|${meta.id}`,
    source: 'addon',
    addonName: addon.manifest.name,
    kind: 'audio',
    title: meta.name,
    author: [].concat(meta.director || meta.cast || meta.author || []).slice(0, 2).join(', ') || meta.releaseInfo || '',
    cover: meta.poster || meta.logo || meta.background || '',
    year: meta.releaseInfo || meta.year || '',
    description: meta.description || '',
  };
}

// Rows for the home screen: every catalog that needs no mandatory extras.
export async function catalogRows() {
  const rows = [];
  for (const a of addons.get()) {
    for (const c of a.manifest.catalogs || []) {
      const required = (c.extra || []).some((e) => e.isRequired) || (c.extraRequired || []).length;
      if (required) continue;
      rows.push({
        key: `${a.manifest.id}/${c.type}/${c.id}`,
        title: c.name || `${a.manifest.name} · ${c.type}`,
        subtitle: a.manifest.name,
        load: async () => {
          const data = await getJson(`${baseOf(a.url)}/catalog/${enc(c.type)}/${enc(c.id)}.json`);
          return (data.metas || []).map((m) => toBook(a, m));
        },
      });
    }
  }
  return rows;
}

export async function search(term) {
  const out = [];
  await Promise.all(
    addons.get().flatMap((a) =>
      (a.manifest.catalogs || [])
        .filter((c) => (c.extra || []).some((e) => e.name === 'search') || (c.extraSupported || []).includes('search'))
        .map(async (c) => {
          try {
            const data = await getJson(`${baseOf(a.url)}/catalog/${enc(c.type)}/${enc(c.id)}/search=${enc(term)}.json`);
            out.push(...(data.metas || []).map((m) => toBook(a, m)));
          } catch {}
        })
    )
  );
  const seen = new Set();
  return out.filter((b) => !seen.has(b.uid) && seen.add(b.uid));
}

function parseUid(uid) {
  const [addonId, type, ...rest] = uid.slice(6).split('|');
  const addon = addons.get().find((a) => a.manifest.id === addonId);
  if (!addon) throw new Error('This addon is no longer installed');
  return { addon, type, id: rest.join('|') };
}

async function streams(addon, type, id) {
  const data = await getJson(`${baseOf(addon.url)}/stream/${enc(type)}/${enc(id)}.json`, { fresh: true, timeout: 45000 });
  return (data.streams || []).filter((s) => s.url);
}

export async function details(book) {
  const { addon, type, id } = parseUid(book.uid);
  let meta = null;
  if (hasResource(addon.manifest, 'meta')) {
    try {
      meta = (await getJson(`${baseOf(addon.url)}/meta/${enc(type)}/${enc(id)}.json`)).meta;
    } catch {}
  }
  const b = meta ? { ...book, ...toBook(addon, meta), uid: book.uid } : book;
  const videos = (meta?.videos || [])
    .slice()
    .sort((x, y) => (x.season || 0) - (y.season || 0) || (x.episode ?? x.number ?? 0) - (y.episode ?? y.number ?? 0));
  if (videos.length) {
    return {
      ...b,
      tracks: videos.map((v, i) => ({
        title: v.title || v.name || `Part ${i + 1}`,
        index: i,
        resolve: async () => (await streams(addon, type, v.id))[0]?.url,
      })),
    };
  }
  // Single-item meta: each stream becomes a selectable version.
  return {
    ...b,
    tracks: null,
    resolveTracks: async () => {
      const list = await streams(addon, type, id);
      if (!list.length) throw new Error('The addon returned no playable streams');
      return { tracks: list.map((s, i) => ({ title: s.title || s.name || `Stream ${i + 1}`, url: s.url, index: i })) };
    },
  };
}
