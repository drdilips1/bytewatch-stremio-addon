import { describe, it, expect, vi } from 'vitest';

// No network in tests: every lookup fails, so only the built-in names can match.
vi.mock('../src/lib/http.js', async (orig) => ({ ...(await orig()), getJson: async () => { throw new Error('offline'); } }));
const { findLibraries } = await import('../src/sources/libby.js');

describe('findLibraries', () => {
  it('finds a library by its name', async () => {
    expect((await findLibraries('Los Angeles Public Library')).map((l) => l.key)).toContain('lapl');
    expect((await findLibraries('queens')).map((l) => l.key)).toContain('queenslibrary');
  });
  it('finds nothing for nonsense', async () => {
    expect(await findLibraries('zzqx library of nowhere')).toEqual([]);
  });
});
