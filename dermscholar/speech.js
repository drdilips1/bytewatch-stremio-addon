// Turns document text into something that sounds right when spoken: citations, statistics,
// units, symbols and common abbreviations are rewritten the way a person would read them.
// Pure functions; the narrator calls speakable() on every paragraph before it reaches the TTS engine.

const ABBR = [
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\bet al\.?/gi, 'and colleagues'],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\betc\./gi, 'et cetera'],
  [/\bcf\./gi, 'compare'],
  [/\bapprox\./gi, 'approximately'],
  [/\bFigs?\.\s*(?=\d)/g, 'Figure '],
  [/\bEq\.\s*(?=\d)/g, 'Equation '],
  [/\bNo\.\s*(?=\d)/g, 'number '],
  [/\bVol\.\s*(?=\d)/g, 'volume '],
  [/\bpp\.\s*(?=\d)/g, 'pages '],
  [/\bDr\.(?=\s)/g, 'Doctor'],
  [/\bProf\.(?=\s)/g, 'Professor'],
  [/\bSt\.(?=\s[A-Z])/g, 'Saint'],
  [/\bw\/o\b/gi, 'without'],
  [/\bw\/(?=\s)/gi, 'with'],
];

// Clinical and statistical shorthand, read out in full.
const TERMS = [
  [/\b95%\s*CI\b/g, '95 percent confidence interval'],
  [/\bCIs?\b(?=\s*[:=,(\d])/g, 'confidence interval'],
  [/\bOR\b(?=\s*[=:,]?\s*\d)/g, 'odds ratio'],
  [/\baOR\b/g, 'adjusted odds ratio'],
  [/\bHR\b(?=\s*[=:,]?\s*\d)/g, 'hazard ratio'],
  [/\bRR\b(?=\s*[=:,]?\s*\d)/g, 'relative risk'],
  [/\bSD\b(?=\s*[=:,)]?\s*\d|\))/g, 'standard deviation'],
  [/\bSEM?\b(?=\s*[=:,]?\s*\d)/g, 'standard error'],
  [/\bIQR\b/g, 'interquartile range'],
  [/\bNNT\b/g, 'number needed to treat'],
  [/\bRCTs\b/g, 'randomised controlled trials'],
  [/\bRCT\b/g, 'randomised controlled trial'],
  [/\bb\.i\.d\.?|\bBID\b/g, 'twice daily'],
  [/\bt\.i\.d\.?|\bTID\b/g, 'three times daily'],
  [/\bq\.d\.?|\bQD\b/g, 'once daily'],
  [/\bp\.o\.?(?=\s)|\bPO\b(?=\s)/g, 'by mouth'],
  [/\bs\.c\.(?=\s)/g, 'subcutaneously'],
  [/\bi\.v\.(?=\s)/g, 'intravenously'],
];

const UNITS = {
  'mg/kg': 'milligrams per kilogram', 'mg/dL': 'milligrams per decilitre', 'mg/L': 'milligrams per litre',
  'µg/mL': 'micrograms per millilitre', 'μg/mL': 'micrograms per millilitre', 'ng/mL': 'nanograms per millilitre',
  'mmol/L': 'millimoles per litre', 'IU/mL': 'international units per millilitre', 'mL/min': 'millilitres per minute',
  'kg/m2': 'kilograms per square metre', 'kg/m²': 'kilograms per square metre', 'cm2': 'square centimetres', 'cm²': 'square centimetres',
  'mm2': 'square millimetres', 'mm²': 'square millimetres', mg: 'milligrams', µg: 'micrograms', μg: 'micrograms', mcg: 'micrograms',
  ng: 'nanograms', kg: 'kilograms', g: 'grams', mL: 'millilitres', ml: 'millilitres', L: 'litres', mm: 'millimetres', cm: 'centimetres',
  nm: 'nanometres', µm: 'micrometres', μm: 'micrometres', IU: 'international units', U: 'units', h: 'hours', hr: 'hours', hrs: 'hours',
  min: 'minutes', mo: 'months', wk: 'weeks', wks: 'weeks', y: 'years', yr: 'years', yrs: 'years', d: 'days', mJ: 'millijoules',
  'J/cm2': 'joules per square centimetre', 'J/cm²': 'joules per square centimetre', 'mJ/cm2': 'millijoules per square centimetre',
  'mJ/cm²': 'millijoules per square centimetre', nm_: 'nanometres',
};
const unitRe = new RegExp(`(\\d)\\s?(${Object.keys(UNITS).filter((u) => !u.endsWith('_')).sort((a, b) => b.length - a.length)
  .map((u) => u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})(?![A-Za-z/])`, 'g');

const SYMBOLS = [
  [/\s?±\s?/g, ' plus or minus '],
  [/\s?≥\s?/g, ' greater than or equal to '],
  [/\s?≤\s?/g, ' less than or equal to '],
  [/\s?>=\s?/g, ' greater than or equal to '],
  [/\s?<=\s?/g, ' less than or equal to '],
  [/(\d)\s?[×x]\s?(\d)/g, '$1 by $2'],
  [/(\d)\s?×\s?10\s?[-−–](\d+)/g, '$1 times ten to the minus $2'],
  [/\s?→\s?/g, ' to '],
  [/\s?≈\s?/g, ' approximately '],
  [/°C\b/g, ' degrees Celsius'],
  [/°F\b/g, ' degrees Fahrenheit'],
  [/(\d)\s?%/g, '$1 percent'],
  [/\s&\s/g, ' and '],
  [/\bα/g, 'alpha '], [/\bβ/g, 'beta '], [/\bγ/g, 'gamma '], [/\bδ/g, 'delta '], [/κ/g, 'kappa'], [/\bμ(?=[a-z])/g, 'micro'],
];

/** p < 0.05 → "p less than 0.05"; n = 240 → "n equals 240". */
function statistics(s) {
  return s
    .replace(/\b([pP])\s*<\s*\.?(\d)/g, (_, p, d) => `${p} less than ${d === '0' ? '0' : '0.' + d}`.replace('0.0', '0'))
    .replace(/\b([pP])\s*<\s*/g, '$1 less than ')
    .replace(/\b([pP])\s*>\s*/g, '$1 greater than ')
    .replace(/\b([pP])\s*=\s*/g, '$1 equals ')
    .replace(/\b([nN])\s*=\s*(\d)/g, (_, n, d) => `${n === 'N' ? 'N' : 'n'} equals ${d}`)
    .replace(/\s<\s/g, ' less than ')
    .replace(/\s>\s/g, ' greater than ')
    .replace(/(\d)\s*[-–]\s*(\d)(?!\d*[-–]\d)/g, '$1 to $2');
}

/** Citation markers: [12], [3–5], superscript-style "treatment.12,13" and (Smith et al., 2020). */
export function stripCitations(s) {
  return s
    .replace(/\s?\[(\d+(?:\s*[-–,]\s*\d+)*)\]/g, '')
    .replace(/([a-z)])\.(\d{1,3}(?:[,–-]\d{1,3})*)(?=\s|$)/g, '$1.')
    .replace(/\s?\((?:[A-Z][A-Za-z'’-]+(?: et al\.?| and [A-Z][A-Za-z'’-]+)?,? (?:19|20)\d{2}[a-z]?(?:[;,] ?)?)+\)/g, '');
}

/** Spoken form of one paragraph. opts: {citations: keep bracket citations} */
export function speakable(text, opts = {}) {
  let s = ' ' + String(text).replace(/\s+/g, ' ') + ' ';
  if (!opts.citations) s = stripCitations(s);
  for (const [re, to] of ABBR) s = s.replace(re, to);
  for (const [re, to] of TERMS) s = s.replace(re, to);
  s = s.replace(/\/(day|d)\b/g, ' per day').replace(/\/(week|wk)\b/g, ' per week').replace(/\/(hour|hr|h)\b/g, ' per hour')
    .replace(/\/(month|mo)\b/g, ' per month').replace(/\/(year|yr)\b/g, ' per year');
  s = statistics(s);
  s = s.replace(unitRe, (_, d, u) => `${d} ${UNITS[u] || u}`);
  for (const [re, to] of SYMBOLS) s = s.replace(re, to);
  s = s
    .replace(/\bhttps?:\/\/\S+/g, 'link')
    .replace(/\b10\.\d{4,9}\/\S+/g, '')
    .replace(/(\w)\/(\w)/g, '$1 or $2')
    .replace(/\s*[•▪►]\s*/g, '. ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ');
  return s.trim();
}

/** Which blocks a skip setting leaves out. */
export const SKIPPABLE = {
  refs: { label: 'References & bibliography', heading: /^(references?|bibliography|works cited|literature cited)$/i },
  appendix: { label: 'Appendix & supplements', heading: /^(appendix|appendices|supplement(ary|al)?( material| data)?)\b/i },
  acknowledgements: { label: 'Acknowledgements, funding & disclosures', heading: /^(acknowledge?ments?|funding|conflicts? of interest|disclosures?|competing interests?|author contributions?|data availability)/i },
  captions: { label: 'Figure & table captions' },
  citations: { label: 'Citation numbers like [12]' },
};

/** Narration pace in characters per second at 1× (tuned for typical English TTS). */
export const CHARS_PER_SEC = 14.5;
export const secondsFor = (chars, rate) => chars / (CHARS_PER_SEC * (rate || 1));

export function clock(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function duration(sec) {
  const m = Math.round(sec / 60);
  return m < 1 ? '<1 min' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
