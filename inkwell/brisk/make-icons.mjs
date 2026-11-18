// Audibrisk's launcher icons and splash screens → brisk/android-res/ (copied over the Android
// project's res/ when Audibrisk is built). Run once after changing the artwork:
//   node brisk/make-icons.mjs   (needs Playwright with Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'android-res');
const res = path.join(here, '../android/app/src/main/res');

// An italic serif A inside a fine gold ring, on ink.
const FLAME = '<circle cx="256" cy="224" r="150" fill="none" stroke="#c9a96e" stroke-width="9"/><text x="256" y="292" text-anchor="middle" font-family="Georgia, \'Times New Roman\', serif" font-style="italic" font-size="210" fill="#e3c88f">A</text>';
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c1a17"/><stop offset="1" stop-color="#0b0a09"/></linearGradient></defs>';
const full = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${BG}<rect width="512" height="512" rx="${round ? 256 : 116}" fill="url(#g)"/><g transform="translate(256 262) scale(1.32) translate(-256 -224)">${FLAME}</g></svg>`;
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 262) scale(0.86) translate(-256 -224)">${FLAME}</g></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${BG}<rect width="512" height="512" fill="url(#g)"/></svg>`;
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.26;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0d0c0b"/><g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 512})">${full(false).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;
};

const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const browser = await chromium.launch();
const page = await browser.newPage();
async function render(markup, w, h, file, transparent = true) {
  await page.setViewportSize({ width: Math.round(w), height: Math.round(h) });
  await page.setContent(`<html><body style="margin:0;background:transparent">${markup.replace('<svg ', `<svg width="${Math.round(w)}" height="${Math.round(h)}" `)}</body></html>`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: transparent, clip: { x: 0, y: 0, width: Math.round(w), height: Math.round(h) } });
}
for (const [d, k] of Object.entries(DENS)) {
  await render(full(false), 48 * k, 48 * k, `${out}/mipmap-${d}/ic_launcher.png`);
  await render(full(true), 48 * k, 48 * k, `${out}/mipmap-${d}/ic_launcher_round.png`);
  await render(fg, 108 * k, 108 * k, `${out}/mipmap-${d}/ic_launcher_foreground.png`);
  await render(bg, 108 * k, 108 * k, `${out}/mipmap-${d}/ic_launcher_background.png`, false);
}
// Splash screens: the same sizes as the project's own.
for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('drawable'))) {
  const f = `${res}/${dir}/splash.png`;
  if (!fs.existsSync(f)) continue;
  const b = fs.readFileSync(f);
  await render(splash(b.readUInt32BE(16), b.readUInt32BE(20)), b.readUInt32BE(16), b.readUInt32BE(20), `${out}/${dir}/splash.png`, false);
}
await render(full(false), 512, 512, path.join(here, 'icon-512.png'));
await browser.close();
console.log('Audibrisk icons and splash screens: brisk/android-res/');
