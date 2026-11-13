---
id: "0017"
title: "@effected/changesets: ReleasePlan.read detects pnpm-native versioning, widens its error channel, and @effected/npm is a required peer"
kind: breaking
shows: typed
applies:
  "@effected/changesets": ">=0.6.0"
detect: ["ReleasePlan\\.(read|readWithContext)", "ReleasePlan\\.edits", "\"@effected/changesets\""]
changesets: ["changesets-pnpm-native-planning"]
---

Act on each hit:

1. **Install the peer.** Where the search matched `"@effected/changesets"` in a manifest, add `@effected/npm` beside it (`catalog:effected`). It is a required peer: `RegistryVersions.layerFrom` takes your `NpmConfig`, and the class is nominal, so both must be one copy.
2. **`ReleasePlan.read` decides the release manager first.** A `pnpm-workspace.yaml` with a `versioning` block, or a `.changeset/ledger.yaml`, plans the release pnpm's way; anything else plans as before. A malformed `versioning` block now fails a changesets-only workspace with `PnpmSettingsError`. The error channel of `read` and `readWithContext` widens to include `VersioningError`, `AmbiguousPackageError`, `PnpmSettingsError`, `LedgerError` and `RegistryReadError`: an exhaustive `catchTags` or a typed error union stops compiling until it names them.
3. **Name-keyed readers refuse twins.** In pnpm mode a plan may release two projects with one name; `ReleasePlan.edits`, `breakingFloors` and `releasesByName` then fail `AmbiguousPackageError` naming the directories. A changesets-mode plan never does.
4. **First releases need the registry seam.** In a pnpm-native repository, provide `RegistryVersions.layerFrom(config)` (it requires `NpmRegistry`) wherever the plan feeds a publish. It is read optionally and never appears in `R`, so omitting it compiles, plans no debut, and a never-published `1.0.0` plans `1.1.0`.

Check each name against the installed `.d.ts`, then run the typecheck and tests.
