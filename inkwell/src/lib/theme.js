// Refined, low-saturation accents (pairs for gradients).
export const ACCENTS = {
  champagne: { name: 'Champagne', a: '#c8a96a', b: '#e6d3a8' },
  sage: { name: 'Sage', a: '#8aa894', b: '#c5d6bf' },
  dusk: { name: 'Dusk', a: '#9a8fc2', b: '#c9bfe3' },
  terracotta: { name: 'Terracotta', a: '#c47b5f', b: '#e3b79f' },
  slate: { name: 'Slate', a: '#7f94b0', b: '#b9c7da' },
  rosewood: { name: 'Rosewood', a: '#b57380', b: '#e0b6be' },
  teal: { name: 'Deep teal', a: '#5f9a98', b: '#a9cfcb' },
  graphite: { name: 'Graphite', a: '#b9b4ac', b: '#e4e0d8' },
};
// Earlier, brighter accent names map onto the refined set.
const LEGACY = { aurora: 'dusk', sunset: 'terracotta', ocean: 'slate', forest: 'sage', rose: 'rosewood', ember: 'terracotta', gold: 'champagne', ice: 'slate' };

export function applyTheme(st) {
  const a = ACCENTS[st.accent] || ACCENTS[LEGACY[st.accent]] || ACCENTS.champagne;
  const root = document.documentElement;
  root.dataset.mode = st.mode;
  root.style.setProperty('--accent', a.a);
  root.style.setProperty('--accent-2', a.b);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = st.mode === 'light' ? '#f5f2ec' : st.mode === 'amoled' ? '#000000' : '#101012';
}
