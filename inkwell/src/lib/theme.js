export const ACCENTS = {
  aurora: { name: 'Aurora', a: '#8b5cf6', b: '#22d3ee' },
  sunset: { name: 'Sunset', a: '#f97316', b: '#ec4899' },
  ocean: { name: 'Ocean', a: '#3b82f6', b: '#14b8a6' },
  forest: { name: 'Forest', a: '#22c55e', b: '#a3e635' },
  rose: { name: 'Rose', a: '#f43f5e', b: '#a855f7' },
  ember: { name: 'Ember', a: '#ef4444', b: '#f59e0b' },
  gold: { name: 'Gold', a: '#eab308', b: '#f97316' },
  ice: { name: 'Ice', a: '#60a5fa', b: '#c4b5fd' },
};

export function applyTheme(st) {
  const a = ACCENTS[st.accent] || ACCENTS.aurora;
  const root = document.documentElement;
  root.dataset.mode = st.mode;
  root.style.setProperty('--accent', a.a);
  root.style.setProperty('--accent-2', a.b);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = st.mode === 'light' ? '#f6f4fb' : st.mode === 'amoled' ? '#000000' : '#0b0a14';
}
