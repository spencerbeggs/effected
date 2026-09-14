---
"@effected/schemastore-cli": minor
---

## Features

`DriftError` now names each drifting schema instead of only a count: its `drifted` field carries, per schema, the `$id`, the `change` kind, the published `version` (when known) and the suggested `nextVersion` (when derivable). `count` is still available as a getter derived from `drifted.length`, and the rendered message lists every drifting schema.

Combining `--force` with an explicit `--drift` other than `allow` is now a usage error (`ConflictingFlagsError`, exit `64`) instead of silently resolving to `allow` — `--force` is shorthand for `--drift=allow`, so the combination was always contradictory.

## Bug Fixes

- Catalog entries are now compared to the file on disk with a single read (previously a separate `exists` check plus a read), and the comparison is structural (`CanonicalJson.equals`) rather than a hand-rolled deep-equal — a path that does not parse, or does not exist, is treated as "different" so a build repairs it.
