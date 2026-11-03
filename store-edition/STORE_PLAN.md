# AudioYam — store edition (Google Play, then App Store)

A separate app (package `app.audioyam.store`), started from public AudioYam. The private Audiohub+ and the public GitHub AudioYam are not changed for it.
Model: like Stremio / Ink & Echo — **ships empty; people add their own add-ons and sources** (their own debrid-backed add-ons or JSON add-ons included). The app itself has no tracker, qBittorrent or built-in debrid features, and never mentions them.

## Removed or changed

### Light
- [x] New app ID `app.audioyam.store`, so it installs next to the other apps
- [x] Self-updater removed (update prompt, Settings → Updates, "install unknown apps" permission). The store does updates
- [x] qBittorrent / home server: switched off and gone from Settings (no auto-forwarding)
- [x] Tracker browser and tracker search buttons: switched off and gone from Settings
- [x] TorBox and Real-Debrid: gone from Settings and from the Sources list
- [ ] README, FAQ and What's New rewritten for the store: no torrents, trackers, debrid or qBittorrent
- [ ] Leftover code cleaned up (unused Tracker, qBittorrent, updater files and imports)
- [ ] Store build: signed **AAB** for Play (not APK), no GitHub releases, versionCode by build number
- [ ] Neutral wording everywhere: "add-ons", "your sources", "your library"

### Medium
- [ ] Source results: no TorBox / Real-Debrid chips, no "cached" badges, no magnet buttons; add-on results play only from links they give (an add-on can resolve its own debrid account and return links)
- [ ] Unofficial services replaced: Microsoft Edge voices → on-device voices (plus your own key for natural voices); Audible / Apple / Goodreads lookups → Open Library and Google Books (official)
- [ ] Privacy policy page and Play **Data safety** answers (account, sync; AI keys stay on the phone)
- [ ] **Delete my account**, in the app and on a web page (Play rule for apps with sign-in)
- [ ] Media-playback foreground service declared; DATA_SYNC only if downloads need it
- [ ] Store listing: screenshots, short and long text, content rating, neutral wording

### Heavy
- [ ] Add-on hosting moved off `api.audiohubapp.com` to a separate, unbranded address; never linked from the app or the listing
- [ ] Add-on builder website (neutral address): a form that makes the add-on JSON, with a test search
- [ ] Billing (Google Play Billing) for AudioYam Plus, see below
- [ ] Closed test: 12+ testers for 14 days (Play rule for new personal accounts)
- [ ] App Store version later: iPhone downloads first, $99/year account, stricter review

## Added

### Light
- [ ] Free sources back on, as switches: LibriVox, Internet Archive, Project Gutenberg, Standard Ebooks
- [ ] First-run screen: "Add your books": phone folder, Audiobookshelf, an add-on link, or free classics

### Medium
- [ ] **OPDS catalogues** (Calibre, Standard Ebooks, Gutenberg, Kavita, Komga): the open standard for book libraries
- [ ] **Android Auto**: browse and play in the car
- [ ] Cloud folders: **Google Drive, Dropbox, OneDrive, WebDAV / Nextcloud**
- [ ] Chromecast; widget polish

### Heavy
- [ ] **Jellyfin / Plex / Emby** audiobook libraries
- [ ] iPhone: downloads and "Add audiobook files"
- [ ] Wear OS controls

## Making money: AudioYam Plus

Free stays fully useful: the player, your library from every source, sync, bookmarks, sleep timer, speed and add-ons. Plus pays for what costs money to run, or saves real time.

| Plus feature | Exists now? | Why people pay |
|---|---|---|
| **Ask the book** with AI, no key needed (we pay the AI) | yes, needs own key today | biggest "wow"; a running cost, so it fits a subscription |
| **Chapter summaries, X-Ray characters, "previously on" recap** | yes | saves time, unique |
| **Live transcript + ebook sync, highlights, quote cards** | yes | readers and students love it |
| **Natural voices** for read-aloud and translation | yes (Edge today) → paid voice service | quality you hear |
| **Whole-book translation** | yes | language learners |
| **Cloud folders** (Drive, Dropbox, WebDAV) and Jellyfin / Plex | to add | power users pay for convenience |
| **Unlimited sync devices, listening stats history, backups** | partly | low cost, steady value |
| **Themes, icons, player styles** | yes | small but popular |

**Prices (suggested):** about **$2.99 a month or $19.99 a year**, with a lower price in India (around ₹149 a month or ₹999 a year, Play sets regional prices). Also a **lifetime option** (around $49) for people who hate subscriptions. A **7-day free trial** of Plus.

**Bring your own AI key stays free:** people with their own OpenAI / Gemini / OpenRouter key keep the AI features without paying. That's goodwill on Reddit, and we only pay for AI for subscribers.

**Other income:**
- **Tips / supporter badge** (one-time, in the app), for people who just want to support.
- **AI credit packs** (one-time) for heavy AI users without a subscription.
- **No ads.** They spoil a listening app, and your users will hate them.
- **Later:** a family plan (up to 5 people) and a student discount.

**Costs to cover:** AI calls (a few cents per summary or answer, cap the monthly use per subscriber), sync storage (small), voice service (if paid), Play's fee (15% of subscriptions).
