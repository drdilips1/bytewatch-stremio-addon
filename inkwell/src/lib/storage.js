// Storage: what Audiohub+ keeps on the phone, so the big parts can be seen and cleared. On
// 27 Nov one phone showed 3.73 GB of app data: mostly Mobilism books unpacked on the phone
// (kept for good), including folders left behind by unpacks that failed or whose download entry
// was lost — nothing could delete those. Pure: the Storage card does the asking and deleting.

/** 1536000 → "1.5 MB", 3.73e9 → "3.5 GB". */
export function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024 * 1024) return `${Math.max(0, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

const norm = (p) => decodeURIComponent(String(p || '').replace(/^file:\/\//, '')).replace(/\/+$/, '');

/**
 * The unpacked folders, each with the download that plays from it (or none: a leftover).
 * `folders`: [{ name, path, size, at }]; `downloads`: the downloads store ({ uid: { folder, tracks } }).
 * Biggest first.
 */
export function unpackedRows(folders = [], downloads = {}) {
  const owners = Object.entries(downloads || {}).map(([uid, d]) => ({ uid, d, paths: [norm(d?.folder), ...(d?.tracks || []).map((t) => norm(t.uri))].filter(Boolean) }));
  return folders
    .map((f) => {
      const p = norm(f.path);
      const own = owners.find((o) => o.paths.some((x) => x === p || x.startsWith(p + '/')));
      return { ...f, uid: own?.uid || '', title: own?.d?.book?.title || f.name, leftover: !own };
    })
    .sort((a, b) => (b.size || 0) - (a.size || 0));
}

/** What the leftovers add up to. */
export const leftoverBytes = (rows) => rows.filter((r) => r.leftover).reduce((n, r) => n + (r.size || 0), 0);
