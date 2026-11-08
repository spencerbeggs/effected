# @effected/changesets

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Nothing here writes a changeset, versions a package or publishes one.

**Tier: boundary.** The parsers and the planner are pure; reading a repository requires core's `FileSystem` and `Path` in `R`, plus `WorkspaceDiscovery` for `ReleasePlan.read`. Runtime deps are `@effected/yaml` (front matter), `@effected/semver` (ranges and bumps), `@effected/glob` (`ignore` and group patterns) and `@effected/workspaces` (packages and dependency edges). The `./lint` subpath adds `@effected/markdown` and `@effected/markdown-lint` as **optional peers**: a consumer hands our `LintRule` instances to its own `MarkdownLint`, so they share one copy. **The root must never import either**, directly or transitively; `entrypoints.test.ts` walks the root's imports to hold that.

**For the full design:** → `@./okf/modules/changesets.md`

Load when changing the public API, the package's dependency edges, or who consumes the plan.

## Module layout

- `BumpType.ts`: `BumpType` is `patch | minor | major`, and `ReleaseType` adds `none`, which a changeset may write: it names the package and moves no version.
- `ChangesetFile.ts`: `parseSync` and `parse` for one file, to `ParsedChangeset`.
- `PendingChangesets.ts`: `read` and `readSync` for `.changeset/`, then `.changeset/pre/` as `pre/<name>.md`, to `PendingChangeset`.
- `PreState.ts`: `.changeset/pre.json` as `Option<PreState>`. Read-only: never migrate an older-layout file the way `@changesets/pre` does.
- `ChangesetConfig.ts`: the decoded config and `read`. Keys it does not model are kept on `extra`. `read` also accepts the boolean form of `privatePackages`, which the class schema alone rejects.
- `ReleasePlan.ts`: `assemble` (pure, returns `Result`), `read` and `PlannedRelease`. The plan also carries the `changesets` it was made from (consumed ones left out in pre mode) and its `preState`, so a consumer never re-derives the consumed rule. Its class TSDoc lists the rules. `assemble` mirrors `@changesets/assemble-release-plan`'s fixpoint loop (ripple dependents, hold `fixed`, keep `linked`, repeat) over mutable drafts; a typed failure inside the loop throws a private `Halt` that `assemble` turns back into a `Result`.
- `errors.ts`: `ChangesetParseError`, `ChangesetConfigError`, `UnknownPackageError`.
- `ChangesetLint.ts` (behind `src/lint.ts`, the `./lint` entry): CSH001 to CSH005 as `LintRule`s, ported from savvy-web/systems into `src/internal/lint/`. Their message strings are systems' verbatim; never reword one, or agreement with the golden corpus breaks.

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

## Documented divergences

These are deliberate, and each is ruled or stated in TSDoc. Do not "fix" one without a new ruling.

**Refused where the oracle plans:**

- A root listed in `packages:` alongside other packages, for example `[".", "packages/*"]`: a changeset naming it gets `UnknownPackageError`.

**Planned where the oracle refuses:**

- A changeset mixing skipped and released packages.
- A public package depending on a skipped one.
- `privatePackages` with `tag` on and `version` off.
- `packages: []` and patterns matching nothing plan the root, because discovery cannot tell `packages: []` from an absent key.

**Answered differently:**

- A version-less package is left out of the plan. The oracle lists it with no versions, and `PlannedRelease` requires them.
- A catalog-only root nested in another workspace answers for itself. The oracle climbs to the enclosing workspace.
- A version-less member of a fixed or linked group is passed over for the group's highest version and pre-release number; the oracle crashes on it.
- A non-numeric prerelease number (`1.0.0-next.x`) in pre mode fails `InvalidVersionError`; the oracle throws an internal error.
- An older-layout `pre.json` listing consumed ids: planned as the oracle's settled (second-run) answer, versions, types and changeset ids alike, so in exit mode a consumed one is named `pre/<file>` though nothing moved it. The oracle's first run counts them in pre mode, because it moves the files after reading them.
- A version changesets cannot bump (`=1.2.0`: npm's loose parse reads it, strict `semver.inc` does not) fails `InvalidVersionError` wherever the planner reads it; the oracle crashes in pre mode or a group, and plans a bump of it with a `null` new version. A leading `v` is normalised exactly as node-semver does, never treated as a divergence.
- A `pre.json` with no `tag` or an unknown `mode` fails `ChangesetConfigError`; the oracle plans `-undefined.0` suffixes and treats any non-`exit` mode as `pre`.
- `ignore`, `fixed` and `linked` globs run on `@effected/glob`, not picomatch: `(a|b)`, `!(a)` and `x/**` matching `x` differ, nothing a package name needs.

**Not planned:** snapshot versions. `getReleasePlan` takes no snapshot input, so there is no oracle for them, and a snapshot is a `changeset version` flag, not repository state.

## Lint rules

**systems' markdownlint engine is authoritative** — it is what markdownlint-cli2 and the pre-commit hook run, and the golden corpus came from it. The rules read the parsed tree the way that engine reads micromark tokens: top-level blocks only, heading and cell text as written (escapes resolved, formatting kept), fenced code only, an item empty unless it holds a paragraph, a short row's padding uncounted, a setext heading under a definition anchored on the definition's line, and details on one line. Where its verdict looks wrong (``## `Features` `` is an unknown section), match it and say so in TSDoc; never "fix" one toward systems' programmatic engine. The one remaining difference is markdownlint's parser (a bare `-` after indented code reads as a paragraph), pinned as R8.

`__test__/ChangesetLint.test.ts` pins each class (R1–R10) through both hosts, and holds the rules to `packages/markdown-lint/__test__/fixtures/changesets/golden.json`, read in place: equal to systems' markdownlint engine on all 113 inputs, to its programmatic engine on the 102 where systems' two engines agree (the 11 others are CSH005, and the port follows markdownlint), and the same through `MarkdownlintAdapter` in the markdownlint `@effected/markdown-lint` pins (loaded by path from that package; this one takes no markdownlint dependency). The rules also live as test-only copies in `packages/markdown-lint/__test__/rules/`; that package cannot import them from here without a dependency cycle.

## Sync forms

`ChangesetFile.parseSync`, `PendingChangesets.readSync`, `ReleasePlan.assemble` and `ChangesetLint.lint` run with no Effect runtime. `readSync` uses `node:fs`, and `assemble` imports `posix` from `node:path` to compare `workspace:` paths the way the oracle does, so the root entry is Node-only. There is no synchronous `ChangesetConfig.read`, `PreState.read` or `ReleasePlan.read`.

## Consumers

`lib/scripts/catalog-sync.ts` calls `ReleasePlan.read` as the default behind its `StatusRunner` seam, so a change to `read` reaches `catalog:check` and `catalog:sync`. `@effected/bundler` is the first package consumer.

## Working here

```bash
pnpm exec vitest run --project @effected/changesets --coverage.enabled=false  # from the repo root
pnpm --filter @effected/changesets run types:check
pnpm build --filter @effected/changesets
```

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*`, never `expect`. In-memory tests use `@effected/memfs`. The oracle test runs over the real filesystem because the oracle does. Never run `pnpm install` inside a fixture.

The bundler's default config carries one narrow API Extractor suppression: `{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage symbols synthesized by inline class factories. Never widen it. `package.json` stays `"private": true`; the bundler emits the publishable manifest.
