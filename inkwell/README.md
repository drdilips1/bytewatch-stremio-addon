# Inkwell — audiobooks & ebooks for Android

A colourful, fast audiobook player and ebook reader inspired by InkShelf, with
more built-in sources and integrations. Built with Preact and Vite, and packaged
for Android with Capacitor.

<p>
  <img src="docs/home.png" width="180" alt="Home" />
  <img src="docs/book.png" width="180" alt="Book page" />
  <img src="docs/player.png" width="180" alt="Player" />
  <img src="docs/reader.png" width="180" alt="Reader" />
</p>

## Highlights

**Look and feel**
- Dark, pure-black (AMOLED) and light modes, with 8 gradient accent themes (Aurora, Sunset, Ocean, Forest, Rose, Ember, Gold, Ice).
- Dynamic colour: the player and book pages take their tint from the cover art.
- Animated ambient background, a rotating hero carousel, glass tab bar, skeleton loaders and bundled variable fonts (Plus Jakarta Sans, Fraunces, Literata).

**Sources (free, built in)**
| Source | What you get |
| --- | --- |
| Internet Archive | The full LibriVox mirror, old-time radio, and spoken-word recordings, with per-chapter tracks |
| LibriVox API | 20,000+ volunteer-read public-domain audiobooks |
| Project Gutenberg (Gutendex) | 75,000+ ebooks you can read in the app |
| Open Library | Trending lists, subjects, descriptions and covers, cross-matched to free audio and ebook editions |

**Integrations**
- **Audiobookshelf**: sign in with a password or an API key (LAN addresses such as `192.168.1.20:13378` work). Browse, search and stream your library; listening progress syncs both ways, and short-lived tokens refresh automatically.
- **TorBox / Real-Debrid**: paste your API key to browse and stream the audiobooks already in your cloud (torrents, usenet and web downloads). Download links are requested just before playback, so they don't expire mid-book. You can also add a magnet or link to your cloud from Settings.
- **Addons**: install catalog addons by link: a Stremio-style `manifest.json` (such as a TorBox audiobook addon), a JSON manifest hosted anywhere (jsonkeeper, gist…), or an addon collection. Catalogs appear on Home, and results show up in search.
- **Hardcover**: connect with your API token to show your Currently Reading and Want to Read shelves, and set a book's status from its page.
- **Goodreads**: Goodreads has no public API, so import your library export (CSV) to get your shelves.
- For any book found through Open Library, Hardcover or Goodreads, Inkwell searches your server, cloud, addons and the free libraries for a copy you can play or read.

**Player**
- Background playback with lock-screen and notification controls (runs as a media foreground service).
- Chapters, speeds from 0.5× to 3×, adjustable skip intervals, bookmarks, and a sleep timer that fades out (or stops at the end of a part).
- Progress saved automatically, with a short rewind when you resume after a break.

**Ebooks to audio**
- Phone voice (free, offline) reads any Gutenberg ebook aloud in the reader with paragraph highlighting.
- AI voices: OpenAI (gpt-4o-mini-tts / tts-1-hd), Google Cloud (Chirp 3 HD), ElevenLabs, using your own key. The book becomes a chaptered audiobook in the player, generated a section ahead as you listen and cached on the device.

**Reader**
- Night, Black, Sepia and Paper themes; serif or sans text; adjustable size; table of contents; tap the edges to turn pages; remembers your position.

**Library**
- Saved books, in-progress, finished, listening stats, and backup/restore (export and import as JSON).

## Getting the APK

Every push that touches `inkwell/` runs **.github/workflows/inkwell-apk.yml**. It builds
a signed release APK, attaches it to a GitHub Release called `inkwell-v1.0.<run>`, and
uploads it as a workflow artifact.

**Permanent signing (updates install over each other, data kept):** add one
repository secret, `INKWELL_KEYSTORE_BASE64`, holding the base64 of the release
keystore (password `inkwell-ci`, alias `inkwell` unless overridden with
`INKWELL_KEYSTORE_PASSWORD` / `INKWELL_KEY_ALIAS` / `INKWELL_KEY_PASSWORD`). Without it
each build uses a throwaway key and needs an uninstall first. The app checks GitHub
Releases for updates (Settings → top card).

**Accounts & sync:** Settings → Account & sync connects to your own free Supabase
project (setup SQL is shown in the app). To bake a server into builds, set repository
*variables* `INKWELL_SUPABASE_URL` and `INKWELL_SUPABASE_ANON_KEY`.

## Develop locally

```bash
cd inkwell
npm install
npm run dev            # web preview at http://localhost:5173
npm run android:apk    # needs the Android SDK (API 36) and JDK 21
npm run icons          # re-render launcher icons & splash from public/icon.svg
```

In a desktop browser, a few sources may be blocked by CORS. The Android app uses
native HTTP, so it doesn't have that limitation.

## Project layout

```
inkwell/
├── src/
│   ├── sources/        archive, librivox, gutenberg, openlibrary, audiobookshelf, addons
│   ├── lib/            player engine, persistent store, theming, http, navigation
│   ├── components/     covers, rows, mini & full player, icons
│   └── screens/        Home, Discover, Library, Settings, Book, Browse, Reader
├── android/            Capacitor Android project (icons, permissions, signing)
└── scripts/make-icons.mjs
```

Built-in sources only serve public-domain or openly licensed works. You are
responsible for any addons or servers you connect.
