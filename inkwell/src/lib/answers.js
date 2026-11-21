// Answers worth keeping for hours (iTunes searches, Hardcover book searches): kept on the device
// in the browser's Cache Storage, so a book seen this morning doesn't ask iTunes again tonight.
// Each service limits how often it may be asked (iTunes refused ~950 of 1,000 requests on 21 Nov).
// Falls back to memory where Cache Storage isn't there.
const NAME = 'inkwell-answers-v1';
const mem = new Map();
const slot = (key) => `https://answers.local/${encodeURIComponent(key).slice(0, 1500)}`;

async function box() {
  try {
    return typeof caches !== 'undefined' ? await caches.open(NAME) : null;
  } catch {
    return null;
  }
}

/** The kept answer for `key` if younger than `ttl` ms, else undefined. */
export async function keptAnswer(key, ttl) {
  const m = mem.get(key);
  if (m && Date.now() - m.t < ttl) return m.v;
  const c = await box();
  if (!c) return undefined;
  try {
    const r = await c.match(slot(key));
    if (!r) return undefined;
    const { t, v } = await r.json();
    if (Date.now() - t >= ttl) return undefined;
    mem.set(key, { t, v });
    return v;
  } catch {
    return undefined;
  }
}

/** Keep an answer (only good answers: refusals and errors are never kept). */
export async function keepAnswer(key, v) {
  mem.set(key, { t: Date.now(), v });
  if (mem.size > 300) mem.delete(mem.keys().next().value);
  const c = await box();
  if (!c) return;
  try {
    await c.put(slot(key), new Response(JSON.stringify({ t: Date.now(), v }), { headers: { 'Content-Type': 'application/json' } }));
  } catch {}
}

/** `fn()`'s answer, kept for `ttl` ms under `key`. */
export async function remembered(key, ttl, fn) {
  const hit = await keptAnswer(key, ttl);
  if (hit !== undefined) return hit;
  const v = await fn();
  if (v != null) keepAnswer(key, v);
  return v;
}
