# DermScholar for iPhone

The same screens as the Android app (built from `../app/src/main/assets/www` plus `../web/web.js`),
in a small Swift app that opens UpToDate, Research4Life and MyLOFT in its own browser and files
PDFs opened there into the library.

GitHub builds an unsigned `DermScholar.ipa` on every change (release `dermscholar-ios-<n>`).

## Installing with AltStore (free Apple ID, renews itself every 7 days)

1. On the Mac: install AltServer from altstore.io and keep it running.
2. Connect the iPhone by cable once. In Finder, select the iPhone and tick "Show this iPhone when on Wi-Fi".
3. AltServer menu → Install AltStore → choose the iPhone, sign in with the Apple ID.
4. On the iPhone: Settings → Privacy & Security → Developer Mode → on (restarts), then
   Settings → General → VPN & Device Management → the Apple ID → Trust.
5. AirDrop `DermScholar.ipa` to the iPhone, save it to Files, then AltStore → + → choose it.

New versions: repeat step 5. The library, notes and logins stay.
