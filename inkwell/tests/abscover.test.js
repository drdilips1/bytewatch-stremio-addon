import { describe, it, expect, vi } from 'vitest';
const cfg = { server: 'http://192.168.31.98:3333', altServer: 'http://100.93.52.89:3333', token: 'NEW' };
vi.mock('../src/lib/store.js', () => ({ abs: { get: () => cfg } }));
vi.mock('../src/lib/report.js', () => ({ logError: () => {} }));
vi.mock('../src/lib/http.js', () => ({ isWeb: false, getJson: vi.fn(() => Promise.reject(new Error('offline'))), sendJson: vi.fn(), qs: (o) => new URLSearchParams(o).toString(), cleanUrl: (u) => u }));
await import('../src/sources/audiobookshelf.js');
const { cardCover } = await import('../src/lib/format.js');

describe('covers from your own server', () => {
  it('a saved cover gets the current sign-in (an old token was refused)', () => {
    expect(cardCover('http://192.168.31.98:3333/api/items/li_42/cover?token=OLD&width=400')).toBe('http://192.168.31.98:3333/api/items/li_42/cover?token=NEW&width=400');
  });
  it('a cover saved with the other address points at the one in use', () => {
    expect(cardCover('http://100.93.52.89:3333/api/items/li_7/cover?token=OLD')).toMatch(/^http:\/\/192\.168\.31\.98:3333\/api\/items\/li_7\/cover\?token=NEW/);
  });
  it('other covers are left alone', () => {
    expect(cardCover('https://covers.openlibrary.org/b/id/1-M.jpg')).toBe('https://covers.openlibrary.org/b/id/1-M.jpg');
  });
});
