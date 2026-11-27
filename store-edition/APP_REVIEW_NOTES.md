# AudioYam store edition — App Store Connect texts (draft, 27 Nov 2026)

Build: ios.yml with destination **testflight** and edition **store** (VITE_EDITION=store).
Internal testers can still get full builds (edition full) from the same app record: TestFlight
lets you choose which builds each group gets.

## App Review notes (paste as is)
AudioYam is a player for audiobooks, ebooks, comics and podcasts.
- Out of the box it plays the user's own files (Files app / iCloud), the user's own Audiobookshelf
  server, podcasts, and free public-domain audiobooks (LibriVox, Project Gutenberg, Internet Archive)
  under Discover → Free.
- Users can install add-ons of their own (Settings → Addons, by pasting a link) and connect cloud
  accounts of their own (Settings → Your cloud services). The app includes no add-ons and no accounts,
  and links to none.
- AI features (X-Ray, Talk, summaries) use the user's own AI key, stored on the device.
- No sign-in is needed to use the app. Optional account for sync; it can be deleted in the app:
  Settings → Account & sync → Delete my account.
To try it: Discover → Free → pick any LibriVox book → Play.

## URLs
- Privacy policy: https://listen.audiohubapp.com/privacy.html
- Support: https://listen.audiohubapp.com/privacy.html#support (or https://github.com/drdilips1/Audiohub/issues)

## Other answers
- Encryption: uses only standard HTTPS → exempt (ITSAppUsesNonExemptEncryption = NO).
- Age rating: 12+ suggested (user-added content, unrestricted web access via add-ons → answer
  "Unrestricted Web Access: No" only if add-ons can't open web pages; they open the site's reader
  for comics → answer Yes → 17+). Decide when filling the questionnaire.
- Sign in with Apple: required if the account sign-in offers Google — check before submitting
  (account sign-in uses Supabase with email + Google).
- Content rights: "Does your app contain, show or access third-party content?" → Yes; "Do you have
  the rights?" → the app shows content the user adds from their own sources and public-domain works.

## What's different from the full app (src/lib/edition.js STORE)
Hidden: Home server (qBittorrent), Tracker, Torrent app, Usenet; seed counts; torrent-app
hand-off. Reworded: "Your cloud services", "Default cloud service", "Connect your cloud service".
What's new: no torrent card, no site names. Same everything else.
