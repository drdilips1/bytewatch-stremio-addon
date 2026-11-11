// Duet's colours: two voices — warm amber (the narrator) and soft violet (the page) — on paper
// by day and deep ink by night (following the phone unless you pick). Every highlight blends
// one into the other. More palettes come with Plus; the dice rolls between them.
import { persisted } from '../src/lib/store.js';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

// [bg, card, text, muted, line, fill, accent (voice), accent 2 (page)]
export const PALETTES = [
  { id: 'duet', name: 'Duet', light: ['#faf6f0', '#ffffff', '#1e1b24', '#8a8592', '#ece5da', 'rgba(30,27,36,.06)', '#f0874f', '#7d6cf0'], dark: ['#0d0e13', '#1b1e28', '#f3efe8', '#9a97a3', '#262a36', 'rgba(255,255,255,.07)', '#ffb36b', '#8f7dff'] },
  { id: 'ember', name: 'Ember', light: ['#fbf4ef', '#ffffff', '#24191a', '#8f7f80', '#efe0d8', 'rgba(36,25,26,.06)', '#e0603c', '#c43d6b'], dark: ['#120c0d', '#211819', '#f4e9e6', '#a39192', '#33272a', 'rgba(255,255,255,.07)', '#ff8f6b', '#ff6f9c'] },
  { id: 'tide', name: 'Tide', light: ['#f1f6f7', '#ffffff', '#152224', '#7a8b8c', '#dbe7e8', 'rgba(21,34,36,.06)', '#2f9aa4', '#5468e8'], dark: ['#0b1214', '#152022', '#e3eeee', '#8a9c9c', '#223032', 'rgba(255,255,255,.07)', '#5fd0d6', '#8d9bff'] },
  { id: 'grove', name: 'Grove', light: ['#f4f6ef', '#ffffff', '#1c211c', '#7f887e', '#e1e6dc', 'rgba(28,33,28,.06)', '#5f9a6b', '#c08a2e'], dark: ['#0e120f', '#1a201b', '#e8ede6', '#8f988d', '#273027', 'rgba(255,255,255,.07)', '#8fd19e', '#f0c060'] },
  { id: 'dusk', name: 'Dusk', light: ['#f7f3f8', '#ffffff', '#221a24', '#8d7f90', '#ebdfee', 'rgba(34,26,36,.06)', '#b0569a', '#5a6bdc'], dark: ['#110d14', '#1f1923', '#f0e6f3', '#a090a5', '#30263a', 'rgba(255,255,255,.07)', '#e48ad0', '#8fa0ff'] },
];
const KEYS = ['--h-bg', '--h-card', '--h-text', '--h-muted', '--h-line', '--h-fill', '--h-accent', '--h-accent2'];

export const look = persisted('duetLook', { palette: 'duet', mode: 'system' }); // mode: system | light | dark
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export const isDark = () => {
  const { mode } = look.get();
  return mode === 'dark' || (mode !== 'light' && !!mq?.matches);
};

export function applyLook() {
  const p = PALETTES.find((x) => x.id === look.get().palette) || PALETTES[0];
  const dark = isDark();
  const root = document.documentElement;
  root.dataset.duet = dark ? 'dark' : 'light';
  (dark ? p.dark : p.light).forEach((v, i) => root.style.setProperty(KEYS[i], v));
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.content = (dark ? p.dark : p.light)[0];
  if (Capacitor.isNativePlatform()) StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
}
look.subscribe(applyLook);
mq?.addEventListener?.('change', applyLook);

/** Another palette at random (never the one you have). */
export function rollDice() {
  const cur = look.get().palette;
  const others = PALETTES.filter((p) => p.id !== cur);
  const next = others[Math.floor(Math.random() * others.length)];
  look.set((l) => ({ ...l, palette: next.id }));
  return next;
}
