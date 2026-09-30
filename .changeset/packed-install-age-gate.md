---
"@effected/workspaces": patch
---

## Bug Fixes

* `PackedInstall` consumers no longer fail on freshly published packages: Yarn Berry 4.10+ consumers get `npmMinimalAgeGate: 0`, which stops `YN0016` quarantine of versions under a day old
* pnpm consumers' `pnpm-workspace.yaml` sets `minimumReleaseAge: 0`, so pnpm 11 and 12 no longer append `minimumReleaseAgeExclude:` entries or resolve a range to an older, mature match
* Berry 2.x through 4.9 consumers are unchanged, since those versions reject an unknown `.yarnrc.yml` setting
