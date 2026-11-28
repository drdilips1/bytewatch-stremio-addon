import { describe, it, expect, vi } from 'vitest';
// The player (loaded by podcasts.js for playing) isn't needed here.
vi.mock('../src/lib/player.js', () => ({ onFinished() {}, patchBook() {}, playBook() {}, setShowPrefsSource() {}, subscribe() {} }));
const pod = await import('../src/sources/podcasts.js');

describe('playing an episode again from its saved summary', () => {
  it('finds its audio link again (Up next)', async () => {
    pod.podcasts.set({ subs: [], queue: [{ uid: 'pod:x1', title: 'Essentials', url: 'https://cdn/x1.mp3', duration: 2220, podcast: { title: 'Huberman Lab' } }], played: {} });
    const d = await pod.details({ uid: 'pod:x1', source: 'pod', title: 'Essentials' });
    expect(d.tracks[0].url).toBe('https://cdn/x1.mp3');
    expect(d.title).toBe('Essentials');
  });
  it('keeps an episode that already has its link', async () => {
    const b = { uid: 'pod:y', tracks: [{ url: 'https://a/y.mp3' }] };
    expect(await pod.details(b)).toBe(b);
  });
  it('gives back the summary when the episode is nowhere to be found', async () => {
    const d = await pod.details({ uid: 'pod:none', source: 'pod' });
    expect(d.tracks).toBeUndefined();
  });
});
