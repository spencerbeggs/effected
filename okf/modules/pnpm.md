---
type: Module
title: pnpm
description: Everything pnpm owns alone — its effective settings (PnpmSettings), release-age gate (ReleaseAgeGate), package-name pattern lists (PnpmMatcher), pnpm-lock.yaml documents (PnpmLockDocument, PnpmEnvDocument, PnpmExtension) and, still to move in, its settings catalog, versioning block, overrides grammar and workspace file editor — over the npm vocabulary it shares.
status: draft
kind: package
resource: ../../packages/pnpm
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-11-13T00:54:12Z
sources:
  - id: package-manager-model-design
    resource: ../../docs/superpowers/specs/2026-11-12-package-manager-model-design.md
  - id: protocol-owner
    resource: ../decisions/catalog-and-workspace-protocol-owner.md
  - id: pnpm-settings-ts
    resource: ../../packages/pnpm/src/PnpmSettings.ts
  - id: release-age-gate-ts
    resource: ../../packages/pnpm/src/ReleaseAgeGate.ts
  - id: pnpm-matcher-ts
    resource: ../../packages/pnpm/src/PnpmMatcher.ts
  - id: pnpm-lock-document-ts
    resource: ../../packages/pnpm/src/PnpmLockDocument.ts
integrity:
  generated:
    body: d1378cb6971ee555
---

# pnpm

## Purpose

`@effected/pnpm` holds every concept that is pnpm's alone.[^package-manager-model-design] The owner's rule is that a concept that is one manager's alone lives in that manager's package, and a concept shared by several managers lives in the lowest package they all depend on, which is [npm](npm.md). pnpm's settings, `versioning` block and lockfile document are not shared with npm or bun, so they live here.

## Tier and dependency posture

Boundary tier at the root: `effect` and `@effected/semver` are the peers, `@effected/npm`, `@effected/glob`, `@effected/walker` and `@effected/yaml` the dependencies, and the only IO is `PnpmSettings.load`, through core `FileSystem` and `Path` in `R`. No module imports `node:*`. The dependency direction is `npm <- pnpm` and `npm <- bun`, then both `<- lockfiles <- workspaces`, with `pnpm <- workspaces` as well. No manager package depends on `lockfiles` or `workspaces`; `lockfiles` imports each manager's native document schema and owns the normalisation into its common model. The package sits one layer above `npm` and below `lockfiles` in `lib/configs/layers.json`. The `@effected/semver` peer is not used here; it closes the peer that `@effected/npm` declares.

## Contents

- **`PnpmSettings`** and **`PnpmSettingsError`**: the settings `pnpm config get` reports, merged from `pnpm_config_*`/`PNPM_CONFIG_*` variables, the workspace root's `pnpm-workspace.yaml` and pnpm's global `config.yaml`, highest first. `fromSourcesResult` is the pure merge; `load` is the IO shell.[^pnpm-settings-ts] The precedence and membership detail is under [pnpm settings](#pnpm-settings) below.
- **`ReleaseAgeGate`** and **`PartialReleaseAgeGate`**: pnpm's `minimumReleaseAge` (minutes) and `minimumReleaseAgeExclude` as pure vocabulary. `combine` is the single clamping authority (strictest age wins, excludes union); `matchesExclude` is pnpm's flat `*`-crosses-`/` matcher, deliberately not `@effected/glob`'s dialect; `filterVersions` drops too-young versions against a caller's clock.[^release-age-gate-ts] npm's own `min-release-age` (days, minimatch excludes) is a different definition and is `@effected/npm`'s `NpmReleaseAge`.
- **`PnpmLockDocument`**, **`PnpmEnvDocument`** and **`PnpmExtension`** (with the `PnpmCatalogs` type): the native documents of a `pnpm-lock.yaml`. That file is a YAML stream of up to two documents, an env preamble then the lockfile document, and an internal splitter (`internal/stream.ts`) is the one place the framing is decided, so the two parsers cannot disagree about which document is which. `PnpmLockDocument.parse` reads the last document and fails `@effected/npm`'s `LockfileDocumentError` on, in order: syntax (with the YAML engine's first diagnostic line), framing (`unexpectedDocuments` past two documents, `noLockfileDocument` for an empty lockfile position, both with the document count), version (`lockfileVersion` below 9, gated before the shape decode in `internal/version.ts`), shape, then framing `noImporters`. `PnpmEnvDocument.parse` reads the first of two documents as an `Option`, gated and decoded the same way. `PnpmExtension` is the lockfile header (`catalogs`, `overrides`, `settings`) carried on `lockfiles`' `Lockfile.extension`. `PnpmLockDocument` reuses its field schemas, so the two cannot drift.[^pnpm-lock-document-ts]
- **`PnpmMatcher`**: `compile(patterns)` turns a `peerDependencyRules.ignoreMissing` or `allowAny` list into a predicate with `@pnpm/matcher`'s composition rules (negation, ordered resets). Its single-pattern step is `ReleaseAgeGate.matchesExclude`, so a change to one moves the other. `@effected/workspaces`' `PeerCheck` is its consumer.[^pnpm-matcher-ts]

- **`OverrideKey`** and **`OverrideKeyError`**: the selector grammar of an `overrides` key only, restated from pnpm's `parse_pkg_and_parent_selector`, `parse_wanted_dependency` and `is_valid_old_npm_package_name` (vendored under `.repos/pnpm`). `OverrideKey.parseResult(key)` returns a `Result` and `OverrideKey.parse` is the `Effect` form behind an `OverrideKey.parse` span; `path` is the parent segment then the target, each a name plus an `Option` range and an optional `:prod`/`:optional`/`:peer` suffix on the target; `format()` round-trips. The parent delimiter is the first `>` not preceded by space, `|` or `@`, so a path holds one segment or two. `path` is schema-checked to one or two segments. Failures are `invalid-selector` or `empty-range-with-parent`. `peerDependencyRules.allowedVersions` keys are not `OverrideKey` selectors: pnpm splits them on a plain first `>` and never fails (`deps-inspection-peers/src/filter.rs`), so `PeerCheck` keeps its own split and must not be rewired onto this class.
- **`PeerDependencyRules`**: the `peerDependencyRules` block as a class with every axis `optionalKey`; `empty` is the shared all-axes-present value, and `matchesIgnoreMissing`/`matchesAllowAny` delegate to `PnpmMatcher.compile`. It replaces the `PeerDependencyRules` type and `NoPeerDependencyRules` constant `@effected/workspaces` used to export.

The `catalog:` and `workspace:` protocols are not here: bun reads them the way pnpm 12 does, so `CatalogResolver`, `WorkspaceResolver` and the specifier grammar stay in `@effected/npm`, and `CatalogSet` stays in `@effected/workspaces`, which assembles it from lockfiles.[^protocol-owner]

## Planned contents

- The settings catalog: every pnpm 12 setting as an Effect schema with its kind, description, the places it may be set and a docs anchor, with typed reads through it from `PnpmSettings`.
- The `versioning` block schema (`fixed`, `ignore`, `maxBump`, `lanes`, `epics`, `changelog`).
- The `overrides` key grammar and the `peerDependencyRules` shapes.
- The `pnpm-workspace.yaml` editor, which keeps formatting and writes keys in a canonical order.

Policy over the catalog (merge strategy, enforcement, the catalog-to-overrides directive) stays outside this package.

## pnpm settings

`PnpmSettings` answers what `pnpm config get <key>` answers for a pnpm
setting, without spawning pnpm. Its first consumer is
rolldown-pnpm-config's `upgrade`, which applies pnpm's release-age gate
itself and needs `minimumReleaseAge` and `minimumReleaseAgeExclude`.
It is a `Schema.Class` value, not a service: the merge and the typed reads
are pure (`PnpmSettings.fromSourcesResult` over text), and
`PnpmSettings.load` is a thin shell that locates the two files and reads
them through core `FileSystem`.[^pnpm-settings-ts]

Precedence, highest first: a `pnpm_config_<snake>` or
`PNPM_CONFIG_<SNAKE>` variable, the workspace root's
`pnpm-workspace.yaml`, then pnpm's global `config.yaml`. A higher source
replaces a lower one's value whole; lists are not merged. This order was
read off pnpm itself with `pnpm config get` over hermetic `HOME` and
`XDG_CONFIG_HOME` trees, for both in-window majors: the pnpm 12 native
binary and the pnpm 11 JS build, whose `getConfigDir` and env reader were
also read in source. The probes settled what the reader leaves out, too.
pnpm 11 and 12 take no pnpm setting from `.npmrc` (only registry and auth
keys), from `npm_config_*` variables or from the old global `rc` file. A
registry or a credential is `@effected/npm`'s `NpmConfig`, which reads
exactly those files. The global directory is `$XDG_CONFIG_HOME/pnpm`,
else `~/Library/Preferences/pnpm` on darwin, `%LOCALAPPDATA%\pnpm\config`
on win32, and `~/.config/pnpm` elsewhere. `platform` and `env` are required
options, because the package reads no ambient `process`.

The workspace file is found the way pnpm's `findWorkspaceDir` finds it,
read in the pnpm 11 source and probed against both majors:

- A `PNPM_CONFIG_WORKSPACE_DIR` / `NPM_CONFIG_WORKSPACE_DIR` variable (either
  case) names the directory, unconditionally.
- Otherwise the ascent starts from the real path of `cwd`
  (`FileSystem.realPath`, the lexical path when that fails), through
  `Walker.ascend` and `Walker.findUpward`, to the nearest
  `pnpm-workspace.yaml`. A misnamed manifest (`pnpm-workspace.yml`,
  `.pnpm-workspace.yaml` and five more spellings) is passed over, as pnpm 12
  passes it. pnpm 11 fails below one with
  `ERR_PNPM_BAD_WORKSPACE_MANIFEST_NAME`.
- The found manifest applies only when `cwd` belongs to it: `cwd` is the
  root, `cwd` holds no `package.json`/`package.json5`/`package.yaml`, or
  `cwd` matches the `packages:` patterns. Membership matches
  `<dir>/package.json` against `<pattern>/package.json` through a
  `GlobSet`, so `examples/**` excludes `examples` itself; a `!` pattern
  excludes, a `/`-leading one is skipped, and an absent list is `["."]`, the
  root alone. A single-package repo with no `packages:` key therefore gives
  a nested project (an example app, a fixture) no workspace settings, as
  pnpm does. A directory under `node_modules` or `bower_components` is never
  a member. pnpm 12 diverges there: it counts a top-level `node_modules`
  matched by `*`.

The typed reads follow pnpm 12 where the majors differ:

- An environment value is parsed as the type the accessor asks for, and one
  that does not parse falls through to the next source. pnpm 11 instead keeps
  an unparseable list value as a string.
  - An integer setting (`minimumReleaseAge`) takes canonical digits only, once
    trimmed: pnpm 12 skips `05`, `00`, `+5`, `-0`, `5.0`, `0x10`, `0b11`, `1e2`
    and `1_000`, all of which pnpm 11 coerces through `Number`. The value must
    be a safe integer, where pnpm 12 reads an unsigned 64-bit one.
  - `getNumber` takes a canonical decimal (optional `-`, an optional
    fraction, no leading zero).
  - A boolean is exactly `true` or `false`, trimmed and lowercase.
  - A list is a JSON array of strings.
- An empty variable is unset. pnpm 11 reads an empty
  `PNPM_CONFIG_MINIMUM_RELEASE_AGE` as `0`.
- When both spellings are set, the uppercase one wins. pnpm 11's answer
  depends on the order the variables appear in the environment.
- In a file, pnpm 12 coerces before it type-checks, and so does the reader:
  a boolean setting reads `true`/`yes`/`y`/`on` and `false`/`no`/`n`/`off`,
  quoted or not, trimmed and in any case. An integer setting reads a quoted
  canonical digit string. pnpm 11 returns such strings as written.
- A file value that still has the wrong type answers `None` rather than
  falling through, because pnpm 12 refuses to load the file (`invalid u64`,
  `invalid boolean`). A YAML number is read as decoded, so an unquoted `5.0`
  or `1e2` reads as 5 or 100 where pnpm 12 refuses the file.
- A `null` is unset, so the global file answers. pnpm 11 instead reports
  the `null`, shadowing the global value. An empty list shadows in both.

The reader does not model three things. Built-in defaults stay out, because
`pnpm config get` shows `minimumReleaseAge` as unset too. Command-line flags
stay out. So do the per-setting source restrictions pnpm applies to a few
machine-level settings.

`@effected/workspaces`' `WorkspaceCatalogs.releaseAgeGate()` answers a
different question: the gate declared by the workspace file plus replayed
config-dependency hooks, with no environment or global layer.

## The `/settings` subpath

The settings catalog is one large object a bundler cannot tree-shake, so it ships from the `@effected/pnpm/settings` subpath and the root entry never reaches it. A bundle-reachability test pins that, so a consumer that wants only the overrides grammar or the lockfile document does not pay for the catalog. `lockfiles` and `changesets` must not reach the subpath unless they use it.

## Current state

The root entry exports `PnpmSettings`, `PnpmSettingsError`, `ReleaseAgeGate`, `PartialReleaseAgeGate`, `PnpmMatcher`, `OverrideKey`, `OverrideKeyError`, `PeerDependencyRules`, `PnpmLockDocument`, `PnpmEnvDocument` and `PnpmExtension`, pinned by `__test__/entrypoints.test.ts`. The remaining planned contents move in from rolldown-pnpm-config.

The `PnpmEnvLockfile` readers, `ConfigDependencyLock` and `PackageManagerLock` did not move here, though the design spec lists `PnpmEnvLockfile` among the manager-owned types. This is a ruled deviation: the readers fail with `lockfiles`' own `LockfileParseError | LockfileFramingError`, which makes them part of the reading layer, so they stay in [lockfiles](lockfiles.md) over the `PnpmEnvDocument` schema this package owns.

[^package-manager-model-design]: `docs/superpowers/specs/2026-11-12-package-manager-model-design.md`
[^protocol-owner]: [catalog-and-workspace-protocol-owner](../decisions/catalog-and-workspace-protocol-owner.md)
[^pnpm-settings-ts]: `packages/pnpm/src/PnpmSettings.ts`; the tests are `__test__/PnpmSettings.test.ts` and `__test__/PnpmSettingsLoad.test.ts`.
[^release-age-gate-ts]: `packages/pnpm/src/ReleaseAgeGate.ts`
[^pnpm-matcher-ts]: `packages/pnpm/src/PnpmMatcher.ts`
[^pnpm-lock-document-ts]: `packages/pnpm/src/PnpmLockDocument.ts` and `PnpmEnvDocument.ts`; the tests are `__test__/PnpmLockDocument.test.ts`, over copies of `lockfiles`' fixtures with a provenance README.
