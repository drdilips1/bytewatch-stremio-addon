// Character Tracker: who's who grouped (by house / family / side), with each person's status at
// your point, and what changed since you last listened — from two X-Ray snapshots (the earlier
// chapter's and now). Pure: everything here works on X-Ray data, nothing is asked.

export const STATUSES = ['alive', 'missing', 'dead', 'unknown'];
export const statusOf = (p) => (STATUSES.includes(String(p?.status || '').toLowerCase()) ? String(p.status).toLowerCase() : 'unknown');

/** People in groups ("House Ardent", "The Free Cities"; ungrouped last as "Others"), biggest first. */
export function groupsOf(people = []) {
  const m = new Map();
  for (const p of people) {
    const g = String(p.group || '').trim() || 'Others';
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(p);
  }
  return [...m.entries()].map(([name, list]) => ({ name, list })).sort((a, b) => Number(a.name === 'Others') - Number(b.name === 'Others') || b.list.length - a.list.length);
}

/** How many met / alive / missing / dead. */
export function counts(people = []) {
  const c = { met: people.length, alive: 0, missing: 0, dead: 0, unknown: 0 };
  for (const p of people) c[statusOf(p)]++;
  return c;
}

const key = (s) => String(s || '').trim().toLowerCase();

/**
 * What changed between two snapshots: [{ kind: 'new' | 'status' | 'link', name, text }].
 * new — someone met since; status — alive → missing, say; link — a connection now known.
 */
export function changesSince(before, now) {
  if (!before?.people || !now?.people) return [];
  const old = new Map(before.people.map((p) => [key(p.name), p]));
  const out = [];
  for (const p of now.people) {
    const o = old.get(key(p.name));
    if (!o) {
      out.push({ kind: 'new', name: p.name, text: p.role || 'Met for the first time' });
      continue;
    }
    if (statusOf(o) !== statusOf(p) && statusOf(p) !== 'unknown') out.push({ kind: 'status', name: p.name, text: `${statusOf(o)} → ${statusOf(p)}` });
    const had = new Set((o.connections || []).map((c) => key(c.to)));
    for (const c of p.connections || []) if (c?.to && !had.has(key(c.to))) out.push({ kind: 'link', name: p.name, text: `${c.label || 'linked'} · ${c.to}` });
  }
  return out;
}

/** "Mira Ardent" → "MA"; and a steady colour for each name (the portrait tile). */
export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter((w) => /^\p{L}/u.test(w))
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
export function hueOf(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}
