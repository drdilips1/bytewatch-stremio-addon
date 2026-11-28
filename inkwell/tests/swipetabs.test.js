import { describe, it, expect } from 'vitest';
import { swipeTab } from '../src/lib/swipetabs.js';

const tabs = ['home', 'discover', 'podcasts', 'library', 'settings'];
describe('swiping between tabs', () => {
  it('finger to the left goes to the next tab', () => {
    expect(swipeTab(tabs, 'home', -120, 10, 250)).toBe('discover');
  });
  it('finger to the right goes back a tab', () => {
    expect(swipeTab(tabs, 'library', 140, 5, 300)).toBe('podcasts');
  });
  it('stops at the ends', () => {
    expect(swipeTab(tabs, 'home', 150, 0, 200)).toBe(null);
    expect(swipeTab(tabs, 'settings', -150, 0, 200)).toBe(null);
  });
  it('ignores short, slow or mostly up-and-down moves (scrolling the page)', () => {
    expect(swipeTab(tabs, 'home', -40, 0, 200)).toBe(null);
    expect(swipeTab(tabs, 'home', -120, 90, 200)).toBe(null);
    expect(swipeTab(tabs, 'home', -120, 0, 1500)).toBe(null);
  });
});
