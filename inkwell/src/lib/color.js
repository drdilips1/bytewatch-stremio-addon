import { hashHue } from './format.js';

const memo = new Map();

// Extract a vivid average colour from a cover image. Falls back to a title-derived hue
// when the image can't be read (no CORS, missing cover, ...).
export function coverColor(src, seed = '') {
  const fallback = `hsl(${hashHue(seed || src || '')} 70% 55%)`;
  if (!src) return Promise.resolve(fallback);
  if (memo.has(src)) return memo.get(src);
  const p = pixels(src).then((d) => {
    if (!d) return fallback;
    let r = 0, g = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const R = d[i], G = d[i + 1], B = d[i + 2];
      const max = Math.max(R, G, B), min = Math.min(R, G, B);
      const sat = max ? (max - min) / max : 0;
      const weight = 0.15 + sat * sat * 3 * (max > 40 && max < 245 ? 1 : 0.2);
      r += R * weight; g += G * weight; b += B * weight; w += weight;
    }
    return vivid(r / w, g / w, b / w);
  });
  memo.set(src, p);
  return p;
}

/**
 * How light a cover is, 0 (black) to 1 (white); 0.4 when it can't be read. White text on
 * glass over a pale cover (a cream "Atomic Habits") needs the glass darker to be readable.
 */
export const coverLight = (src) => (src ? pixels(src).then((d) => (d ? meanLight(d) : 0.4)) : Promise.resolve(0.4));

/** The average lightness of RGBA pixels (perceived: green counts most), 0 to 1. */
export function meanLight(d) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i + 2 < d.length; i += 4) {
    sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    n++;
  }
  return n ? sum / n / 255 : 0.4;
}

// A cover shrunk to 24 × 24 pixels (RGBA), or null when it can't be read (no CORS, gone…).
const pixelMemo = new Map();
function pixels(src) {
  if (pixelMemo.has(src)) return pixelMemo.get(src);
  const p = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        const n = 24;
        c.width = c.height = n;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        resolve(ctx.getImageData(0, 0, n, n).data);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 6000);
    img.src = src;
  });
  pixelMemo.set(src, p);
  return p;
}

function vivid(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round(h * 60 + 360) % 360;
  s = Math.min(1, Math.max(0.45, s * 1.4));
  const L = Math.min(0.62, Math.max(0.45, l));
  return `hsl(${h} ${Math.round(s * 100)}% ${Math.round(L * 100)}%)`;
}
