# Handoff — one window per app

Each app has its own file here. A new Claude window for an app starts by reading **RULES.md** (shared
rules) and **that app's file**, so it knows everything without the long chat history.

| App | File | Code |
|---|---|---|
| Audiohub+ (private, main) | audiohub-plus.md | this repo, `inkwell/` |
| AudioYam (public) | audioyam.md | `drdilips1/Audiohub`, branch `work` |
| Audibrisk (minimal search & play) | audibrisk.md | this repo, `inkwell/brisk/` |
| Hearth / Duet (library apps) | hearth-duet.md | this repo, `inkwell/hearth/`, `inkwell/duet/` |
| Narrato / store edition | store-edition.md | this repo, `store-edition/` |

Opening message for a new window (copy, change the app name):

> Work only on **<App>**. First read `handoff/RULES.md` and `handoff/<file>.md` in
> drdilips1/bytewatch-stremio-addon (branch claude/books-tbm-apk-enhancement-h1p51j) and follow them.
> Don't change other apps' folders. Keep `handoff/<file>.md` up to date (state, pending list) after
> each change. Then: <today's task>.

Ending a window: say "update the handoff file" — it records what was done and what's pending.
