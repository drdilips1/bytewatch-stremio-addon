// How text should be *said*, as on Android (Speech.kt): statistics ("HR 0.72, 95% CI 0.54–0.96, p=0.03"),
// units, ranges, symbols, Greek letters and common abbreviations; medical mode adds dosing, clinical shorthand
// and lab names. The page keeps the original; only what the voice says changes.
// No look-behind in these patterns: older iPhones' web views don't support it.

const NUM = String.raw`\d+(?:[.,]\d+)?`;

const statName = (s) =>
  ({
    HR: 'the hazard ratio', aHR: 'the adjusted hazard ratio', OR: 'the odds ratio', aOR: 'the adjusted odds ratio',
    RR: 'the relative risk', IRR: 'the incidence rate ratio', SMD: 'the standardized mean difference',
    MD: 'the mean difference', NNT: 'the number needed to treat', NNH: 'the number needed to harm',
    ARR: 'the absolute risk reduction',
  })[s] || 'the relative risk reduction';

const RULES = [
  [new RegExp(String.raw`(\d{2}(?:\.\d)?)\s?(?:%|percent)\s*CI[:,]?\s*\[?(${NUM})\s*(?:[-–—]|to)\s*(${NUM})\]?`, 'gi'),
    (_, a, b, c) => `${a} percent confidence interval from ${b} to ${c}`],
  [new RegExp(String.raw`\bCI[:,]?\s*\[?(${NUM})\s*(?:[-–—]|to)\s*(${NUM})\]?`, 'g'), (_, a, b) => `confidence interval from ${a} to ${b}`],
  [/\b[pP]\s*(=|<|>|≤|≥|<=|>=)\s*(0?\.\d+|\d+(?:\.\d+)?)/g, (_, op, v0) => {
    const v = v0.startsWith('.') ? '0' + v0 : v0;
    return { '=': `a p-value of ${v}`, '<': `a p-value below ${v}`, '>': `a p-value above ${v}`, '≤': `a p-value of at most ${v}`, '<=': `a p-value of at most ${v}` }[op] || `a p-value of at least ${v}`;
  }],
  [new RegExp(String.raw`\b(aHR|HR|aOR|OR|RR|IRR|SMD|MD|NNT|NNH|ARR|RRR)\b\s*[=:,]?\s*(${NUM})`, 'g'), (_, s, v) => `${statName(s)} was ${v}`],
  [/\b[nN]\s*=\s*(\d[\d,]*)/g, (_, n) => `n equals ${n}`],
  [/\b[rR](²|2|\^2)\s*=\s*/g, () => 'R squared equals '],
  [new RegExp(String.raw`(${NUM})\s*±\s*(${NUM})`, 'g'), (_, a, b) => `${a} plus or minus ${b}`],
  // Ranges between numbers: "0.54–0.96", "10-20 mg" (not "COVID-19").
  [new RegExp(String.raw`(^|[^\w.])(${NUM})\s*[–—]\s*(${NUM})(?![\w]|\.\d)`, 'g'), (_, pre, a, b) => `${pre}${a} to ${b}`],
  [new RegExp(String.raw`(^|[^\w.-])(${NUM})\s?-\s?(${NUM})(?=\s*(?:%|[a-zA-Zµμ°]))`, 'g'), (_, pre, a, b) => `${pre}${a} to ${b}`],
];

const ABBREVIATIONS = [
  [/\bFigs?\.\s*(?=\d)/g, 'Figure '], [/\bEqs?\.\s*(?=\(?\d)/g, 'Equation '], [/\bTab\.\s*(?=\d)/g, 'Table '],
  [/\bRef\.\s*(?=\d)/g, 'Reference '], [/\bSec\.\s*(?=\d)/g, 'Section '], [/\bNo\.\s*(?=\d)/g, 'number '],
  [/\bapprox\.\s*/g, 'approximately '], [/\bcf\.\s*/g, 'compare '], [/\bvs\.?(?=\s)/g, 'versus'],
  [/\bi\.e\.,?/g, 'that is,'], [/\be\.g\.,?/g, 'for example,'], [/\bet al\./g, 'and colleagues'],
  [/\bSD\b/g, 'standard deviation'], [/\bSE\b(?=\s*[=:(]|\s+of\b)/g, 'standard error'], [/\bSEM\b/g, 'standard error of the mean'],
  [/\bIQR\b/g, 'interquartile range'], [/\b95% CI\b/g, '95 percent confidence interval'], [/\bCI\b/g, 'confidence interval'],
  [/\bHR\b/g, 'hazard ratio'], [/\bORs?\b(?=\s*(?:of|for|was|were|\())/g, 'odds ratio'],
];

const MEDICAL = [
  [/\b(?:b\.i\.d\.|BID\b|bd\b)/gi, 'twice daily'], [/\b(?:t\.i\.d\.|TID\b|tds\b)/gi, 'three times daily'],
  [/\b(?:q\.i\.d\.|QID\b|qds\b)/gi, 'four times daily'], [/\b(?:q\.d\.|QD\b|OD\b)/g, 'once daily'],
  [/\bq\.?(\d+)\s?h\b/gi, 'every $1 hours'], [/\bPRN\b|\bp\.r\.n\./gi, 'as needed'], [/\bPO\b/g, 'by mouth'],
  [/\bIV\b/g, 'intravenous'], [/\bIM\b/g, 'intramuscular'], [/\b(?:SC|SQ|s\.c\.)\b/g, 'subcutaneous'],
  [/\bHS\b|\bh\.s\./g, 'at bedtime'], [/\bSTAT\b/g, 'immediately'], [/\bmITT\b/g, 'modified intention to treat'],
  [/\bITT\b/g, 'intention to treat'], [/\bPP\b(?=\s+(?:analysis|population|set))/g, 'per protocol'],
  [/\bRCTs\b/g, 'randomized controlled trials'], [/\bRCT\b/g, 'randomized controlled trial'],
  [/\bSAEs?\b/g, 'serious adverse events'], [/\bAEs\b/g, 'adverse events'], [/\bAE\b/g, 'adverse event'],
  [/\bOS\b/g, 'overall survival'], [/\bPFS\b/g, 'progression-free survival'], [/\bDFS\b/g, 'disease-free survival'],
  [/\bQoL\b/g, 'quality of life'], [/\bLOS\b/g, 'length of stay'], [/\bBMI\b/g, 'B M I'], [/\bH&E\b/g, 'H and E'],
  [/\bIHC\b/g, 'immunohistochemistry'], [/\bFFPE\b/g, 'formalin-fixed, paraffin-embedded'], [/\bhpf\b/gi, 'high-power field'],
  [/\bSPF\b/g, 'S P F'], [/\bUV[AB]?\b/g, 'U V'], [/\bpts\b/g, 'patients'], [/\bpt\b/g, 'patient'],
  [/\b[dD]x\b/g, 'diagnosis'], [/\b[tT]x\b/g, 'treatment'], [/\b[hH]x\b/g, 'history'], [/\bRx\b/g, 'prescription'],
  [/\bSx\b/g, 'symptoms'], [/\bFx\b/g, 'fracture'], [/\bq\.o\.d\.|\bQOD\b/g, 'every other day'],
  [/\bNPO\b|\bn\.p\.o\./g, 'nothing by mouth'], [/\bSL\b(?=\s|[,.;)])/g, 'sublingual'],
  [/(^|[^\w/])w\/o(?![\w/])/g, '$1without'], [/(^|[^\w/])w\/(?=\s?[A-Za-z])/g, '$1with '],
  [/(^|[^\w/])s\/p(?![\w/])/g, '$1status post'], [/(^|[^\w/])r\/o(?![\w/])/g, '$1rule out'],
  [/(^|[^\w/])c\/o(?![\w/])/g, '$1complains of'], [/(^|[^\w/])y\/o(?![\w/])/g, '$1year-old'],
  [/↑/g, ' increased '], [/↓/g, ' decreased '],
  [/\bHbA1c\b/g, 'H b A 1 c'], [/\beGFR\b/g, 'e G F R'], [/\bmRNA\b/g, 'm R N A'], [/\bIg([AGEMD])\b/g, 'I g $1'],
  [/\bNSAIDs\b/g, 'N-SAIDs'], [/\bNSAID\b/g, 'N-SAID'], [/\bIL-(\d+)/g, 'interleukin $1'],
  [/\b([A-Z]{1,4}\d{0,2})\+(?=[\s,.;)]|$)/g, '$1 positive'],
  [/[x×]\s?10\s?(?:\^|\*\*)?\s?9\s?\/\s?L|×10⁹\/L/g, ' times ten to the ninth per liter'],
  [/[x×]\s?10\s?(?:\^|\*\*)?\s?12\s?\/\s?L|×10¹²\/L/g, ' times ten to the twelfth per liter'],
];

const UNITS = {
  'mg/kg/day': 'milligrams per kilogram per day', 'mg/m2': 'milligrams per square meter', 'mg/m²': 'milligrams per square meter',
  'mEq/L': 'milliequivalents per liter', 'U/kg': 'units per kilogram', 'L/min': 'liters per minute', 'mm³': 'cubic millimeters',
  'mm3': 'cubic millimeters', 'cm²': 'square centimeters', 'mg/kg/d': 'milligrams per kilogram per day', 'mg/kg': 'milligrams per kilogram',
  'mg/dL': 'milligrams per deciliter', 'mg/dl': 'milligrams per deciliter', 'mmol/L': 'millimoles per liter', 'mmol/l': 'millimoles per liter',
  'μmol/L': 'micromoles per liter', 'µmol/L': 'micromoles per liter', 'ng/mL': 'nanograms per milliliter', 'pg/mL': 'picograms per milliliter',
  'g/dL': 'grams per deciliter', 'mL/min': 'milliliters per minute', 'mL/kg': 'milliliters per kilogram', 'IU/L': 'international units per liter',
  'U/L': 'units per liter', 'cells/μL': 'cells per microliter', 'cells/µL': 'cells per microliter', 'kg/m2': 'kilograms per square meter',
  'kg/m²': 'kilograms per square meter', mmHg: 'millimeters of mercury', mEq: 'milliequivalents', mcg: 'micrograms', 'μg': 'micrograms',
  'µg': 'micrograms', mg: 'milligrams', kg: 'kilograms', mL: 'milliliters', ml: 'milliliters', dL: 'deciliters', 'μL': 'microliters',
  'µL': 'microliters', IU: 'international units', mm: 'millimeters', cm: 'centimeters', km: 'kilometers', nm: 'nanometers',
  'μm': 'micrometers', 'µm': 'micrometers', kcal: 'kilocalories', bpm: 'beats per minute', kHz: 'kilohertz', MHz: 'megahertz',
  GHz: 'gigahertz', Hz: 'hertz', '°C': 'degrees Celsius', '°F': 'degrees Fahrenheit', ms: 'milliseconds', min: 'minutes',
  hrs: 'hours', h: 'hours', wk: 'weeks', mo: 'months', yrs: 'years', y: 'years', g: 'grams', L: 'liters', mM: 'millimolar',
  'μM': 'micromolar', 'µM': 'micromolar', nM: 'nanomolar', GB: 'gigabytes', MB: 'megabytes', TB: 'terabytes',
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const UNIT_RE = new RegExp(String.raw`(\d)\s?(${Object.keys(UNITS).sort((a, b) => b.length - a.length).map(esc).join('|')})(?![\w/²])`, 'g');

const GREEK = { α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', Δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', κ: 'kappa',
  λ: 'lambda', μ: 'mu', µ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', Σ: 'sigma', τ: 'tau', φ: 'phi', Φ: 'phi', χ: 'chi',
  ψ: 'psi', ω: 'omega', Ω: 'omega' };
const GREEK_RE = new RegExp(`[${Object.keys(GREEK).join('')}]`, 'g');

const SYMBOLS = [
  ['≤', ' less than or equal to '], ['≥', ' greater than or equal to '], ['≠', ' not equal to '], ['≈', ' approximately '],
  ['∼', ' approximately '], ['±', ' plus or minus '], ['×', ' times '], ['÷', ' divided by '], ['→', ' to '], ['←', ' from '],
  ['∞', ' infinity '], ['√', ' square root of '], ['∝', ' proportional to '], ['°', ' degrees'], ['²', ' squared'], ['³', ' cubed'],
  ['‰', ' per mille'], ['%', ' percent'], ['&', ' and '],
];

/** The text as it should be spoken ([medical]: dosing, clinical shorthand and lab names too). */
export function spoken(text, medical = false) {
  if (!text || !/\d|[%&±×≤≥≈∼→←°²³‰α-ωΑ-Ωµ↑↓]|\b(?:e\.g|i\.e|et al|vs|SD|SE|CI|HR|OR|IQR|Fig|No\.)/.test(text) && !medical) return text;
  let t = text;
  for (const [re, f] of RULES) t = t.replace(re, f);
  for (const [re, rep] of ABBREVIATIONS) t = t.replace(re, rep);
  if (medical) for (const [re, rep] of MEDICAL) t = t.replace(re, rep);
  t = t.replace(UNIT_RE, (_, d, u) => `${d} ${UNITS[u]}`);
  for (const [sym, word] of SYMBOLS) t = t.split(sym).join(word);
  t = t.replace(GREEK_RE, (c) => ` ${GREEK[c]} `);
  t = t.replace(/\s*([<>=])\s*/g, (_, c) => (c === '<' ? ' less than ' : c === '>' ? ' greater than ' : ' equals '));
  return t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}

// ---- medical documents (as on Android: MedicalText.looksMedical) ----

const CLINICAL = new RegExp(
  String.raw`\b(?:patients?|clinical(?:ly)?|diagnos(?:is|es|ed|tic)|treatments?|therap(?:y|ies|eutic)|diseases?|syndromes?|` +
    String.raw`symptoms?|dos(?:e|es|ing|age)|mg|mcg|randomi[sz]ed|placebo|trials?|cohort|etiology|aetiology|prognosis|` +
    String.raw`lesions?|biops(?:y|ies)|histolog\w*|patholog\w*|infections?|inflammat\w*|chronic|acute|mortality|morbidity|` +
    String.raw`incidence|prevalence|efficacy|adverse|contraindicat\w*|pharmacolog\w*|physicians?|hospital\w*|surgery|surgical|` +
    String.raw`dermat\w*|cardi\w*|renal|hepatic|pulmonary|neurolog\w*|oncolog\w*|tumou?rs?|carcinoma|lymph\w*|serum|plasma|` +
    String.raw`intravenous|oral(?:ly)?|subcutaneous|topical|prescri\w*|clinicians?|management)\b`,
  'gi'
);

/** Whether a book's paragraphs read as medical (about 2 clinical words in every 100, from samples). */
export function looksMedical(paras) {
  if (!paras?.length) return false;
  let sample = '';
  for (const at of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    let i = Math.min(paras.length - 1, Math.floor(paras.length * at));
    let taken = 0;
    while (i < paras.length && taken < 4000) {
      sample += paras[i] + ' ';
      taken += paras[i].length;
      i++;
    }
  }
  const words = Math.max(1, (sample.match(/ /g) || []).length);
  const hits = (sample.match(CLINICAL) || []).length;
  return words >= 150 && (hits * 100) / words >= 1.8;
}

export const MEDICAL_KEY = 'narrato:medical';
/** "auto" (default), "on" or "off". */
export const medicalMode = () => localStorage.getItem(MEDICAL_KEY) || 'auto';

/** The paragraphs as the voice should say them, for [book] (medical mode by the setting, or detected). */
export function forVoice(paras) {
  const mode = medicalMode();
  const medical = mode === 'on' || (mode === 'auto' && looksMedical(paras.filter(Boolean)));
  return paras.map((p) => (p ? spoken(p, medical) : p));
}
