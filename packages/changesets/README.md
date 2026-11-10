# @effected/changesets

[![npm](https://img.shields.io/npm/v/@effected%2Fchangesets?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/changesets)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Changeset files, `.changeset/config.json` and the release plan as Effect schemas and pure functions. Read what a repository's pending changesets release, including the packages bumped only because a dependency moved, without carrying the changesets packages at runtime.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `~4.1.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/changesets

Tools that need to know the next versions usually shell out to `changeset status --output`, or carry `@changesets/get-release-plan` at runtime. This package answers the same question as typed values: every failure is a tagged error, and the planner is a pure function you can call with packages you already have.

It reads, plans and computes; it never writes. What `changeset version` would write (each manifest's new version and ranges, the changesets it consumes, the `pre.json` it leaves, the CHANGELOG text) comes back as data, and your program does the IO. Nothing here publishes.

The answers are held to the original. `@changesets/get-release-plan`, `@changesets/assemble-release-plan`, `@changesets/apply-release-plan` and `@changesets/changelog-git` are test-only dependencies, and the test suite requires the same answer from both over a set of small pnpm workspaces, down to the files `changeset version` writes. The cases where this package deliberately differs are listed under [Differences from changesets](#differences-from-changesets).

## Install

```bash
npm install @effected/changesets effect
```

```bash
pnpm add @effected/changesets effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency.

The changeset front-matter lint rules ship from `@effected/changesets/lint`, which also needs `@effected/markdown` and `@effected/markdown-lint`. Both are optional peers: install them only if you import that entry point. The root entry never loads them.

```bash
pnpm add @effected/markdown @effected/markdown-lint
```

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

`ReleasePlan.read` discovers the workspace's packages, reads the config and the pending changesets, and plans the release. It requires `FileSystem`, `Path` and `WorkspaceDiscovery`, which you provide at the edge of your program:

```ts
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { ReleasePlan } from "@effected/changesets";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";

const root = process.cwd();

const AppLayer = WorkspaceDiscovery.layer({ cwd: root }).pipe(
  Layer.provide(WorkspaceRoot.layer),
  Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
);

const program = Effect.gen(function* () {
  const plan = yield* ReleasePlan.read(root);
  for (const release of plan.releases) {
    yield* Effect.log(`${release.name}: ${release.oldVersion} -> ${release.newVersion} (${release.type})`);
  }
}).pipe(Effect.provide(AppLayer));

Effect.runPromise(program);
```

A `none` entry is a package listed in the plan whose version does not move. Skip it if you only want what publishes. `plan.changesets` holds the changesets the plan was made from, and `plan.preState` the pre-release state, when there is one.

## Apply a release

`ReleasePlan.edits(plan, { packages, config })` returns what `changeset version` writes, as a `Result`: each `package.json`'s new `version` and rewritten ranges, the changesets to delete (or, in pre mode, to move under `.changeset/pre/`), and the `pre.json` the release leaves. Pass every package `WorkspaceDiscovery.listPackagesIn` lists, the root included.

`Changelog.entry(plan, release, functions, { packages, config })` renders a release's CHANGELOG block from a changelog module you load yourself, and `Changelog.insert(existing, block, name)` puts it in the file's text. `ChangelogFunctions` and its parameter types have the same structure as `@changesets/types`', so one changelog module loads under `@changesets/cli` and here.

For `changeset version --snapshot`, pass `snapshot: { tag?, commit?, timestamp }` to `ReleasePlan.read(root, { snapshot })` or `ReleasePlan.assemble`.

## Lint changesets

`ChangesetLint` holds lint rules that hold under any house style: only what the changesets tool itself refuses a file for. `CF001` checks for a front matter block that is YAML and, when not empty, a mapping; `CF002`, for a package name in every key; `CF003`, for a release type in every value; and `CF004`, given the workspace's package names, that each named package exists. Run the defaults in markdownlint-cli2, beside your own style's rules:

```js
// .markdownlint-cli2.mjs
import { MarkdownlintAdapter } from "@effected/markdown-lint";
import { ChangesetLint } from "@effected/changesets/lint";

export default { customRules: MarkdownlintAdapter.rules(ChangesetLint.defaults) };
```

Or lint a file's text directly, with no Effect runtime:

```ts
import { ChangesetLint } from "@effected/changesets/lint";

const findings = ChangesetLint.lint(text, { packages: ["@my/pkg"], rules: houseRules });
```

The defaults agree with `@changesets/parse`: a file it parses fails none of them, and a file it refuses fails one. A section-heading or summary style is not included; bring your own as `rules`.

## What's in the box

- `ChangesetFile`: `parseSync` and `parse` for one changeset's text, to a `ParsedChangeset` of releases and summary.
- `PendingChangesets`: `read` and `readSync` for the changesets under `.changeset/`, sorted by file name, then those a pre-release consumed under `.changeset/pre/`, to `PendingChangeset` values.
- `PreState`: `read` decodes `.changeset/pre.json` to an `Option`, empty outside pre-release mode. It never rewrites the file.
- `ChangesetConfig`: `read` decodes `.changeset/config.json`, `changelog` and `snapshot` included. Keys it does not model stay on `extra`.
- `ReleasePlan`: `read` as above, and `assemble` to plan from packages, changesets, a config and an optional `PreState` you already hold, returning a `Result` with no IO. Both take an optional snapshot. A plan holds `releases`, the `changesets` it was made from (in pre mode, less those a pre-release consumed), its `preState` when there is one, and whether it is a snapshot. `edits` turns a plan into `ReleaseEdits`.
- `ReleaseEdits`, `ManifestEdit`, `RangeEdit` and `ChangesetMove`: what `changeset version` writes, as data.
- `Changelog`: `entry` and `insert`, over a `ChangelogFunctions` module.
- `PlannedRelease`: one package's `name`, `type`, `oldVersion`, `newVersion` and contributing `changesets`.
- `BumpType`: the `patch | minor | major` schema, and `ReleaseType`, which adds `none`.
- `ChangesetLint` (from `@effected/changesets/lint`): the style-neutral front-matter rules, as above.
- Errors: `ChangesetParseError`, `ChangesetConfigError`, `UnknownPackageError`, `SnapshotPreModeError`, `SnapshotTemplateError`, `MissingPackageError`, `ChangelogError`.

## Rules worth knowing

The plan follows changesets, and some of its rules surprise people:

- A package reached as a dependent always bumps `patch`. `updateInternalDependencies` does not change that.
- A private package releases only if `privatePackages.version` is on, and it defaults to off.
- Entries in `ignore` are globs, with `!` negation applied in order.
- `catalog:`, `link:`, `npm:` and a range the dependency has already left draw no dependency edge, so they never ripple.
- A package reached only through `devDependencies` is listed as `none`.
- A bump completes a prerelease it is heading for: a `major` of `2.0.0-rc.1` is `2.0.0`.
- In a repository whose only package is the root, the root is the package.
- A changeset may name a package `none`: it is listed, and moves nothing unless something else bumps it.
- A `fixed` group with any member releasing releases every member, at the group's highest bump, from the group's highest current version, which is the `oldVersion` each member reports. A `linked` group does the same for only the members that release.
- In pre-release mode each bumped version gains `-<tag>.<n>`, and the changesets under `.changeset/pre/` are left out, because an earlier pre-release consumed them. In exit mode they count again, and every package on a numbered prerelease bumps at least `patch`.
- A leading `v` on a version is dropped, as npm drops it: `v1.0.0` bumps to `1.0.1`.

## Differences from changesets

Refused here, planned by changesets:

- A changeset naming a root that `packages:` lists alongside other packages fails with `UnknownPackageError`.

Planned here, refused by changesets:

- A changeset mixing skipped and released packages.
- A public package depending on a skipped one.
- `privatePackages` with `tag` on and `version` off.
- A `pnpm-workspace.yaml` with `packages: []` or patterns matching nothing, which plan the root.

Answered differently:

- A version-less package is left out of the plan rather than listed with no versions.
- A root with a catalog-only `pnpm-workspace.yaml` answers for itself, where changesets climbs to any enclosing workspace.
- A version changesets cannot bump, such as `=1.2.0` (npm's loose parse reads it, but changesets bumps with strict `semver.inc`), and a `pre.json` with no `tag` or an unknown `mode`, fail with a typed error. changesets crashes or plans nonsense versions for them.
- An older `pre.json` that lists consumed changesets by id is planned as changesets settles on after moving those files, and nothing is written.
- A snapshot is refused in pre mode, as `changeset version` refuses it, and an empty snapshot tag or commit counts as none.
- A Ruby-style `~>` range is not read as a range: it never ripples and is never rewritten.
- `ReleaseEdits` leaves out an edit that would write the value already there; the files end up the same.
- A changelog module's `packageJson` holds the fields this package reads from a manifest, not the whole file.

## License

MIT
