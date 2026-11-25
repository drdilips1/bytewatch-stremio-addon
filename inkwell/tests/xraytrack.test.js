// Character Tracker: groups, counts and what changed since you last listened.
import { describe, it, expect } from 'vitest';
import { groupsOf, counts, changesSince, initials, statusOf } from '../src/lib/xraytrack.js';

const before = { people: [{ name: 'Mira Ardent', status: 'alive', group: 'House Ardent', connections: [] }, { name: 'Ser Alan', status: 'alive', group: 'House Ardent' }] };
const now = {
  people: [
    { name: 'Mira Ardent', status: 'missing', group: 'House Ardent', connections: [{ to: 'Kael', label: 'betrothed', type: 'family' }] },
    { name: 'Ser Alan', status: 'dead', group: 'House Ardent' },
    { name: 'Orin', role: 'A smuggler from the Free Cities', group: 'The Free Cities' },
    { name: 'Dorn', status: 'whatever' },
  ],
};
describe('Character Tracker', () => {
  it('groups people, biggest group first, ungrouped last', () => {
    expect(groupsOf(now.people).map((g) => [g.name, g.list.length])).toEqual([['House Ardent', 2], ['The Free Cities', 1], ['Others', 1]]);
  });
  it('counts statuses (anything unclear is unknown)', () => {
    expect(counts(now.people)).toMatchObject({ met: 4, alive: 0, missing: 1, dead: 1, unknown: 2 });
    expect(statusOf({ status: 'Dead' })).toBe('dead');
  });
  it('says what changed since last time', () => {
    expect(changesSince(before, now)).toEqual([
      { kind: 'status', name: 'Mira Ardent', text: 'alive → missing' },
      { kind: 'link', name: 'Mira Ardent', text: 'betrothed · Kael' },
      { kind: 'status', name: 'Ser Alan', text: 'alive → dead' },
      { kind: 'new', name: 'Orin', text: 'A smuggler from the Free Cities' },
      { kind: 'new', name: 'Dorn', text: 'Met for the first time' },
    ]);
    expect(changesSince(null, now)).toEqual([]);
  });
  it('initials for the portrait tile', () => {
    expect(initials('Mira Ardent')).toBe('MA');
    expect(initials('the "Red" Queen')).toBe('TQ');
  });
});
