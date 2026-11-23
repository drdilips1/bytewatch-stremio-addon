# AudioYam store edition (Google Play / App Store) and AudioYam Lite

- Store edition: saved as `store-edition/store-edition.patch` on top of drdilips1/Audiohub commit
  ac0a33c (v1.0.27); plan in `store-edition/STORE_PLAN.md`. Lite builds via `lite-build.txt` +
  `.github/workflows/lite-apk.yml`.
- 23 Nov (from the AudioYam window, user decided): money model = free + **one-time Plus unlock** (≈ $9.99) +
  optional **AI pass** subscription only for AI without own key; full AudioYam stays free. Details and the
  free / Plus / AI-pass split in `store-edition/STORE_PLAN.md` ("Decided 23 Nov"). Feature switch groundwork:
  `src/lib/plus.js` in drdilips1/Audiohub (`work`), always on in AudioYam, `VITE_EDITION=store` for the store build.
