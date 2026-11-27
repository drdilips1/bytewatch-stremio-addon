import { describe, it, expect } from 'vitest';
import { looksLikeMusic } from '../src/lib/music.js';

const f = (name, mb) => ({ name, size: mb * 1e6 });

describe('looksLikeMusic', () => {
  it('hides single songs, lossless ones included', () => {
    expect(looksLikeMusic('sombr - 12 to 12', [f('sombr - 12 to 12.mp3', 8)])).toBe(true);
    expect(looksLikeMusic('sombr - 12 to 12', [f('sombr - 12 to 12.flac', 45)])).toBe(true);
  });
  it('hides albums', () => {
    const tracks = ['Intro', 'Back to Friends', 'Undressed', 'Caroline', 'Homewrecker', 'Crushing'].map((t, i) => f(`0${i + 1} - ${t}.mp3`, 7));
    expect(looksLikeMusic('sombr - I Barely Know Her', tracks)).toBe(true);
    expect(looksLikeMusic('Some Band - Discography', [])).toBe(true);
  });
  it('keeps audiobooks, even short or single-file ones', () => {
    expect(looksLikeMusic('Atomic Habits', [f('Atomic Habits.m4b', 30)])).toBe(false);
    expect(looksLikeMusic('James Clear - Atomic Habits', [f('Atomic Habits.mp3', 260)])).toBe(false);
    expect(looksLikeMusic('Atomic Habits (Unabridged)', [f('a.flac', 40)])).toBe(false);
    expect(looksLikeMusic('Dune', [f('Chapter 01.mp3', 5), f('Chapter 02.mp3', 5)])).toBe(false);
  });
});
