// Merging the addon lists of your devices (Settings → Addons): both sides' addons together, minus
// those removed since they were added, rather than the newer list replacing the other (the
// Android app saving its own list used to wipe an addon just added in the web app).

/** The addon log ({ id: { added, removed } }): the later "added" and "removed" of each, from either side. */
export function mergeAddonLog(local, remote) {
  const out = { ...(remote || {}) };
  for (const [id, v] of Object.entries(local || {})) {
    const r = out[id] || {};
    out[id] = { added: Math.max(v?.added || 0, r.added || 0), removed: Math.max(v?.removed || 0, r.removed || 0) };
  }
  return out;
}

export const addonId = (a) => a?.manifest?.id || a?.special || a?.url || '';

/** Both lists together (this device's copy of one both have), minus those removed since added. */
export function mergeAddons(local, remote, log = {}) {
  const out = [];
  const seen = new Set();
  for (const a of [...(local || []), ...(remote || [])]) {
    const id = addonId(a);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const l = log?.[id];
    if (l && (l.removed || 0) > (l.added || 0)) continue;
    out.push(a);
  }
  return out;
}
