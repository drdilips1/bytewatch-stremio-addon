// Music in the same cloud. Many people keep music albums and songs in TorBox / Real-Debrid
// too. An item is treated as music (and hidden unless "Show music too" is on) only when it
// clearly looks like it; anything book-like always stays.

export const BOOKISH = /\b(audio ?books?|unabridged|abridged|narrated|read by|novel|memoir|chapters?|book \d+|m4b)\b/i;
const MUSICAL = /\b(discography|albums?|ost|soundtrack|deluxe edition|remaster(ed)?|greatest hits|anthology|single|mixtape|live at|vinyl|hi-?res|24 ?bit|16 ?bit|\d{2,3}(\.\d)? ?khz|web-?flac|cd ?rip|feat\.?|ft\.)\b/i;
const AUDIO = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|wma|mka|mp4a)$/i;
const LOSSLESS = /\.(flac|wav|aiff?|alac)$/i;
const baseName = (p) => String(p).split('/').pop();

export function looksLikeMusic(name, files = []) {
  const n = String(name || '');
  if (BOOKISH.test(n)) return false;
  const fname = (f) => baseName(f.short_name || f.name || f.filename || f.path || '');
  const audio = files.filter((f) => AUDIO.test(fname(f)));
  if (audio.some((f) => /\.m4b$/i.test(fname(f)))) return false;
  if (audio.some((f) => /chapter|kapitel|chapitre|capitulo|\bpart ?\d|\bdisc ?\d+.*\bpart\b/i.test(fname(f)))) return false;
  if (MUSICAL.test(n)) return true;
  if (audio.length >= 2 && audio.filter((f) => LOSSLESS.test(fname(f))).length / audio.length > 0.5) return true;
  const sizes = audio.map((f) => Number(f.size || f.bytes) || 0);
  const total = sizes.reduce((a, b) => a + b, 0);
  // Single songs (e.g. saved by music apps like Eclipse, one track per item): 1–3 small
  // files. Even a short audiobook is rarely under ~40 MB.
  if (audio.length && audio.length <= 3 && sizes.every(Boolean) && total < 40e6) return true;
  // One lossless song ("sombr - 12 to 12.flac", ~45 MB) is bigger than that, but an audiobook
  // is almost never a single FLAC or WAV file — and if it were, it would be well over 150 MB.
  if (audio.length === 1 && LOSSLESS.test(fname(audio[0])) && sizes[0] && sizes[0] < 150e6) return true;
  // An album: 6–30 tracks of a few MB each (under ~200 MB in all), with different titles ("01 - Song name").
  if (audio.length >= 6 && audio.length <= 30 && sizes.every(Boolean)) {
    const avg = total / sizes.length;
    const stems = audio.map((f) => fname(f).replace(/\.[a-z0-9]+$/i, '').replace(/^[\d\s._\-–)(\]\[]+/, '').replace(/[\d\s._\-–]+$/, '').toLowerCase());
    const distinct = new Set(stems.filter(Boolean)).size / audio.length;
    // A whole audiobook is rarely under ~200 MB; an album usually is.
    if (avg < 12e6 && total < 200e6 && distinct >= 0.7) return true;
  }
  return false;
}
