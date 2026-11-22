// iPhone's player is told a cloud file's type: an .mp4 audiobook played on Android but not on iPhone.
import { describe, it, expect } from 'vitest';
import { mimeFor } from '../src/lib/mime.js';

describe('mimeFor', () => {
  it('knows the audiobook types from the file name', () => {
    expect(mimeFor('World as Will and Idea - Volume 1.mp4')).toBe('video/mp4');
    expect(mimeFor('Book.M4B')).toBe('audio/mp4');
    expect(mimeFor('01 - Chapter.mp3')).toBe(''); // MP3 left as it was
    expect(mimeFor('no extension')).toBe('');
    expect(mimeFor('book.opus')).toBe('');
  });
});
