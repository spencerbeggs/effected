---
type: Decision
title: Releases are changeset-driven and scope-agnostic
description: CI builds the changesets present on a branch and releases exactly the packages they name — a whole-kit wave and a single-package patch are the same mechanism, every package stays 0.x and unstable until the kit chooses 1.0.0, which stable Effect v4 makes possible rather than automatic, and breaking changes ride minors.
status: draft
tags:
  - release
sources:
  - id: root-claude-releases
    resource: ../../CLAUDE.md
  - id: schemastore-changelog
    resource: ../../packages/schemastore/CHANGELOG.md
  - id: github-actions-package
    resource: ../../packages/github-actions/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T17:24:58Z
  body_sha256: 5181bf0ec118d337d2ed83390d8f5c98294185a5ec17b0d99e5a97934acbb17e
---

# Releases are changeset-driven and scope-agnostic

## Context

The kit is thirty-one publishable packages built
together[^github-actions-package], but a release
does not have to touch all of them. Something had to decide, for any
given cut, which packages actually publish — a hand-maintained release
plan, a fixed cadence, or a mechanism that reads the same signal every
time.

## Decision

The release set is an output of the changeset mechanism, never a policy
choice made at release time. CI builds whatever changesets are present
on the branch and releases exactly the packages they name — the whole
kit when a catalog advance touches every package, or one package when a
single patch is the only thing pending.[^root-claude-releases] Both
shapes are ordinary: a near-whole-kit wave behind a catalog advance and
a lone patch release are the same mechanism producing different sets.
A package may release entirely on its own, and `@effected/pnpm-plugin-effect`
publishes with the kit rather than apart from it, because its own
catalog literal is itself one of the artifacts a release keeps
current — see [the catalog holds next-release versions](catalog-holds-next-release-versions.md).

Version and stability are kept as separate axes. Every package stays
below `1.0.0` until the kit chooses to graduate. Effect v4's stable
release makes that possible, not automatic: the kit builds on `^4.0.0`
(see [the effect catalog takes caret ranges on the stable
line](effect-catalog-tracks-stable-minor.md)) and still ships `0.x`.
Independently, every package carries the same `unstable` status
regardless of version number, so consumers are expected to pin the kit's
packages to a minor (a caret on `0.x` does exactly that) and read the
changeset before advancing — an accidental break then surfaces in a
consumer's typechecking rather than silently through a satisfied range.

Below `1.0.0`, a breaking change is allowed to ride an ordinary minor
release rather than being held for a major, and the minor-pinning discipline
above is what makes that survivable: a consumer pinned to a `0.x` minor
does not silently absorb the break. `@effected/schemastore` is the worked
example — one minor release changed `SchemaFile.write`'s return type from
a boolean to a result object, narrowed the `SchemaVersion` grammar to
require all three semver components, and flipped the package's tier from
boundary to integrated, all inside `0.7.0` → `0.8.0`.[^schemastore-changelog]
That is the contract working as designed, not an exception to it.

## How scope was closed

The kit did not release package-by-package on its way in. The whole gate
set published together at `0.1.0` against one `effect` prerelease, as an
explicit pre-release: nothing in it claimed stability, and consumer ports
proceeded against real published packages rather than being gated behind
a synthetic proof.

The gate was the union of what five consuming applications needed, and
it closed at **nineteen publishable packages**: eighteen libraries plus
the `pnpm-plugin-effect` companion.

| Package | Tier | Why it was on the gate |
| --- | --- | --- |
| `@effected/semver` | pure | `rspress-plugin-api-extractor`'s DX exemplar |
| `@effected/jsonc` | pure | `config-file`'s JSONC codec; parse/edit/format |
| `@effected/yaml` | pure | `config-file`'s YAML codec |
| `@effected/package-json` | boundary | manifest schemas and file IO for `workspaces`; SPDX validity delegated to `@effected/spdx` |
| `@effected/npm` | boundary | dependency-resolution contracts `workspaces` implements |
| `@effected/config-file` | boundary | `vitest-agent` and `@soda3js/config`; carries the four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) |
| `@effected/walker` | boundary | `config-file`, `xdg` and `workspaces` all traverse paths |
| `@effected/glob` | pure | `workspaces` uses it instead of a `minimatch` runtime dependency |
| `@effected/toml` | pure | `@soda3js/config`; a full-parity format package |
| `@effected/lockfiles` | pure | `workspaces` and `silk-update-action` read lockfiles |
| `@effected/store` | integrated | SQLite cache and migrated state; `rspress-plugin-api-extractor` and `vitest-agent` both consume it |
| `@effected/xdg` | boundary | `vitest-agent`; zero runtime dependencies, does not depend on `store` |
| `@effected/workspaces` | integrated | `vitest-agent`, `silk-update-action`, `savvy-web/systems`; implements `@effected/npm`'s resolver contracts |
| `@effected/runtimes` | boundary | the `runtime-resolver` application's library half |
| `@effected/tsconfig-json` | boundary | `rspress-plugin-api-extractor`'s tsconfig path and the `@savvy-web/bundler` port |
| `@effected/git` | boundary | typed git introspection over core's `ChildProcessSpawner`; consumers are `workspaces` and `savvy-web/systems` |
| `@effected/spdx` | pure | vendored SPDX license expressions as pure schemas; `package-json` delegates license validation to it |
| `@effected/app` | integrated | the composition layer over `xdg` + `config-file` + `store` |
| `@effected/pnpm-plugin-effect` | companion — no tier | not a library, but on the gate: it hands consumers the `effect` catalogs the kit was built against |

That table is a closed historical record of why each package had to
exist before the kit could publish at all — it is not a filter on
anything now.

## Joining the release stream after the gate

Twelve packages arrived after the gate: `markdown`, `schemastore`,
`jsonl`, `cli`, `memfs`, `github-references`, `schema-org`, and the
github-split five — `commands`, `templates`, `github`, `github-actions`
and `sbom` (see [the github-split program](../glossary/github-split.md)).
None entered through the gate's criterion, because that criterion is the
union of what the five founding applications needed and it was met
without them. What scoped each instead:

- The github-split five were scoped by the program's six consumer
  repos — the five savvy-web action repos plus
  `claude-code-marketplace-manager` — and all six have since completed
  the migration onto them. Only `silk-update-action` of those six is
  also one of the five founding applications.
- `markdown`, `schemastore`, `jsonl` and `cli` were each scoped by a
  named consumer and built design-doc-first, then published in the next
  wave whose changesets named them. `cli` came out of the `reposets`
  consumer loop — the kit's first consumer that runs at a terminal
  rather than on a runner — with its design reviewed by that consumer
  before the port.
- `memfs` was scoped by the kit itself: it is the filesystem test
  double every other package's suite needs, which is why it carries no
  `@effected/*` edge, ever.
- `github-references` is the kit's first extraction driven by install
  weight rather than by design: a pure grammar left `github` because an
  octokit-free consumer could not reach it, and `github` keeps a
  droppable compat re-export so the move was not breaking for the
  consumer that had adopted it in its old home.
- `schema-org` is the newest. It was named into existence by `tsdoctor`,
  the register's only library monorepo, and is the kit's second package
  with a published subpath entrypoint.

Gate membership is history, not a filter — the gate answered "what must
exist before the kit publishes at all", and that question is closed. A
package joins the release stream the same way any later release does:
a changeset names it.

## Alternatives rejected

- **Package-by-package incremental release on the way to `0.1.0`.**
  Rejected because a partial gate set cannot satisfy any of the five
  founding consumers, who each need several packages together; shipping
  early would have produced unusable partial surfaces.
- **A synthetic stability proof gating publication** (for example, a
  100%-coverage or full-integration-test bar before `0.1.0`). Rejected
  in favor of letting real consumer ports validate the packages against
  actual published artifacts once the pre-release contract made an
  accidental break a type error at the consumer, not a silent regression.
- **A fixed release cadence** (weekly/monthly cuts) independent of what
  changesets are pending. Rejected because it would either release
  nothing on a quiet week or force a changeset to exist before it is
  ready, coupling the release calendar to package readiness for no
  benefit the changeset mechanism does not already provide.

## Consequences

A release is defined entirely by what changesets exist on the branch —
there is no separate "is this package ready" gate independent of that
mechanism. This makes the catalog-sync ordering load-bearing (see
[the catalog holds next-release versions](catalog-holds-next-release-versions.md))
because the catalog literal a consumer resolves from must reflect
whatever changesets are about to publish, not a hand-maintained
schedule. It also means a package's tier or contract can change inside
an ordinary minor, so a consumer that pins a minor and reads the
changeset before advancing is the safety net, not a major-version
bump.

[^root-claude-releases]: `CLAUDE.md` — "Releases are changeset-driven:
    CI builds the changesets and releases the packages they name."
[^schemastore-changelog]: `packages/schemastore/CHANGELOG.md:275-299` —
    the `0.8.0` entry: `SchemaFile.write` now returns a result object,
    `SchemaVersion` requires all three semver components, and the
    package's tier moved to integrated.
[^github-actions-package]: `packages/github-actions/package.json` —
    `"publishConfig": { "access": "public", ... }`, the machine-checkable
    publish signal discussed in
    [the publishability signal convention](../conventions/publishability-signal.md).
