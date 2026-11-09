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
is committed here; the new cases' tables were taken from the oracle's own answer
on each fixture, never written by hand. The expected `name -> type` table in the test pins only that the
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
| `explicit-none` | A changeset naming a package `none` lists it beside another file's real bump, and moves nothing. |
| `explicit-none-loses-to-bump` | `none` and a real bump for one package: the bump wins. |
| `explicit-none-rippled` | A dependency's ripple upgrades a package named `none`. |
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
| `fixed-group` | A fixed group releases every member at its highest bump from its highest version; a dependent of a member ripples from the group's version. |
| `fixed-glob` | Fixed group entries are globs, with `!` negation. |
| `fixed-ripple` | A ripple into one member pulls the group along, and the pulled member's own dependent then ripples: the loop repeats. |
| `fixed-skipped-member` | A skipped member never releases, but its version still sets the group's highest. |
| `fixed-duplicate` | A package in two fixed groups is rejected by both. |
| `linked-group` | Only the linked members that release move, from the highest version of the whole group, a non-releasing member's included. |
| `linked-ripple` | A rippled dependent in a linked group takes the group's bump. |
| `linked-none` | A `none` entry in a linked group stays `none`. |
| `pre-mode` | Pre mode appends `-<tag>.<n>`, drops the changesets under `.changeset/pre/`, and a dependent's range is checked against the prerelease version. |
| `pre-exit` | Exit mode counts consumed changesets again and completes every numbered prerelease. |
| `pre-groups` | In pre mode a fixed or linked group shares its highest pre-release number. |
| `pre-legacy-layout` | An older `pre.json` listing consumed ids. The oracle moves those files as it reads, so the test runs it twice on a temporary copy and compares with the second, settled plan. Never run the oracle on this fixture in place. |
| `range-edits` | For `ReleaseEdits.oracle.test.ts`: every range form a minor rewrites (`^`, `~`, two-comparator bounds in both orders and past the upper bound, `1.x`, `*`, `||`, exact, hyphen, `>`, a `v` range, each `workspace:` form, peer, dev, optional, `catalog:`, several kinds in one manifest, the root's own ranges), `<=`, and a held package outside the plan that is not rewritten. |
| `range-edits-gated` | `updateInternalDependencies: minor` holding a patch's in-range rewrites back, and `onlyUpdatePeerDependentsWhenOutOfRange` holding a peer range while one out of range is rewritten. |
| `range-edits-peer` | `updateInternalDependencies: minor` holds a patch's in-range dependency, but an in-range peer is still rewritten while `onlyUpdatePeerDependentsWhenOutOfRange` is off. |
| `range-edits-peer-held` | `onlyUpdatePeerDependentsWhenOutOfRange` on holds an in-range peer even when the bump meets the minimum, while a dependency is rewritten. |
| `range-edits-protocol-only` | `bumpVersionsWithWorkspaceProtocolOnly` leaves a plain range alone and rewrites a `workspace:` range. |
| `changelog-gates` | For `Changelog.oracle.test.ts`, under `updateInternalDependencies: minor`: a `workspace:*` dependent of a patch still gets the dependency line, and a dependent whose `dependencies` range holds while its `peerDependencies` range is missed is read by `dependencies`, so it gets none. |
| `changelog-gates-pre` | The same minimum in pre mode: a `workspace:^` dependent is checked against the dependency's current version, which the prerelease leaves, so it gets the dependency line. |

## Captured values

`changelog-contract.json` is not hand-authored: it is the exact arguments `@changesets/apply-release-plan` 8.1.1 handed a capture changelog module while running `changeset version` over a git-repository copy of `minor-ripple-0x`, with only the copy's absolute directory replaced by `/repo`. Its `provenance` field says so. `Changelog.schema.test.ts` round-trips it through the contract's schemas.
