// Hearth's launcher icons and splash screens → hearth/android-res/ (copied over the Android
// project's res/ when Hearth is built). Run once after changing the artwork:
//   node hearth/make-icons.mjs   (needs Playwright with Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'android-res');
const res = path.join(here, '../android/app/src/main/res');

// A small flame: warm cream on terracotta.
const FLAME = '<path d="M256 92c18 58 86 96 86 178a86 86 0 0 1-172 0c0-40 22-66 42-86 4 34 22 52 40 58-12-50 4-104 4-150z" fill="#fbf3e6"/><path d="M256 250c10 26 38 40 38 74a38 38 0 0 1-76 0c0-20 12-32 22-42 2 14 8 22 16 26-4-20 0-40 0-58z" fill="#e8a36c"/>';
const BG = '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d77a4a"/><stop offset="1" stop-color="#b4532a"/></linearGradient></defs>';
const full = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${BG}<rect width="512" height="512" rx="${round ? 256 : 116}" fill="url(#g)"/><g transform="translate(256 262) scale(1.32) translate(-256 -224)">${FLAME}</g></svg>`;
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 262) scale(0.86) translate(-256 -224)">${FLAME}</g></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${BG}<rect width="512" height="512" fill="url(#g)"/></svg>`;
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.26;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f7f4ef"/><g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 512})">${full(false).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;
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
console.log('Hearth icons and splash screens: hearth/android-res/');
