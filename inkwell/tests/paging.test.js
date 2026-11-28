import { describe, it, expect } from 'vitest';
import { pageLayout, pageCount, pageOf, turnTo, swipeDir, columnsFor } from '../src/lib/paging.js';
import { recapDue, readSoFar, ebookRecapPrompt, AWAY } from '../src/lib/ebookrecap.js';

describe('ebook pages', () => {
  it('one column on a phone, two side by side on a tablet', () => {
    expect(columnsFor(390)).toBe(1);
    expect(columnsFor(1024)).toBe(2);
    const p = pageLayout(390, 24);
    expect(p).toMatchObject({ cols: 1, gap: 48, articleW: 342, colW: 342 });
    const t = pageLayout(1024, 24);
    expect(t.colW * 2 + t.gap).toBeCloseTo(t.articleW);
  });
  it('counts pages and finds the page something is on', () => {
    expect(pageCount(3900, 390)).toBe(10);
    expect(pageOf(0, 390)).toBe(0);
    expect(pageOf(389, 390)).toBe(1); // just short of page 2 by rounding: on page 2
    expect(pageOf(800, 390)).toBe(2);
  });
  it('turns stay inside the book; swipes left go forward', () => {
    expect(turnTo(0, -1, 10)).toBe(0);
    expect(turnTo(9, 1, 10)).toBe(9);
    expect(swipeDir(-80, 10)).toBe(1);
    expect(swipeDir(80, 10)).toBe(-1);
    expect(swipeDir(-30, 0)).toBe(0);
    expect(swipeDir(-60, 90)).toBe(0); // more up/down than sideways
  });
});

describe('Previously, in … for ebooks', () => {
  it('offers it after a week away, part-way through', () => {
    const now = Date.now();
    expect(recapDue({ percent: 0.4, updatedAt: now - AWAY - 1 }, now)).toBe(true);
    expect(recapDue({ percent: 0.4, updatedAt: now - 3600e3 }, now)).toBe(false);
    expect(recapDue({ percent: 0.01, updatedAt: 0 }, now)).toBe(false);
    expect(recapDue({ percent: 0.5, finished: true, updatedAt: 0 }, now)).toBe(false);
  });
  it('recaps only what was read, ending where you stopped', () => {
    const blocks = ['one', 'two', 'three', 'four (later)'];
    const r = readSoFar({ blocks, upTo: 2, headings: [{ text: 'Ch 1', at: 0 }, { text: 'Ch 2', at: 3 }] });
    expect(r.text).toBe('one\ntwo\nthree');
    expect(r.chapters).toEqual(['Ch 1']);
    const p = ebookRecapPrompt({ title: 'Dune', ...r });
    expect(p).toMatch(/Use ONLY the passage/);
    expect(p).not.toMatch(/four/); // the part not read yet is left out
  });
});
