---
"@effected/app": patch
---

## Documentation

Reconciles the "effected" plugin's package routing map with the kit's current state. The map had drifted on four facts that a session consuming it would have taken as authoritative.

* The kit is **27 packages**, not 25 — the session-start orientation had carried the older count, so every session began with it
* All 27 are published: `jsonl` reached `0.2.0` in the 27-package beta.107 wave, replacing the claim that it sat unreleased at `0.0.0` awaiting a future wave
* Releases are changeset-driven — CI releases whatever the pending changesets name, and a package may be released on its own. This replaces the rule that the kit ships only in coordinated waves, never one package at a time
* `@effected/toml` parses the full **TOML 1.1.0** grammar while `stringify` deliberately emits only **1.0.0** spellings; the map described both directions as 1.0.0. Neither side should be changed to match the other — the asymmetry keeps output portable
