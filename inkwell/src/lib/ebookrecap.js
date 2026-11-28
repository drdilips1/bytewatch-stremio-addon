// "Previously, in …" for ebooks: coming back to a book after a while, a short recap of the story so
// far — made only from the part you've already read (nothing later, no spoilers), with your own AI
// key (Gemini, Groq, OpenRouter, Claude…).

/** Back after this long: offer the recap when the book opens. */
export const AWAY = 7 * 864e5;

/** Offer it now? Read some of the book (2%–98%), not finished, and away a week or more. */
export function recapDue(saved, now = Date.now()) {
  if (!saved || saved.finished) return false;
  const p = Number(saved.percent) || 0;
  return p > 0.02 && p < 0.98 && now - (Number(saved.updatedAt) || now) >= AWAY;
}

/**
 * The text to recap from: the chapter titles so far and the last part read (up to `max`
 * characters, ending where you are). `blocks`: the paragraphs' texts, in order; `upTo`: the
 * paragraph you're at; `headings`: [{ text, at }] (at = paragraph index).
 */
export function readSoFar({ blocks = [], upTo = 0, headings = [], max = 14000 }) {
  const end = Math.max(0, Math.min(upTo + 1, blocks.length));
  let text = '';
  for (let i = end - 1; i >= 0 && text.length < max; i--) text = `${blocks[i]}\n${text}`;
  const chapters = headings.filter((h) => h.at < end).map((h) => h.text).slice(-30);
  return { chapters, text: text.slice(-max).trim() };
}

/** What to ask the AI: spoiler-safe, from what was read only. */
export function ebookRecapPrompt({ title = '', author = '', chapters = [], text = '' }) {
  return `Write "Previously, in ${title}${author ? ` by ${author}` : ''}": a short recap for a reader coming back to this book after a break, in 4–6 sentences — the main people, where things stand, what was about to happen.
Use ONLY the passage below (it ends exactly where the reader stopped). Never mention anything that comes later in the book, and don't guess at what happens next.${chapters.length ? `\nChapters read so far: ${chapters.join(' · ')}` : ''}
If it's non-fiction, recap the main ideas so far instead. Plain text, no markdown.

Passage (the most recent part read):
${text}`;
}
