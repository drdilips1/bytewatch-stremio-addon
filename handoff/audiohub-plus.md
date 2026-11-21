# Audiohub+ (private, the main app)

- Code: `inkwell/` (screens `inkwell/src/`, Android `inkwell/android/`, Cloudflare worker `inkwell/workers/`).
- Build ("build"): dispatch `inkwell-apk.yml` and `audiohub-ios.yml` on the branch; when the APK
  release is out, dispatch `inkwell-web.yml` (its pages job failing is expected). Releases
  `inkwell-v1.0.N` (Android, in-app update), `audiohub-ios-N` (unsigned IPA for AltStore).
- Latest: Android v1.0.232; iPhone build 112 (later iOS builds fail — Mac minutes used up).
- Built in since v1.0.232 (not yet in a build): instant play (server place asked in the background),
  glow fade on player open, Libby live availability, auto-send never re-sends backlog + skips torrents
  qBittorrent has, Goodreads clearer refusal + CSV hint, ebook cards, banner title fit, Play timing line.
- Pending / feedback: see `inkwell/ROADMAP.md` (sections "Feedback 19 Nov", "Feedback 21 Nov", Usenet,
  book page people row, AudioYam items).
