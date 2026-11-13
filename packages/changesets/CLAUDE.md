# @effected/changesets

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Nothing here writes a changeset, versions a package or publishes one.

**Tier: boundary.** The parsers and the planner are pure; reading a repository requires core's `FileSystem` and `Path` in `R`, plus `WorkspaceDiscovery` for `ReleasePlan.read`. Runtime deps are `@effected/yaml` (front matter), `@effected/semver` (ranges and bumps), `@effected/glob` (`ignore` and group patterns), `@effected/pnpm` (`PnpmSettings` and `VersioningConfig`, for `ReleaseManager.detect` and the pnpm planner, and `PnpmMatcher` for epic selectors) and `@effected/workspaces` (packages and dependency edges). The `./lint` subpath adds `@effected/markdown` and `@effected/markdown-lint` as **optional peers**: a consumer hands our `LintRule` instances to its own `MarkdownLint`, so they share one copy. **The root must never import either**, directly or transitively; `entrypoints.test.ts` walks the root's imports to hold that.

**For the full design:** → `@./okf/modules/changesets.md`

Load when changing the public API, the package's dependency edges, or who consumes the plan.

## Module layout

- `BumpType.ts`: `BumpType` is `patch | minor | major`, and `ReleaseType` adds `none`, which a changeset may write: it names the package and moves no version.
- `ChangesetFile.ts`: `parseSync` and `parse` for one file, to `ParsedChangeset`. The summary is trimmed, as `@changesets/parse` trims it; `ChangesetFile.test.ts` holds it to that parser.
- `PendingChangesets.ts`: `read` and `readSync` for `.changeset/`, then `.changeset/pre/` as `pre/<name>.md`, to `PendingChangeset`, whose `id` getter is the file without `.md` (`pre/<name>`), the id `@changesets/read` gives. They are strict: one bad file fails the read, and `ReleasePlan.read` depends on that. `readSettled` and `readSettledSync` list the same files the same way, but put each bad file in `failures` as `{ file, error }`, with `error` the typed parse or IO error. Only a directory that cannot be listed fails them. Both pairs share `listFiles` / `listFilesSync`, so they cannot disagree about which files count.
- `ReleaseManager.ts`: `ReleaseManager` (`"changesets" | "pnpm"`, a schema with a `detect` static) and `detect(root, options?)`: `"pnpm"` when `PnpmSettings.load` (workspace file only) reports a `versioning` block, or `.changeset/ledger.yaml` exists; `"changesets"` otherwise. `pre.json` and `config.json` decide nothing, since pnpm ignores them. An undecodable `versioning` fails `PnpmSettingsError`. `PnpmSettings.load` takes `env` and `platform` as plain values, so `options` carries them (defaults `{}` and `"linux"`); no extra service in `R`.
- `Ledger.ts`: `Ledger` (`entries: LedgerEntry[]`), `LedgerEntry` (`name`, `version`, optional `dir`, `intents`) and `Ledger.read(root)` (`Option` of `.changeset/ledger.yaml`, `None` when absent; `Ledger.parseResult` is the sync twin; `LedgerError` on malformed input, never a defect). Keys split on the LAST `@` after position 0 (scoped names); a key with no split is skipped; a bare id list (no `dir`) and a null entry are accepted, as `ledger.rs` does. Matching mirrors `build_consumption_index`: an attributed entry (with `dir`) matches only by pnpm-normalised `dir`, never by the name in its key (rename and name reuse); only a bare-list entry matches by name. `consumed(intent, name)` is bare-list only, `consumedDir(intent, dir)` attributed only, and `consumption(intent, {name, dir})` is the three-state answer `none | prerelease-only | stable` (a version whose part before `+` contains `-` is a prerelease) for the lane-graduation planner. `PendingChangesets.unconsumed(changesets, ledger, packages)` is the pure pending rule (`collect_pending_intents`, propagation.rs:327: any consumption, prerelease-only included, drops the key; a key resolving to no or several projects stays pending) and `laneConsumed` returns the prerelease-only set (`collect_lane_consumed_intents`, propagation.rs:349-358) that still counts toward the stable bump at graduation. The pnpm planner builds its own per-directory consumption index (it must fail an ambiguous bare-list entry, which these helpers leave pending), so neither helper is on the planning path.
- `PreState.ts`: `.changeset/pre.json` as `Option<PreState>`. Read-only: never migrate an older-layout file the way `@changesets/pre` does.
- `ChangesetConfig.ts`: the decoded config and `read`. `changelog` (`false | string | [string, unknown]`, kept as written) and `snapshot` (`{ useCalculatedVersion, prereleaseTemplate? }`) are modelled; keys it does not model are kept on `extra`. `read` also accepts the two shapes `@changesets/config` admits that the class schema alone rejects: the boolean `privatePackages` and an array `snapshot` (read as `{}`). `__test__/ChangesetConfig.test.ts` holds the two keys to tables copied from `@changesets/config` 4.0.1's `validateConfig`.
- `ReleasePlan.ts`: `assemble` (pure, returns `Result`), `read`, `readWithContext` (the plan plus the `root`, every discovered package and the config, as a `ReleaseContext`, so a caller hands `edits` and `Changelog.entry` exactly what was planned) and `PlannedRelease`, whose `changesets` are changeset ids as the oracle lists them. Both reads share one private `readContext`, which climbs from the given directory to the workspace root (discovery's `listPackagesIn`, or the nearest `package.json` for a lone package), as `@manypkg/find-root` does. The plan also carries the `changesets` it was made from (consumed ones left out in pre mode) and its `preState`, so a consumer never re-derives the consumed rule. Its class TSDoc lists the rules. `assemble` mirrors `@changesets/assemble-release-plan`'s fixpoint loop (ripple dependents, hold `fixed`, keep `linked`, repeat) over mutable drafts; a typed failure inside the loop throws a private `Halt` that `assemble` turns back into a `Result`.
- **The pnpm planner:** `assemble` takes `manager?: ReleaseManager` (default `"changesets"`); `read` passes `ReleaseManager.detect`'s answer. `manager: "pnpm"` hands everything to `src/internal/pnpmPlan.ts`, a port of pnpm 12.20.0's `assemble_release_plan` (`.repos/pnpm/pnpm/crates/versioning/src/plan.rs` and `plan/*`), whose module header lists every rule with its file and line. It reads `versioning?: VersioningConfig`, `ledger?: Ledger`, `currentVersions?: ReadonlyMap<dir, version>` (the registry seam: absent means no probe; given, a public release of the first plan whose manifest version the map does not confirm debuts at it, and the plan is made again, as `pnpm version -r` does) and `enforceWorkspaceProtocol?` (off is `pnpm change status`, on is `pnpm version -r`); it never reads `config` or `pre`, and `.changeset/pre/` files are not intents. The plan is keyed by **directory**: `PlannedRelease.dir` (pnpm's spelling, `""` for the root) is set only here, so two same-named projects each get a release; a `./dir` key names one, a BARE name two projects publish is `AmbiguousPackageError`, and two of them releasing one `name@version` is `VersioningError` `duplicateRelease`. `PlannedRelease.causes` is pnpm's (sorted `dependencies < epic < fixed < intent`); `type` is pnpm's bump, so a first release reports its intent's bump with `newVersion === oldVersion`; `changesets` are the intents the release consumes (pending, plus lane-consumed ones when it graduates), which is what pnpm writes to the ledger. Every other pnpm refusal is `VersioningError { reason, … }` with a `code` getter giving pnpm's `ERR_PNPM_*`. `read` in pnpm mode plans every discovered project, the root included, reads `versioning` through `PnpmSettings` and the ledger through `Ledger.read`, and tolerates a missing `config.json` (the defaults). Changesets mode rejects `./` keys and fills `causes` from its own paths (`intent`, `dependencies`, `fixed`).
- `BreakingFloors.ts`: `BreakingFloor`, `FloorCause` and the pure computation behind `ReleasePlan.breakingFloors`: each release that stays on its own caret line while a `peerDependencies` range it publishes stops admitting a dependency's version on the old line. There is no oracle: `@changesets/assemble-release-plan` bumps every dependent `patch`, which is the defect this reports (effected#1333). Peers only: a regular dependency nests privately and strands no consumer. It reports one hop; raising and re-planning to a fixpoint is the caller's job (`lib/scripts/breaking-floors.ts`).
- `ReleaseEdits.ts`: `ReleaseEdits`, `ManifestEdit`, `RangeEdit`, `ChangesetMove`, and the pure computation behind `ReleasePlan.edits`: what `changeset version` writes (manifest versions and ranges, changesets deleted or moved, the `pre.json` left), as data. CHANGELOG output is not part of it.
- `internal/versions.ts`: the version, range and glob helpers `ReleasePlan` and `ReleaseEdits` share, each read as node-semver reads it.
- `Changelog.ts`: `Changelog.entry` (an `Effect` of the block for one release, `Option.none()` for a `none` entry) and `Changelog.insert` (pure: puts the block in a `CHANGELOG.md`'s text), plus the `ChangelogFunctions` contract. Its data shapes (`VersionType`, `NewChangeset`, `NewChangesetWithCommit`, `ComprehensiveRelease`, `PackageJSON`, `ModCompWithPackage`) are `Schema.Struct`s exported with a same-name `typeof X.Type`, so a caller can decode what a module is handed; the function types are plain aliases over them. Every field is a `mutableKey` and every array `mutable`: a `ReadonlyArray` breaks assignability to `@changesets/types`' `string[]`, which the type test's readonly control pins. `PackageJSON` is open (a `Record(String, Unknown)` rest keeps unknown keys); `ModCompWithPackage` cannot be, since theirs are interfaces, but it models the `relativeDir` `apply-release-plan` passes undeclared. They are Structs rather than Classes because the contract is structural and modules receive plain objects. `__test__/Changelog.types.test.ts` checks mutual assignability with `@changesets/types` 7.0.0 and `Record<string, unknown>` assignability, with controls; `__test__/Changelog.schema.test.ts` round-trips values captured from a real run (`fixtures/changelog-contract.json`). The package takes a `ChangelogFunctions` value, never a module id: resolving and importing the module, finding each changeset's commit and formatting the result are the caller's jobs. `ChangelogError` lives here.
- `internal/causeMessage.ts`: the kit's guarded cause-message read, copied verbatim from `@effected/store`.
- `errors.ts`: `ChangesetParseError`, `ChangesetConfigError`, `UnknownPackageError`, `AmbiguousPackageError`, `SnapshotPreModeError`, `SnapshotTemplateError`, `MissingPackageError`, `LedgerError`, `VersioningError` (reasons `maxBumpExceeded`, `unreleasablePackage`, `epicOutOfBand`, `epicUnknownLead`, `epicOverlap`, `epicFixedGroupConflict`, `conflictingConfig`, `duplicateRelease`, `ambiguousPackage`, `ambiguousLedgerEntry`, `internalRange`, mirroring `crates/versioning/src/error.rs`; a lane named `main` is refused earlier by `VersioningConfig`).
- `ChangesetLint.ts` (behind `src/lint.ts`, the `./lint` entry): style-neutral front-matter rules as `LintRule`s, `CF001` to `CF004`, over `src/internal/frontMatter.ts`, which reads a front matter the way `@changesets/parse` does. `ChangesetLint.defaults` is `CF001`–`CF003`; `knownPackages(names)` builds `CF004`; `lint(source, { rules?, packages?, defaults?, ...parse })` runs the defaults, then `CF004` when `packages` is given, then the caller's rules.

## The oracle rule

`@changesets/get-release-plan` is a devDependency and **the authority on what a plan is**. It must never reach `dependencies` or `peerDependencies`. `__test__/ReleasePlan.oracle.test.ts` runs both over the pnpm workspaces in `__test__/fixtures/` and requires the same `{ name, type, oldVersion, newVersion }`. When they disagree, the planner is wrong until shown otherwise: fix `assemble` and record the rule in `ReleasePlan`'s TSDoc.

The oracle's rules are not the obvious ones. These have each been written wrong once:

- A dependent always bumps `patch`. `updateInternalDependencies` does not set the bump.
- `privatePackages.version` defaults to `false`.
- `ignore` entries are globs, with `!` negation applied in order.
- A skipped package is still listed `none` when it depends on anything in the plan, and a `none` entry bumps nothing.
- A bump from a prerelease follows `semver.inc`, not `SemVerBump`: a `major` of `2.0.0-rc.1` is `2.0.0`.
- A fixed or linked member's `oldVersion` is the **group's** highest current version, not its own, and a skipped fixed member's version still counts.
- A ripple can pull a group along, whose new member ripples again: the loop must repeat until nothing changes (`fixed-ripple` pins it).
- In pre mode a dependent's range is checked against the prerelease version, which no plain range admits.

The test's expected `name -> type` table is what stops a fixture agreeing with the planner about nothing. A new fixture's table is copied from the oracle's answer, never written by hand. **Never run the oracle on `pre-legacy-layout` in place**: it moves the fixture's files. Every fixture's purpose is in `__test__/fixtures/README.md`. The oracle climbs past a root with no package patterns, so `single-package` is compared from a temporary copy outside this repository.

### The pnpm oracle

**pnpm 12.20.0 is the authority on a pnpm-native plan.** `__test__/fixtures/pnpm-native/` holds pnpm's own recorded answers (applied runs on throwaway copies; see its README, and `scripts/record-pnpm-oracle.ts` to re-record). `__test__/ReleasePlan.pnpm.oracle.test.ts` plans each case and requires pnpm's `{name, currentVersion, newVersion, bump, causes}`, pnpm's ledger afterwards, and for a rejected case a `VersioningError` with pnpm's code. A case's `prelude.json` is replayed on the model through `__test__/support/pnpmOracle.ts` (`version -r` is our own plan, applied; `lane main` drops the lane), so the lane cases also check the prelude plans against the ledger pnpm wrote. That loader decodes every recorded file with a schema. `ReleasePlan.pnpm.engine.test.ts` ports pnpm's own engine tests (`plan/tests/{dependencies,behavior}.rs`) case for case; `ReleasePlan.pnpm.rules.test.ts` covers the remaining refusals and edges, each citing its source line; `ReleasePlan.pnpm.read.test.ts` runs `read` over memfs on every prelude-free case. When pnpm and the planner disagree, the planner is wrong: fix `internal/pnpmPlan.ts` and cite the Rust line. Rules that have each been read wrong once:

- Graduation needs the intent on disk, recorded only under a prerelease key; returning to `main` with nothing lane-consumed plans nothing.
- Only `workspace:` specs constrain: a plain range never ripples, a 1.x minor stays inside `workspace:^`, a major leaves it, a lane prerelease leaves it, and devDependencies never ripple.
- `private` does not exclude a project from planning; it only skips the registry probe.
- A first release keeps its manifest version but reports the intent's bump.

### The edits oracle

`@changesets/apply-release-plan` is the authority on `ReleasePlan.edits`. `__test__/ReleaseEdits.oracle.test.ts` copies each fixture to a temporary directory with `changelog: false`, computes our edits, runs the oracle's `changeset version` there (its reads, `assembleReleasePlan`, `applyReleasePlan`), and requires the tree it leaves to equal the original tree with our edits applied: every manifest, every changeset file and `pre.json`. Snapshot and pre-mode cases are included. `range-edits` and `range-edits-gated` pin the range-rewriting rules. Three things are easy to get wrong here:

- `@effected/semver`'s `Range` is normalised: it sorts comparators and keeps the `>=0.0.0` that `*` desugars to. node-semver keeps the written order and drops `>=0.0.0`, so `ReleaseEdits.ts` reads the two-comparator rule from `Range.writtenSetsResult` (node-semver's `Range#set`) and the match-any rule from `Range.isAny`. Never read either rule off a parsed `Range`'s `sets`.
- Pre mode consumes a changeset by **moving** its file to `.changeset/pre/` (`moveChangesets`), the directory `PendingChangesets` reads back as `pre/<file>`. `pre.json` is left unchanged and lists no ids: never look for consumed ids there.
- `workspace:^`, `workspace:~`, `workspace:*` and `workspace:` paths are never rewritten, and neither is a package outside the plan, even one whose range the release leaves.

`__test__/Changelog.oracle.test.ts` holds `Changelog` to the `CHANGELOG.md` files the same oracle writes, with `@changesets/changelog-git` as the module, `format: false`, and each copy made a git repository with one commit per changeset, because the oracle asks git for the commit that added each one. Our side is given the same commits through `options.commits`. It covers existing files, a file with no version heading, an empty one, and a dependent bumped only through its dependency. The echo module also prints each dependency's `packageJson`, which is the whole manifest (`WorkspacePackage.manifestRecord`); `changelog-gates`' `a` carries keys the typed fields do not model, to prove it. `Changelog`'s one ruled difference: a changeset with no commit has no `commit` key, where the oracle sets it to `undefined`.

Ruled differences:

- An edit writing the value already there is left out, and so is a manifest with nothing to change. The oracle rewrites them; the files end the same.
- Every consumed changeset is named, where the oracle deletes only files it finds.
- `changeset version --snapshot ""` plans no snapshot but keeps an `exit`-mode `pre.json`, because `apply-release-plan` deletes it only when the snapshot is `null`; no plan here holds that state, so a caller reproducing it keeps the file.
- A `ChangesetMove` needs `.changeset/pre/` to exist: the caller creates it, as the oracle's `mkdir -p` does.
- `Changelog.entry` never reads `config.changelog`. A caller whose config says `changelog: false` writes no changelog and does not call it. An older-layout `pre.json`'s listed changeset is named as the plan names it, and that `pre.json` is not migrated.

## Documented divergences

These are deliberate, and each is ruled or stated in TSDoc. Do not "fix" one without a new ruling.

**Refused where the oracle plans:**

- A root listed in `packages:` alongside other packages, for example `[".", "packages/*"]`: a changeset naming it gets `UnknownPackageError`.
- An array `privatePackages`: `ChangesetConfigError`. The oracle admits it as `{}` only through valibot's `object` accepting arrays, and it means nothing.

**Planned where the oracle refuses:**

- A changeset mixing skipped and released packages.
- A public package depending on a skipped one.
- `privatePackages` with `tag` on and `version` off.
- `packages: []` and patterns matching nothing plan the root, because discovery cannot tell `packages: []` from an absent key.
- A `changelog` pair whose options are not an object, such as `["x", 5]` or `["x", "s"]`: `ChangelogPair` is `[String, Unknown]`, so it decodes, where `@changesets/config` rejects it. Validating the options is the generator's concern.

**Answered differently:**

- A `changelog` pair of `["x", []]` decodes as written, `["x", []]`; the oracle gives `["x", {}]`.
- A version-less package is left out of the plan. The oracle lists it with no versions, and `PlannedRelease` requires them.
- A catalog-only root nested in another workspace answers for itself. The oracle climbs to the enclosing workspace.
- A version-less member of a fixed or linked group is passed over for the group's highest version and pre-release number; the oracle crashes on it.
- A non-numeric prerelease number (`1.0.0-next.x`) in pre mode fails `InvalidVersionError`; the oracle throws an internal error.
- An older-layout `pre.json` listing consumed ids: planned as the oracle's settled (second-run) answer, versions, types and changeset ids alike, so in exit mode a consumed one is named `pre/<file>` though nothing moved it. The oracle's first run counts them in pre mode, because it moves the files after reading them.
- A version changesets cannot bump (`=1.2.0`: npm's loose parse reads it, strict `semver.inc` does not) fails `InvalidVersionError` wherever the planner reads it; the oracle crashes in pre mode or a group, and plans a bump of it with a `null` new version. A leading `v` is normalised exactly as node-semver does, never treated as a divergence.
- A `pre.json` with no `tag` or an unknown `mode` fails `ChangesetConfigError`; the oracle plans `-undefined.0` suffixes and treats any non-`exit` mode as `pre`.
- A Ruby-style `~>` range (`~>1.0.0`) is not a range here, because `@effected/semver` rejects it: it never ripples (the oracle bumps the dependent once it is left) and `edits` never rewrites it (the oracle writes it as `~`).
- `ignore`, `fixed` and `linked` globs run on `@effected/glob`, not picomatch: `(a|b)`, `!(a)` and `x/**` matching `x` differ, nothing a package name needs.

**Snapshots** (`ReleasePlan.assemble`'s and `read`'s `snapshot` input) have their own oracle, `@changesets/assemble-release-plan`'s fifth argument, which `getReleasePlan` never passes. `__test__/ReleasePlan.snapshot.test.ts` runs `getReleasePlan`'s reads from the copies it resolves, then `assembleReleasePlan` with the snapshot and the clock faked to the input `timestamp`. Ruled differences:

- Pre mode fails `SnapshotPreModeError`. The oracle plans one; the refusal is `changeset version`'s.
- An empty `tag` or `commit` is no value. `changeset version` never passes `""` (an empty `--snapshot` plans no snapshot), but the oracle called directly fills `{tag}` with nothing, refuses a template without `{tag}`, and plans plain versions when the whole suffix comes out empty. Here a template using the empty value fails `missingValue`, one without `{tag}` plans, and the suffix is never empty.

## Lint rules

**This package ships no house style.** `CF001`–`CF004` hold only what the changesets tool itself refuses a file for, so they are right under any style: the front matter is present, is YAML, and is a mapping when not empty (`CF001`, `changeset-front-matter`); every key names a package (`CF002`, `changeset-package-name`); every value is a release type (`CF003`, `changeset-release-type`); and, only when the workspace's names are given, every key is one of them (`CF004`, `changeset-known-package`). `CF` is this package's own scheme, for changeset front matter.

**`@changesets/parse` is the oracle**, loaded in `__test__/ChangesetLint.test.ts` from beside `@changesets/read`, as `get-release-plan` resolves it. A file it parses must fail no default rule, and a file it refuses must fail one. The test checks both directions over its corpus and every golden-corpus input, through both hosts (markdownlint is loaded by path from `@effected/markdown-lint`; this package takes no markdownlint dependency). Its rules are looser than they look, and a "fix" toward a stricter reading breaks the oracle check:

- The fence pattern is upstream's unanchored `mdRegex`: leading whitespace, and even text before the block, are accepted.
- A falsy block value (`---\n---`, `false`, `null`, `0`) has no entries and is legal; an empty summary is legal. `changeset add --empty` writes both.
- A key is a package name when it is not blank. An npm-name check would refuse files changesets accepts.

`CF002`–`CF004` read only a front matter `CF001` accepts, so a broken block is reported once. `CF004` is the one default that can fail a file the oracle parses: it looks past the file, at the workspace.

**savvy-web's CSH001–CSH005 are not here.** They are savvy-web's house style, and savvy-web owns them. `packages/markdown-lint` keeps its golden corpus and its test-only copies as an engine-fidelity corpus; no kit package provides those rules.

## Sync forms

`ChangesetFile.parseSync`, `PendingChangesets.readSync`, `PendingChangesets.readSettledSync`, `ReleasePlan.assemble` and `ChangesetLint.lint` run with no Effect runtime. `readSync` uses `node:fs`, and `assemble` imports `posix` from `node:path` to compare `workspace:` paths the way the oracle does, so the root entry is Node-only. There is no synchronous `ChangesetConfig.read`, `PreState.read` or `ReleasePlan.read`.

## Consumers

`lib/scripts/breaking-floors.ts` reads `WorkspaceDiscovery.listPackagesIn`, `ChangesetConfig.read`, `PendingChangesets.read` and `PreState.read` itself, so its own floor files leave before any plan is made, then calls `assemble` and `breakingFloors`, behind `pnpm changeset:floors` and inside `catalog:sync` / `catalog:check`. `lib/scripts/catalog-sync.ts` calls `ReleasePlan.read` as the default behind its `StatusRunner` seam, so a change to `read` reaches `catalog:check` and `catalog:sync`. `@effected/bundler` is the first package consumer.

## Working here

```bash
pnpm exec vitest run --project @effected/changesets --coverage.enabled=false  # from the repo root
pnpm --filter @effected/changesets run types:check
pnpm build --filter @effected/changesets
```

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*`, never `expect`. In-memory tests use `@effected/memfs`. The oracle test runs over the real filesystem because the oracle does. Never run `pnpm install` inside a fixture.

The bundler's default config carries one narrow API Extractor suppression: `{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage symbols synthesized by inline class factories. Never widen it. `package.json` stays `"private": true`; the bundler emits the publishable manifest.
