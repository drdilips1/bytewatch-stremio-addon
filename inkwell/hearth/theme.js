// Hearth's colours: a few calm palettes, each with a light and a dark side; light or dark
// follows the phone unless you pick one. The dice picks another palette at random.
import { persisted } from '../src/lib/store.js';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

export const PALETTES = [
  { id: 'hearth', name: 'Hearth', light: ['#f7f4ef', '#ffffff', '#1d1b19', '#8a847c', '#e8e2d9', '#ece7df', '#c8693b'], dark: ['#161513', '#211f1c', '#efeae2', '#9b958c', '#2e2b27', '#2a2724', '#e08a5c'] },
  { id: 'sage', name: 'Sage', light: ['#f3f5ef', '#ffffff', '#1c211c', '#7f887e', '#e1e6dc', '#e7ebe2', '#5f8a6b'], dark: ['#121612', '#1b211b', '#e8ede6', '#8f988d', '#273027', '#232a23', '#8fbf9a'] },
  { id: 'midnight', name: 'Midnight', light: ['#f2f4f8', '#ffffff', '#171c26', '#7d8597', '#dfe3ec', '#e6e9f0', '#3d5a80'], dark: ['#0f1420', '#171d2b', '#e7ebf3', '#8e97aa', '#252d3e', '#1f2636', '#7fa7d9'] },
  { id: 'plum', name: 'Plum', light: ['#f8f2f5', '#ffffff', '#221a1f', '#8d7f88', '#ebdfe6', '#efe5eb', '#8e4b7a'], dark: ['#171216', '#211a20', '#f0e6ed', '#a0909b', '#30262e', '#2a2128', '#d08ac0'] },
  { id: 'ocean', name: 'Ocean', light: ['#eff6f6', '#ffffff', '#152122', '#7a8b8c', '#dbe7e7', '#e2eded', '#2f7f86'], dark: ['#0f1717', '#162121', '#e3eeee', '#8a9c9c', '#223030', '#1d2929', '#5fc1c8'] },
  { id: 'mustard', name: 'Mustard', light: ['#faf6ea', '#ffffff', '#221f15', '#8c8673', '#ebe4cf', '#f0eadb', '#b07d10'], dark: ['#17150f', '#211e16', '#efe9d8', '#9e977f', '#2f2b20', '#29261c', '#e0b64a'] },
  { id: 'rose', name: 'Rose', light: ['#fbf3f3', '#ffffff', '#241a1b', '#8f7f80', '#eedfe0', '#f2e6e7', '#c0485a'], dark: ['#1a1213', '#241b1c', '#f2e7e8', '#a39192', '#332627', '#2c2122', '#ee8a98'] },
];
const KEYS = ['--h-bg', '--h-card', '--h-text', '--h-muted', '--h-line', '--h-fill', '--h-accent'];

export const look = persisted('hearthLook', { palette: 'hearth', mode: 'system' }); // mode: system | light | dark
const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

export function applyLook() {
  const { palette, mode } = look.get();
  const p = PALETTES.find((x) => x.id === palette) || PALETTES[0];
  const dark = mode === 'dark' || (mode !== 'light' && !!mq?.matches);
  const root = document.documentElement;
  root.dataset.hearth = dark ? 'dark' : 'light';
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
