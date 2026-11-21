// Addons across devices: merged, so one device's list doesn't wipe an addon added on another.
import { describe, it, expect } from 'vitest';
import { mergeAddons, mergeAddonLog } from '../src/lib/addonmerge.js';

const hunt = { kind: 'source', manifest: { id: 'audiohub-bookhunt', name: 'Book Hunt' } };
const knaben = { kind: 'source', manifest: { id: 'my-knaben-ebooks', name: 'Knaben Ebooks' } };
const mob = { kind: 'source', special: 'mobilism', manifest: { name: 'Mobilism' } };

describe('mergeAddons', () => {
  it('an addon added on the web app survives the phone sending its older list', () => {
    expect(mergeAddons([knaben, hunt], [knaben, mob], { 'audiohub-bookhunt': { added: 5 } }).map((a) => a.manifest.name)).toEqual(['Knaben Ebooks', 'Book Hunt', 'Mobilism']);
  });
  it('an addon removed on one device stays removed', () => {
    expect(mergeAddons([knaben], [knaben, hunt], { 'audiohub-bookhunt': { added: 5, removed: 9 } })).toEqual([knaben]);
  });
  it('added again after removing: back', () => {
    expect(mergeAddons([], [hunt], { 'audiohub-bookhunt': { added: 12, removed: 9 } })).toEqual([hunt]);
  });
});

describe('mergeAddonLog', () => {
  it('keeps the later added and removed times', () => {
    expect(mergeAddonLog({ a: { added: 5, removed: 0 } }, { a: { added: 3, removed: 7 }, b: { added: 1 } })).toEqual({ a: { added: 5, removed: 7 }, b: { added: 1 } });
  });
});
