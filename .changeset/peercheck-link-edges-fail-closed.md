---
"@effected/workspaces": minor
---

## Bug Fixes

- `PeerCheck.run` now fails closed on `link:`-resolved importer dependencies: a report whose lockfile records any importer dependency as `link:` — every pnpm `workspace:` dependency, and `linkWorkspacePackages: deep` edges into publish directories — carries `"unresolvedEdge"` in `unverified` instead of reporting verified. pnpm records no peer declarations for workspace projects, so a parent reached through `link:` joins at best to a row whose peers are empty by design and at worst (the root importer) to nothing at all, while `pnpm peers check` reads the linked manifest on disk and reports those peers. A gate that read `unverified: []` as proof of a clean tree therefore passed workspaces pnpm itself called unmet — the silent-success shape the report exists to prevent. Closes effected#800.
- No rows are fabricated for the invisible parent: `unsatisfied` is unchanged, and the existing decline-not-invent behavior for workspace-provided peers is kept. The fix moves the completeness claim only.
- Consequence to weigh before adopting: under pnpm, any workspace with internal `workspace:` dependencies now yields an unverified report until the join-from-disk route (the issue's option 1) lands. npm and bun lockfiles never record a per-importer `version`, so their reports are unaffected.

## Other

- New committed oracle fixture `__test__/fixtures/peers/linkdeep/` — the probe workspace from the issue, real pnpm 12.5.1 output, with `pnpm peers check --json`'s divergent verdict committed verbatim beside the lockfile.
