// Story helpers powered by Google Gemini (your own free API key): a spoiler-safe
// recap of the story so far / the previous chapter, and a character glossary
// that only knows what has happened up to where you are.
import { persisted } from './store.js';
import * as player from './player.js';
import { heardText } from './transcript.js';

export const ai = persisted('ai', { geminiKey: '', model: '' });
export const aiReady = () => !!ai.get().geminiKey.trim();

const MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.0-flash'];
const cache = persisted('aiCache', {}); // prompt key -> { t, v }

async function gemini(prompt, { json = false } = {}) {
  const key = ai.get().geminiKey.trim();
  if (!key) throw new Error('Add your free Gemini API key in Settings → AI first');
  const models = ai.get().model ? [ai.get().model, ...MODELS.filter((m) => m !== ai.get().model)] : MODELS;
  let last;
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    if (res.status === 404) {
      last = new Error(`Model ${model} not available`);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini error ${res.status}`;
      if (res.status === 400 && /API key/i.test(msg)) throw new Error('Gemini rejected the API key — check it in Settings → AI');
      if (res.status === 429) throw new Error('Gemini free limit reached for now — try again in a minute');
      throw new Error(msg);
    }
    if (ai.get().model !== model) ai.patch({ model });
    const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) throw new Error(data.promptFeedback?.blockReason ? `Gemini declined (${data.promptFeedback.blockReason})` : 'Gemini returned nothing');
    return text;
  }
  throw last || new Error('No Gemini model available');
}

export async function testKey() {
  const t = await gemini('Reply with the single word OK.');
  return /ok/i.test(t) ? 'Gemini is working' : t.slice(0, 60);
}

/** Where the listener is: chapter title, number, and % through the book. */
export function position(upToChapter) {
  const ps = player.getState();
  const b = ps.book;
  if (!b) throw new Error('Start a book first');
  const chapters = player.chapters();
  const g = player.globalTime();
  const total = player.totalDuration() || 0;
  let ci = chapters.findIndex((c) => g >= c.start && g < (c.end || Infinity));
  if (ci < 0) ci = Math.max(0, chapters.length - 1);
  const at = upToChapter != null ? Math.min(upToChapter, ci) : ci;
  const pct = total ? Math.round(((upToChapter != null && upToChapter < ci ? chapters[at].end || g : g) / total) * 100) : null;
  return {
    book: b,
    chapters,
    current: ci,
    at,
    pct,
    label: `${chapters[at]?.title || `Part ${at + 1}`} (${at + 1} of ${chapters.length || 1})${pct != null ? `, about ${pct}% through the book` : ''}`,
    heard: heardText(b.uid, ps.index, ps.time),
  };
}

const bookLine = (b) => `"${b.title}"${b.author ? ` by ${b.author}` : ''}`;
const RULES = `Strict spoiler rules: use ONLY events and facts revealed up to and including the listener's current position. Never mention, hint at or foreshadow anything later — no deaths, twists, reveals or fates that happen afterwards. If you are not sure whether something has happened yet, leave it out. If you don't know this book and the transcript is empty, say so briefly instead of inventing.`;

async function cached(key, fn) {
  const hit = cache.get()[key];
  if (hit && Date.now() - hit.t < 30 * 86400e3) return hit.v;
  const v = await fn();
  cache.set((c) => {
    const keys = Object.keys(c);
    const next = keys.length > 60 ? Object.fromEntries(keys.slice(-40).map((k) => [k, c[k]])) : { ...c };
    next[key] = { t: Date.now(), v };
    return next;
  });
  return v;
}

/** mode: 'story' (the story so far) or 'chapter' (the previous chapter). */
export async function recap(mode = 'story') {
  const p = position();
  const target = mode === 'chapter' ? Math.max(0, p.current - 1) : p.current;
  const key = `recap:${p.book.uid}:${mode}:${target}`;
  return cached(key, () =>
    gemini(
      `You help someone listening to the audiobook ${bookLine(p.book)}. They are at: ${p.label}.
${mode === 'chapter' ? `Write a recap of the previous chapter (${p.chapters[target]?.title || `part ${target + 1}`}) only.` : 'Write "The story so far": a recap of everything up to their current position.'}
${RULES}
Style: warm, clear, spoken-friendly prose (it may be read aloud), ${mode === 'chapter' ? '120–200' : '200–350'} words, no headings or bullet points, no preamble.
${p.heard ? `Transcript of what they have heard (may contain recognition errors; trust it over your memory for this edition):\n"""${p.heard}"""` : ''}`
    )
  );
}

/** Characters known up to a chapter index (defaults to the current one). */
export async function characters(upToChapter) {
  const p = position(upToChapter);
  const key = `chars:${p.book.uid}:${p.at}`;
  const raw = await cached(key, () =>
    gemini(
      `List the characters of the audiobook ${bookLine(p.book)} as known to a listener who has reached: ${p.label}.
${RULES}
Return JSON: {"characters":[{"name":"","aliases":[""],"role":"one short line","about":"2–3 sentences, only what is known by this point"}]}. At most 20 characters, most important first. Omit characters who have not appeared yet.
${p.heard ? `Transcript of what they have heard:\n"""${p.heard}"""` : ''}`,
      { json: true }
    )
  );
  try {
    const d = JSON.parse(raw);
    return { position: p, list: (d.characters || []).filter((c) => c && c.name) };
  } catch {
    throw new Error('Gemini sent an unexpected reply — try again');
  }
}
