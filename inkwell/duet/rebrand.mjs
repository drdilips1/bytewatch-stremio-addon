// Turns the shared Android project into Duet for its build (run in CI, after
// `npx cap sync android` with Duet's own Capacitor config): its own app id (so it installs
// beside Audiohub), name, icons and splash; no Audiohub-only shortcuts, widget or quote links.
//   node duet/rebrand.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, '../android/app');
const edit = (file, f) => {
  const p = path.join(app, file);
  const before = fs.readFileSync(p, 'utf8');
  const after = f(before);
  if (after === before) throw new Error(`Nothing changed in ${file} — has it moved on?`);
  fs.writeFileSync(p, after);
};

edit('build.gradle', (s) => s.replace('applicationId "app.inkwell.books"', 'applicationId "app.duet.player"'));
edit('src/main/res/values/strings.xml', (s) =>
  s
    .replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Duet</string>')
    .replace(/<string name="title_activity_main">[^<]*<\/string>/, '<string name="title_activity_main">Duet</string>')
    .replace(/<string name="package_name">[^<]*<\/string>/, '<string name="package_name">app.duet.player</string>')
    .replace(/<string name="custom_url_scheme">[^<]*<\/string>/, '<string name="custom_url_scheme">app.duet.player</string>'),
);
edit('src/main/AndroidManifest.xml', (s) =>
  s
    .replace(/android:scheme="app\.inkwell\.books"/g, 'android:scheme="app.duet.player"')
    // Audiohub only: shared-quote links, app shortcuts and the home-screen widget.
    .replace(/\s*<!-- Shared quotes[\s\S]*?<\/intent-filter>/, '')
    .replace(/\s*<meta-data android:name="android\.app\.shortcuts"[^>]*\/>/, '')
    .replace(/\s*<!-- Home-screen widget[\s\S]*?<\/receiver>/, ''),
);

// Icons and splash screens.
const res = path.join(here, 'android-res');
const copy = (from, to) => {
  for (const f of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, f.name);
    const b = path.join(to, f.name);
    if (f.isDirectory()) fs.mkdirSync(b, { recursive: true }), copy(a, b);
    else fs.copyFileSync(a, b);
  }
};
copy(res, path.join(app, 'src/main/res'));
console.log('Android project is now Duet (app.duet.player).');
