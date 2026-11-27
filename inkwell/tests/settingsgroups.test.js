// Settings in groups: every section of Settings has a group, so nothing goes missing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GROUPS, groupOf, soloGroup } from '../src/lib/settingsgroups.js';

describe('settings groups', () => {
  it('every Section in Settings.jsx is in a group', () => {
    const src = readFileSync(new URL('../src/screens/Settings.jsx', import.meta.url), 'utf8');
    const titles = [...src.matchAll(/<Section[^>]*\btitle="([^"]+)"/g)].map((m) => m[1]);
    expect(titles.length).toBeGreaterThan(20);
    const known = new Set(GROUPS.flatMap((g) => g.sections));
    expect(titles.filter((t) => !known.has(t))).toEqual([]);
  });
  it('finds a section\'s group; one-section groups open straight in', () => {
    expect(groupOf('TorBox')).toBe('cloud');
    expect(groupOf('Premiumize', { debrid: true })).toBe('cloud');
    expect(groupOf('Data')).toBe('storage');
    expect(soloGroup('playback')).toBe(true);
    expect(soloGroup('cloud')).toBe(false);
  });
});
