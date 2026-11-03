# Store edition — saved work

The AudioYam store edition (Google Play / App Store) started on 3 Nov as a copy of the public
AudioYam (drdilips1/Audiohub, commit ac0a33c = release v1.0.27) plus one commit, saved here as
`store-edition.patch` so it isn't lost before it has its own repo.

Rebuild it: clone drdilips1/Audiohub, `git checkout ac0a33c`, `git am store-edition.patch`.
Plan and checklist: `STORE_PLAN.md`. Next: wait for the shared codebase, then build the store
edition as an edition of it (see ROADMAP.md → Code clean-up / Store launch plan).
