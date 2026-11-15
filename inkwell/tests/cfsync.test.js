import { describe, it, expect } from 'vitest';
import { deriveKeys, seal, open } from '../src/lib/cfsync.js';

describe('own encrypted sync', () => {
  it('gives the same keys for the same email and password (email case and spaces ignored), different ones otherwise', async () => {
    const a = await deriveKeys('Reader@Example.com ', 'correct horse');
    const b = await deriveKeys('reader@example.com', 'correct horse');
    const c = await deriveKeys('reader@example.com', 'wrong horse');
    expect(a).toEqual(b);
    expect(c.key).not.toBe(a.key);
    expect(c.auth).not.toBe(a.auth);
    expect(c.user).toBe(a.user); // who you are depends on the email only
    expect(a.user).toMatch(/^[a-f0-9]{64}$/);
    expect(a.key).not.toBe(a.auth); // the key that's sent never opens the data
  });
  it('locks and unlocks the data; another password cannot open it', async () => {
    const { key } = await deriveKeys('reader@example.com', 'correct horse');
    const other = (await deriveKeys('reader@example.com', 'wrong horse')).key;
    const data = { progress: { a: { t: 5, v: { global: 120 } } }, debrid: { t: 1, v: { torbox: 'secret-key' } } };
    const blob = await seal(data, key);
    expect(blob.startsWith('v1.')).toBe(true);
    expect(blob).not.toContain('secret-key');
    expect(await open(blob, key)).toEqual(data);
    await expect(open(blob, other)).rejects.toThrow(/couldn't be opened/);
  });
});
