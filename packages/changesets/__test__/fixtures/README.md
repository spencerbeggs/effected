# Fixtures

`config.json` is a verbatim copy of this repository's own `.changeset/config.json`
(at the commit that introduced it here), used to prove `ChangesetConfig` decodes a
real-world file, including keys it does not model (`$schema`, `changelog`).

## Oracle workspaces

Every directory here is a small pnpm workspace, **hand-authored** for
`ReleasePlan.oracle.test.ts`: no tool generates them, because the point of each is
one rule a real repository only hits by accident. They are never installed; only
their `pnpm-workspace.yaml`, `package.json` files and `.changeset/` are read.

The test runs `getReleasePlan` from `@changesets/get-release-plan@5.0.2`
(`@changesets/assemble-release-plan@7.0.0`, `@changesets/config@4.0.1`) and
`ReleasePlan.read` over each one and requires the same answer, so no expected plan
is committed here. The expected `name -> type` table in the test pins only that the
fixture still reaches its rule. When the oracle's version moves and a case
disagrees, work out which of the two moved before changing either.

| Fixture | The property it pins |
| --- | --- |
| `single-patch` | An unnamed package with no edge to a release stays out of the plan. |
| `minor-ripple-0x` | A minor on `0.x` falls outside `workspace:^`, so the dependent bumps. |
| `minor-no-ripple-1x` | The same minor on `1.x` stays inside the caret, so it does not. |
| `workspace-star-pin` | `workspace:*` is the exact current version, so any bump ripples. |
| `dev-dependent-none` | A devDependency-only dependent is listed `none` and ripples nothing onward. |
| `ignored-package` | An ignored package named in a changeset does not release. |
| `private-no-version` | `privatePackages.version: false` holds a private package back. |
| `two-changesets-max` | The highest bump across changesets wins. |
| `private-default` | With no `privatePackages` key, a private package does not release. |
| `private-partial-object` | `privatePackages: {}` defaults `version` to `false` too. |
| `private-boolean` | The boolean form of `privatePackages` is accepted and sets `version`. |
| `update-internal-minor` | `updateInternalDependencies: minor` does not change a dependent's `patch`. |
| `ignored-glob` | `ignore` entries are globs, and `!` negation applies in order. |
| `ignored-dependent-none` | A skipped dependent is listed `none` even with its range satisfied, and passes that on. |
| `specifier-forms` | Which specifiers draw an edge: ranges, `workspace:` ranges and paths, `catalog:`, `link:`, `npm:`, `file:`. |
| `kinds` | Peer and optional ripple like dependencies; when two kinds name a dependency, the last decides the edge, a `file:` devDependency does not count, and each is checked. |
| `reader-skips` | A readme in any case, `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` under `.changeset/` are not changesets. |
| `version-less` | A version-less package is skipped; the oracle lists it with no versions and the plan leaves it out. |
| `workspace-protocol-only` | `bumpVersionsWithWorkspaceProtocolOnly` removes the plain range's edge. |
| `update-always` | `updateInternalDependents: always` ripples a satisfied range. |
| `prerelease-versions` | A bump from a prerelease version follows `semver.inc`. |
| `none-no-ripple-missed-range` | A `none` entry ripples nothing onward even when a dependent's range on it is unsatisfied. |
| `none-no-ripple-caret` | The same `none` entry with a plain `workspace:^` dependent. |
| `none-no-ripple-always` | The same, with `updateInternalDependents: always`. |
| `single-package` | The root is the only package, so it is planned. The test copies this fixture to a temporary directory, with and without its catalog-only `pnpm-workspace.yaml`, because inside this repository the oracle climbs to this repository's root. |
| `root-named-with-members` | A changeset naming the root is rejected while other packages exist. |
| `unknown-package` | A changeset naming a package outside the workspace is rejected by both. |
