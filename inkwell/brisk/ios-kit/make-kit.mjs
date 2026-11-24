// Packs Audibrisk's iPhone kit (run in the private repository's CI, after the screens are built):
// the finished screens, Capacitor settings, the iPhone player and Files plugins, the icon and the
// public repository's build recipe — nothing else. Fails if any of it mentions what must stay out.
//   node brisk/ios-kit/make-kit.mjs <out-dir> <version>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const here = path.dirname(fileURLToPath(import.meta.url));
const inkwell = path.join(here, '../..');
const [out, version] = process.argv.slice(2);
if (!out || !version) throw new Error('usage: make-kit.mjs <out-dir> <version>');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to) => fs.cpSync(path.join(inkwell, from), path.join(out, to), { recursive: true });
copy('dist-brisk', 'dist-brisk');
copy('ios-plugins/files', 'ios-plugins/files');
copy('ios-plugins/player', 'ios-plugins/player');
copy('brisk/icon-512.png', 'icon-512.png');
copy('brisk/capacitor.config.json', 'capacitor.config.json');
fs.mkdirSync(path.join(out, '.github/workflows'), { recursive: true });
copy('brisk/ios-kit/ios.yml', '.github/workflows/ios.yml');
fs.writeFileSync(path.join(out, 'VERSION'), version + '\n');
// The same Capacitor versions the app was built with.
const ver = (name) => JSON.parse(fs.readFileSync(path.join(inkwell, 'node_modules', name, 'package.json'), 'utf8')).version;
const caps = ['@capacitor/core', '@capacitor/app', '@capacitor/browser', '@capacitor/splash-screen', '@capacitor/status-bar'];
const pkg = {
  name: 'audibrisk-ios',
  private: true,
  version,
  description: 'Audibrisk for iPhone — built from this kit by .github/workflows/ios.yml',
  dependencies: {
    ...Object.fromEntries(caps.map((c) => [c, ver(c)])),
    '@capacitor/ios': ver('@capacitor/core'),
    'inkwell-files-ios': 'file:ios-plugins/files',
    'inkwell-player-ios': 'file:ios-plugins/player',
  },
  devDependencies: { '@capacitor/cli': ver('@capacitor/cli') },
};
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
fs.writeFileSync(path.join(out, 'README.md'), `# Audibrisk for iPhone — build kit\n\nMade automatically: Audibrisk's finished screens and its iPhone plugins. The iPhone app (.ipa) and the AltStore source are on the Releases page.\n`);
// Nothing private, ever.
const BANNED = /myanonamouse|mam_id|mobilism|libbyapp|overdrive|annas-archive|bookshare|audiohubapp|drdilipgreat|bytewatch-stremio-addon/i;
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
for (const f of walk(out)) {
  if (/\.(png|jpe?g|webp)$/i.test(f)) continue;
  const m = BANNED.exec(fs.readFileSync(f, 'utf8'));
  if (m) throw new Error(`${path.relative(out, f)} mentions "${m[0]}" — not pushed`);
}
console.log(`iPhone kit ${version} ready in ${out}`);
