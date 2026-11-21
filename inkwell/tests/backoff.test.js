// Services that refuse us are left alone for a while (21 Nov: 15,000 refused Goodreads requests in a day).
import { describe, it, expect } from 'vitest';
import { emptyBackoff, waitFor, noteAnswer, isRefusal } from '../src/lib/backoff.js';
import { keepHours } from '../workers/audiohub.js';

const GR = 'https://www.goodreads.com/book/auto_complete?format=json&q=Atomic%20Habits';
const IT = 'https://itunes.apple.com/search?term=atomic';
const H = 3600e3;

describe('backoff', () => {
  it('a refused Goodreads book is not asked again for 3 days', () => {
    const s = emptyBackoff();
    noteAnswer(s, GR, GR, 403, 0);
    expect(waitFor(s, GR, GR, 1000)?.why).toBe('refused');
    expect(waitFor(s, GR, GR, 71 * H)).not.toBe(null);
    expect(waitFor(s, GR, GR, 73 * H)).toBe(null);
    // Another book can still be asked (only one refusal so far).
    expect(waitFor(s, GR + 'x', GR + 'x', 1000)).toBe(null);
  });
  it('three refusals in a row pause Goodreads for an hour', () => {
    const s = emptyBackoff();
    for (let i = 0; i < 3; i++) noteAnswer(s, GR, GR + i, 403, 0);
    expect(waitFor(s, GR, 'another book', 30 * 60e3)?.why).toBe('paused');
    expect(waitFor(s, GR, 'another book', H + 1)).toBe(null);
  });
  it('iTunes pauses 10 minutes, doubling while it keeps refusing, and a good answer clears it', () => {
    const s = emptyBackoff();
    for (let i = 0; i < 3; i++) noteAnswer(s, IT, IT + i, 429, 0);
    expect(waitFor(s, IT, 'q', 9 * 60e3)?.why).toBe('paused');
    expect(waitFor(s, IT, 'q', 11 * 60e3)).toBe(null);
    noteAnswer(s, IT, 'q', 429, 11 * 60e3); // refused again right after the pause
    expect(waitFor(s, IT, 'r', 11 * 60e3 + 19 * 60e3)?.why).toBe('paused');
    noteAnswer(s, IT, 'r', 200, 40 * 60e3);
    expect(s.hosts['itunes.apple.com']).toEqual({ streak: 0, until: 0, pause: 0 });
  });
  it('leaves other services and "not found" alone', () => {
    const s = emptyBackoff();
    expect(noteAnswer(s, 'https://openlibrary.org/search.json?q=x', 'k', 429, 0)).toBe(false);
    expect(isRefusal(404)).toBe(false);
    expect(isRefusal(403)).toBe(true);
    noteAnswer(s, GR, GR, 404, 0);
    expect(waitFor(s, GR, GR, 1)).toBe(null);
  });
});

describe('relay keeps answers', () => {
  it('keeps catalog answers, never account services or your Hardcover shelves', () => {
    expect(keepHours('itunes.apple.com', 'GET')).toBe(12);
    expect(keepHours('api.knaben.org', 'GET')).toBe(1);
    expect(keepHours('api.torbox.app', 'GET')).toBe(0);
    expect(keepHours('api.real-debrid.com', 'GET')).toBe(0);
    expect(keepHours('api.hardcover.app', 'POST', JSON.stringify({ query: 'query S($q: String!) { search(query: $q) { results } }' }))).toBe(12);
    expect(keepHours('api.hardcover.app', 'POST', JSON.stringify({ query: 'query { me { user_books { id } } }' }))).toBe(0);
    expect(keepHours('api.hardcover.app', 'POST', JSON.stringify({ query: 'mutation M { update_user_book { id } }' }))).toBe(0);
  });
});
