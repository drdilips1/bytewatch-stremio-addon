// Paper to Audio / Narrato: the words being read, as on the app's player screen — the sentence
// marked and the word being spoken in the accent color, kept in view. Drawn with the browser's
// highlight ranges, so the page itself (its highlights and notes) isn't changed.
const supported = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined';
let touchedAt = 0;
['touchstart', 'wheel'].forEach((e) => addEventListener(e, () => (touchedAt = Date.now()), { passive: true, capture: true }));

/** A range over `el`'s text from character `a` to `b`. */
function rangeIn(el, a, b) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0;
  let started = false;
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const len = n.data.length;
    if (!started && a <= pos + len) {
      r.setStart(n, a - pos);
      started = true;
    }
    if (started && b <= pos + len) {
      r.setEnd(n, b - pos);
      return r;
    }
    pos += len;
  }
  return null;
}

window.__p2aSpoken = ({ i, piece, p, playing }) => {
  if (!supported) return;
  const els = document.querySelectorAll(`.reader-text [data-i="${i}"]`);
  const el = els[els.length - 1];
  const text = el?.textContent || '';
  const start = piece ? text.indexOf(piece) : -1;
  if (!el || start < 0) {
    CSS.highlights.delete('p2a-sentence');
    CSS.highlights.delete('p2a-word');
    return;
  }
  const end = start + piece.length;
  const sentence = rangeIn(el, start, end);
  if (sentence) CSS.highlights.set('p2a-sentence', new Highlight(sentence));
  if (!playing) return CSS.highlights.delete('p2a-word');
  // Where the voice is, estimated from how much of the sentence's audio has played.
  let at = start + Math.min(piece.length, Math.max(0, Math.floor(piece.length * p)));
  while (at < end && !/\s/.test(text[at])) at++;
  let wordStart = at;
  while (wordStart > start && !/\s/.test(text[wordStart - 1])) wordStart--;
  const word = at > wordStart ? rangeIn(el, wordStart, at) : null;
  if (word) CSS.highlights.set('p2a-word', new Highlight(word));
  else CSS.highlights.delete('p2a-word');
  // Keep the line being read in view (not while the page is being moved by hand).
  if (Date.now() - touchedAt < 6000) return;
  const rect = (word || sentence)?.getBoundingClientRect();
  const scroller = document.querySelector('.reader-scroll');
  if (!rect || !scroller || !rect.height) return;
  const box = scroller.getBoundingClientRect();
  if (rect.bottom > box.top + box.height * 0.75 || rect.top < box.top + box.height * 0.12)
    scroller.scrollBy({ top: rect.top - (box.top + box.height * 0.4), behavior: 'smooth' });
};
