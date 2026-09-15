---
"@effected/schemastore-cli": minor
---

## Breaking Changes

### Loads the new keyed config shape, verifies frozen versions, and writes one catalog file

The CLI now loads `@effected/schemastore`'s keyed `defineConfig` shape (schemas keyed by name, versions/current, derived `$id` and catalog URLs) — every `schemastore.config.ts` must be updated to that shape before `build` or `check` will run against it.

Before generating or checking anything, the `Runner` now verifies that every declared frozen version's file exists on disk. A missing one fails with `FrozenVersionMissingError` and exits `1` before any write happens, so a config that advertises a version whose file was deleted or never committed is caught immediately instead of silently dropping that entry from the catalog.

Drift classification is now reported per schema rather than as one run-wide verdict, and `--drift`/`--force` force the same policy across every schema for that run. All declared catalog entries are assembled into a single `catalog.json` array at the config's `catalogPath`, replacing any per-schema catalog file from the previous config shape.

The human, JSON and step-summary report shapes changed to match: the JSON report's `drift` field is now an object (`{ onDrift, source, policy? }`) instead of a single string, and `catalog` is a single object (`{ path, entries, outcome }`) rather than a per-schema list. `--drift`, `--on-drift`, `--force` and `--format` flag descriptions were updated to describe the new config shape.
