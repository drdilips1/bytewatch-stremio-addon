// Duet's launcher icons and splash screens → duet/android-res/ (copied over the Android
// project's res/ when Hearth is built). Run once after changing the artwork:
//   node duet/make-icons.mjs   (needs Playwright with Chromium)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'android-res');
const res = path.join(here, '../android/app/src/main/res');

// Duet: seven sound bars (amber → violet) over three lines of text, on deep ink.
const BARS = [[150, 70], [190, 120], [230, 80], [270, 170], [310, 110], [350, 140], [390, 70]]
  .map(([x, h], k) => `<rect x="${x - 12}" y="${222 - h / 2}" width="24" height="${h}" rx="12" fill="url(#${k < 4 ? 'a' : 'v'})"/>`)
  .join('');
const ART = `${BARS}<rect x="156" y="318" width="200" height="14" rx="7" fill="url(#t)"/><rect x="186" y="348" width="140" height="14" rx="7" fill="url(#t)" opacity=".75"/><rect x="171" y="378" width="170" height="14" rx="7" fill="url(#t)" opacity=".5"/>`;
const GRADS = '<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc88e"/><stop offset="1" stop-color="#ff7a59"/></linearGradient><linearGradient id="v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfc6ff"/><stop offset="1" stop-color="#8f7dff"/></linearGradient><linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#ffb36b"/><stop offset="1" stop-color="#8f7dff"/></linearGradient>';
const BG = `<defs>${GRADS}<radialGradient id="g" cx=".3" cy=".25" r=".9"><stop offset="0" stop-color="#3a2a4a"/><stop offset=".6" stop-color="#16141f"/><stop offset="1" stop-color="#0d0e13"/></radialGradient></defs>`;
const full = (round) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${BG}<rect width="512" height="512" rx="${round ? 256 : 116}" fill="url(#g)"/><g transform="translate(256 256) scale(${round ? 0.86 : 0.92}) translate(-270 -270)">${ART}</g></svg>`;
const fg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs>${GRADS}</defs><g transform="translate(256 256) scale(0.6) translate(-270 -270)">${ART}</g></svg>`;
const bg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${BG}<rect width="512" height="512" fill="url(#g)"/></svg>`;
const splash = (w, h) => {
  const s = Math.min(w, h) * 0.26;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#0d0e13"/><g transform="translate(${(w - s) / 2} ${(h - s) / 2}) scale(${s / 512})">${full(false).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g></svg>`;
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
console.log('Duet icons and splash screens: duet/android-res/');
