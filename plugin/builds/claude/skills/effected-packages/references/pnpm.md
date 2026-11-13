# @effected/pnpm

Everything pnpm owns alone, over the npm vocabulary it shares with bun and npm: pnpm's effective settings (`PnpmSettings`), its `minimumReleaseAge` gate (`ReleaseAgeGate`), its `@pnpm/matcher` pattern lists (`PnpmMatcher`), its registry, proxy and TLS view as an npm `NpmConfig` (`PnpmNpmConfig`), the `overrides` selector grammar (`OverrideKey`), the `peerDependencyRules` and `versioning` blocks (`PeerDependencyRules`, `VersioningConfig`, `Epic`), the `pnpm-workspace.yaml` editor (`PnpmWorkspaceFile`), the native `pnpm-lock.yaml` documents (`PnpmLockDocument`, `PnpmEnvDocument`, `PnpmExtension`) and, on the `./settings` subpath, the pnpm 12 settings catalog (`PnpmSettingsCatalog`). Boundary tier: the only IO is `PnpmSettings.load`, through core `FileSystem` and `Path` in `R`; everything else is pure. Peers on `@effected/npm` (the `NpmConfig` it returns must be the copy your `NpmHttpClient` and `NpmRegistry` take) and depends on `@effected/glob`, `@effected/walker` and `@effected/yaml`, never on `@effected/lockfiles` or `@effected/workspaces`.

The `catalog:` and `workspace:` protocols are not here: bun reads them as pnpm 12 does, so their resolver contracts stay in `@effected/npm` and catalog assembly (`CatalogSet`) in `@effected/workspaces`.

## Import

```ts
import { Epic, OverrideKey, OverrideKeyError, PartialReleaseAgeGate, PeerDependencyRules, PnpmEnvDocument, PnpmExtension, PnpmLockDocument, PnpmMatcher, PnpmNpmConfig, PnpmSettings, PnpmSettingsError, PnpmWorkspaceFile, PnpmWorkspaceFileError, ReleaseAgeGate, VersioningConfig } from "@effected/pnpm";
import { PnpmSettingsCatalog } from "@effected/pnpm/settings";
import type { PnpmCatalogs, PnpmSettingOrigin, PnpmSettingsLoadOptions, PnpmSettingsSources } from "@effected/pnpm";
```

## Core API

- **`PnpmSettings`** — pnpm's effective settings, the values `pnpm config get <key>` reports. `PnpmSettings.load({ cwd, env, platform, home?, globalConfigDir? })` → `Effect<PnpmSettings, PnpmSettingsError, FileSystem | Path>` (pass `process.platform` at the edge; nothing is read ambiently) merges, highest first: a `pnpm_config_<name>`/`PNPM_CONFIG_<NAME>` variable, the workspace root's `pnpm-workspace.yaml` when `cwd` belongs to that workspace as pnpm decides it, and pnpm's global `config.yaml`. A higher source replaces a lower one's value whole, so a workspace list replaces the global one rather than adding to it. `PnpmSettings.fromSourcesResult({ workspace, global, env })` is the same merge over text you hold, with no IO. Accessors take the camelCase or the kebab-case key: `get(key)` (raw value), `origin(key)` (`"environment" | "workspace" | "global"`), `getString`, `getNumber`, `getBoolean`, `getStringArray`, each an `Option`, plus `minimumReleaseAge` (`Option<number>`) and `minimumReleaseAgeExclude` (`[]` when unset); `files` lists the files read, lowest precedence first. An environment value that does not read as the type asked for is skipped so the next source answers; a file value of the wrong type answers `None`. A missing file is skipped, and an unreadable, non-YAML or non-mapping one fails `PnpmSettingsError` (`reason` `"read" | "parse" | "shape"`); a `packages:` list whose patterns compile one by one but fail as a set (the members share one compile budget) fails `"membership"` rather than answering "not a member". pnpm's built-in defaults and `--config.*` flags are not modelled. `.npmrc` and `npm_config_*` carry no pnpm setting, so they are not read; registries and credentials are `@effected/npm`'s `NpmConfig`. `@effected/workspaces`' `WorkspaceCatalogs.releaseAgeGate()` is a different question: the gate the workspace file and replayed hooks declare, with no environment or global layer.
- **`PnpmNpmConfig`** — pnpm 12's registry, proxy and TLS view as a real `@effected/npm` `NpmConfig`, so `targetFor`, `proxyFor`, `tlsFor` and `NpmHttpClient.layer(config, { packageManager: "pnpm" })` (from `@effected/npm/node`) work unchanged for a tool that replaces `pnpm view`. `PnpmNpmConfig.load(options)` reads pnpm's own layers (it takes the same options as `PnpmSettings.load`, with `FileSystem | Path` in `R`) and ignores `npm_config_*` variables, as pnpm 12 does; `fromSourcesResult` is the pure form.
- **`PnpmSettingsCatalog`** (from `@effected/pnpm/settings`, never the root) — one descriptor per pnpm 12 setting: `entries.<camelCaseName>` carries `name`, `schema`, `kind`, `description`, `locations`, `envFormat`, `default` (`Option`; `None` when pnpm computes it) and `anchor` into pnpm's docs; `read(settings, key)` reads one setting from a `PnpmSettings` over the sources its `locations` allow, failing `PnpmSettingsError` `"shape"` for a value that does not decode. `PnpmSettingName` and `PnpmSettingType<K>` derive from it. It states what pnpm does; strictness and merge policy are yours.
- **`PnpmWorkspaceFile`** — the `pnpm-workspace.yaml` editor. `parseResult(text)` / `parse(text)` (malformed YAML fails `PnpmWorkspaceFileError`); `value` is the parsed mapping; `writeResult(next)` / `write(next)` writes `next` over the file's text as targeted edits so comments, key order and unchanged lines survive, matching the file's own indent and quote style (`inferStyle`); `render(value)` / `renderResult` renders from scratch in canonical key order (`canonicalize`). A value with no YAML form fails `reason: "unrepresentable"`.
- **`VersioningConfig` and `Epic`** — the `versioning` block (`fixed` groups, `epics`, `lanes`, `maxBump`, `ignore`, `changelog`) as a schema; a lane named `main` is refused. `PnpmSettings.versioning()` reads it, and `@effected/changesets` plans from it.
- **`ReleaseAgeGate` / `PartialReleaseAgeGate`** — pnpm's `minimumReleaseAge` (minutes) and `minimumReleaseAgeExclude` as pure vocabulary: `combine` (variadic, total, the single clamping authority: strictest age wins, excludes union), `matchesExclude`/`isExcluded` (`@pnpm/matcher` parity — `*` crosses `/`, deliberately NOT `@effected/glob`'s dialect), `filterVersions(versions, times, name, now)` (caller's clock; a missing or unparseable time is too young). npm's own `min-release-age` (days, minimatch) is `@effected/npm`'s `NpmReleaseAge`, a different definition.
- **`OverrideKey.parseResult(key)`** (and the `Effect` form `OverrideKey.parse`) — an `overrides` key (not an `allowedVersions` key, which pnpm splits on a plain first `>`) as a `Result<OverrideKey, OverrideKeyError>`: `path` holds the parent (when any) then the target, each `{ name, range: Option<string>, depType? }`; `format()` round-trips. `a>b@2`, `@s/a@1>@s/b`, `foo@>=1 <2` and `foo:peer` parse; `a>`, `a>b>c` and `a>b@` fail.
- **`PeerDependencyRules`** — the `peerDependencyRules` block (`ignoreMissing`, `allowAny`, `allowedVersions`, each optional): `PeerDependencyRules.make({...})`, `PeerDependencyRules.empty` (every axis present and empty), `matchesIgnoreMissing(name)` / `matchesAllowAny(name)`. `@effected/workspaces`' `PeerCheck` and `WorkspaceCatalogs.peerDependencyRules()` take it.
- **`PnpmMatcher.compile(patterns)`** — a `peerDependencyRules.ignoreMissing` / `allowAny` list as a predicate over package names: `*` spans any characters, `/` included; a leading `!` negates; a mixed list is walked in order, so a later matching negation resets an earlier include; an empty list matches nothing. `@effected/workspaces`' `PeerCheck` applies it.

- **`PnpmLockDocument`** (`Schema.Class`) — the lockfile document of a `pnpm-lock.yaml` as pnpm writes it, `lockfileVersion` 9 and newer: `settings`, `overrides`, `catalogs`, `importers`, `packages`, `snapshots`. `PnpmLockDocument.parse(content)` → `Effect<PnpmLockDocument, LockfileDocumentError>` (the error is `@effected/npm`'s) reads the LAST document of the YAML stream and fails, in order: `reason: "syntax"` (not YAML, `line` from the first diagnostic), `"framing"` with `framing: "unexpectedDocuments"` (more than two documents) or `"noLockfileDocument"` (an empty lockfile position), `"version"` (`lockfileVersion` below 9, read before the shape so an old file fails as too old; `lockfileVersion` and `minimumSupported` on the error), `"shape"`, then `framing: "noImporters"` (an empty `importers` map). `documents` carries the stream's document count on a framing failure.
- **`PnpmEnvDocument`** (`Schema.Class`) — the env preamble pnpm writes ahead of the lockfile document when a workspace declares `configDependencies` or `devEngines.packageManager`: `lockfileVersion`, `importers` (`packageManagerDependencies`, `configDependencies`), `packages`, `snapshots`. `PnpmEnvDocument.parse(content)` → `Effect<Option<PnpmEnvDocument>, LockfileDocumentError>` reads the FIRST of two documents with the same splitter, `Option.none()` when the stream has no preamble. To read the pinned package manager or config-dependency integrity out of it, use `@effected/lockfiles`' `PnpmEnvLockfile`.
- **`PnpmExtension`** (`Schema.Class`, `_tag: "pnpm"`) and **`PnpmCatalogs`** — the lockfile header pnpm alone records (`catalogs`, `overrides`, `settings`), as `@effected/lockfiles`' `Lockfile.extension` carries it. To read a `pnpm-lock.yaml` into the manager-neutral `Lockfile` model, use `Lockfile.parse(content, { format: "pnpm" })`, which parses through `PnpmLockDocument`.

## Usage

```ts
import { PnpmSettings, ReleaseAgeGate } from "@effected/pnpm";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, Option } from "effect";

const gate = Effect.gen(function* () {
  const settings = yield* PnpmSettings.load({ cwd: process.cwd(), env: process.env, platform: process.platform });
  return ReleaseAgeGate.combine({
    ageMinutes: Option.getOrElse(settings.minimumReleaseAge, () => 0),
    exclude: settings.minimumReleaseAgeExclude,
  });
}).pipe(Effect.provide(NodeServices.layer));
```

## Gotchas

- **Never clamp a `PartialReleaseAgeGate` on its own.** Route even one contribution through `ReleaseAgeGate.combine`.
- **`PnpmSettings` applies no built-in default.** An unset `minimumReleaseAge` is `None`, as `pnpm config get` reports it, though pnpm installs with a default.
- **`.npmrc` is not a pnpm settings source.** Registries and credentials are `@effected/npm`'s `NpmConfig`.
