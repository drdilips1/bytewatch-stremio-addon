// Accent pairs for gradients. The pastel set follows Material You's tonal
// palettes; `l`/`lb` are the deeper tones used on light backgrounds.
export const ACCENTS = {
  lavender: { name: 'Lavender', a: '#cbb8ff', b: '#ffb3d0', l: '#6750a4', lb: '#984061' },
  peach: { name: 'Peach', a: '#ffb68f', b: '#ffd9a0', l: '#8f4c2a', lb: '#7d5700' },
  mint: { name: 'Mint', a: '#8fdcc3', b: '#a8d8ff', l: '#006b56', lb: '#00639b' },
  sky: { name: 'Sky', a: '#a8c8ff', b: '#d2bbff', l: '#335f9e', lb: '#6750a4' },
  blush: { name: 'Blush', a: '#ffafc9', b: '#ffc9a8', l: '#984061', lb: '#8f4c2a' },
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
  const a = ACCENTS[st.accent] || ACCENTS[LEGACY[st.accent]] || ACCENTS.lavender;
  const root = document.documentElement;
  const light = st.mode === 'light';
  root.dataset.mode = st.mode;
  root.style.setProperty('--accent', light && a.l ? a.l : a.a);
  root.style.setProperty('--accent-2', light && a.lb ? a.lb : a.b);
  // Soft pastel pair for gradients and tints, whatever the mode.
  root.style.setProperty('--tint', a.a);
  root.style.setProperty('--tint-2', a.b);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = light ? '#fdf7ff' : st.mode === 'amoled' ? '#000000' : '#131218';
}
