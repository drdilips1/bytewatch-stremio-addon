# AudioYam (public)

- Code: `drdilips1/Audiohub` (clone to `/home/user/audiohub`), work on branch `work`.
- Release: push `work` → `main` publishes Android `v1.0.N` (in-app update) and the web app; push to
  `test` builds a test APK only. iPhone: `.github/workflows/ios.yml` (free Mac minutes — public repo),
  releases `ios-N`, AltStore source `releases/download/ios-source/altstore.json`.
- Latest: Android v1.0.36 (15-feature port + old logo); iPhone ios-1.
- On `work`, not released yet: quiet logo (theme colour), instant play, glow fade, duplicate-send fix,
  banner title fit, Goodreads messages, iPhone build.
- Porting from Audiohub+: 3-way merge per file, then scrub everything private (see RULES.md) and grep.
- Pending: local files on iPhone (Files folder + Add files); Usenet (Easynews first); see ROADMAP.
