// How light a cover is: decides when the glass card darkens so white text stays readable.
import { describe, it, expect } from 'vitest';
import { meanLight } from '../src/lib/color.js';

const px = (...rgb) => new Uint8ClampedArray(rgb.flatMap(([r, g, b]) => [r, g, b, 255]));

describe('meanLight', () => {
  it('is 1 for white, 0 for black, about half for mid grey', () => {
    expect(meanLight(px([255, 255, 255]))).toBeCloseTo(1);
    expect(meanLight(px([0, 0, 0]))).toBeCloseTo(0);
    expect(meanLight(px([128, 128, 128]))).toBeCloseTo(0.5, 1);
  });

  it('counts green as lighter than blue (as the eye does)', () => {
    expect(meanLight(px([0, 200, 0]))).toBeGreaterThan(meanLight(px([0, 0, 200])));
  });

  it('a cream cover with dark lettering is still light', () => {
    expect(meanLight(px([244, 240, 226], [244, 240, 226], [244, 240, 226], [40, 36, 30]))).toBeGreaterThan(0.6);
  });
});
