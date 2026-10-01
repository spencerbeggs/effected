# @effected/schemastore-cli

## 0.18.0

### Breaking Changes

- The kit now builds on and peers stable `effect` `^4.0.0`, in place of an exact release-candidate pin. Move `effect` and every `@effect/*` package to the same `4.x` version in one install: Effect releases them together at one version. A package from this release cannot share an install with an `effect` release candidate. The peer is a caret range, so later `4.x` releases of Effect satisfy the kit without a kit release.
- Kit exports are unchanged. A consumer moving to stable `effect` meets these changes in its own code:
  - `Array`, `Chunk`, `Effect` and `Record` `partition`, their `separate` helpers and `Option.partitionMap` return `[successes, failures]`. Where both sides share a type, the reversed destructuring still compiles, so search for every call.
  - `Schema.brand` takes one identifier and is type-only: the identifier is not stored on the AST and does not survive `SchemaRepresentation`. Compose distinct brands by applying `brand` more than once.
  - `TestSchema`'s round-trip assertion is `verifyRoundTrip`, with Effect forms `succeedEffect`, `failEffect` and `verifyRoundTripEffect`.
  - Effect marks some APIs `@stability unstable`: those may change in a minor Effect release. Untagged APIs follow semver.

### Documentation

- Every exported construct's TSDoc was reviewed against the current API. Summaries open with what the construct does, error channels and requirements are stated, examples use real imports and compile, and links resolve. Comments that described options, errors or defaults the code does not have were corrected. [#910][#910]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.10.0 | 0.11.0 |
| @effected/schemastore | dependency | updated | 0.17.0 | 0.18.0 |
| @effected/env | dependency | added | — | 0.1.0 |
| @effected/glob | dependency | added | — | 0.10.0 |
| @effected/walker | dependency | added | — | 0.15.0 |

- The bin now depends on `@effected/env`, `@effected/walker` and `@effected/glob`, the new required peers of `@effected/cli`, so a global or `npx` install resolves them. [#905][#905]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#905]: https://github.com/spencerbeggs/effected/pull/905

[#910]: https://github.com/spencerbeggs/effected/pull/910

## 0.17.0

### Breaking Changes

- The CLI now builds catalogs from per-config slices and maintains the merged `catalog.json` itself. This follows the `@effected/schemastore` config change: `name` is required and `catalogPath` is replaced by `catalogDir`.

- The JSON report's `catalog` field is now `{ slice?, merged? }` instead of a single value.

- Configs without a `name`, or using `catalogPath`, are rejected when loaded.

### Features

#### Slice-and-merge catalogs

- Each config writes its own slice to `<catalogDir>/<name>.json`. The CLI maintains the merged `catalog.json` in `catalogDir`'s parent (default `<outputDir>/catalog.json`, the same URL as before). It is the url-sorted union of all slices, so the result is deterministic whichever config builds last.

- A duplicate url across slices blocks the merge with exit 1.

- An invalid slice blocks the merge with exit 1, naming each reason. A slice is invalid if it is not JSON, is not an array, is unreadable, or has an entry that fails decoding (including excess keys).

- A `catalogDir` that cannot be listed is a config error (exit 2), reported before anything is written.

- Orphaned slices and an orphaned merged file are reported, never deleted. The merged catalog keeps advertising an orphaned slice's entries until that slice is deleted.

- A slice claimed only through case folding is reported as `caseFoldedMatch`.

### Bug Fixes

- Two configs sharing an `outputDir` no longer clobber each other's `catalog.json` (#754).
- Step-summary table cells are escaped. [#872][#872]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.16.1 | 0.17.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#872]: https://github.com/spencerbeggs/effected/pull/872

## 0.16.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.16.0 | 0.16.1 |

## 0.16.0

### Breaking Changes

- The kit now builds on and peers `effect` `4.0.0-rc.118`, pinned exactly. Consumers must move `effect` and every `@effect/*` package to `4.0.0-rc.118` in the same install. Effect removed the `effect/unstable/*` export paths in this release, so an `@effected` package built on rc.118 cannot share an install with `effect` rc.117.

- Moving the pin also closes a fresh-install failure on rc.117. `@effect/platform-node@4.0.0-rc.117` depends on `@effect/platform-node-shared` with a caret, so an install without a lockfile paired the rc.118 shared package with `effect` rc.117 and failed at startup with `ERR_MODULE_NOT_FOUND`.

- Consumers moving to this release: effect removed the `effect/unstable/*` export paths (imports become `effect/<module>`), moved `Arbitrary` to `effect`, split `effect/Encoding` into `effect/encoding/Base64`, `Base64Url` and `Hex`, and renamed the `Schema` range and string checks (`isLengthBetween` → `isBetweenLength`, `isStartsWith` → `isStartingWith`, and so on). Kit exports are otherwise unchanged; the kit's own imports moved onto the new paths. [#864][#864]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.9.0 | 0.10.0 |
| @effected/schemastore | dependency | updated | 0.15.2 | 0.16.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#864]: https://github.com/spencerbeggs/effected/pull/864

## 0.15.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.8.0 | 0.9.0 |
| @effected/schemastore | dependency | updated | 0.15.1 | 0.15.2 |

## 0.15.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.7.0 | 0.8.0 |
| @effected/schemastore | dependency | updated | 0.15.0 | 0.15.1 |

## 0.15.0

### Features

- Upgrades core Effect to `rc-117` [#812][#812]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.6.0 | 0.7.0 |
| @effected/schemastore | dependency | updated | 0.14.0 | 0.15.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#812]: https://github.com/spencerbeggs/effected/pull/812

## 0.14.0

### Breaking Changes

#### The whole kit tracks Effect `4.0.0-rc.116`

- Every package's `effect` peer moves from `4.0.0-rc.115` to `4.0.0-rc.116`. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it. No `@effected` API changes shape on this advance; the kit itself needed one edit (`Stream.scan` now takes a lazy initial state, met once in `@effected/jsonl`'s `Journal.projection`). A consumer that upgrades meets the rc.116 renames on its own code:

- `SchemaTransformation.make` is `makeTransformation`, and `Transformation#compose` is the dual standalone `SchemaTransformation.composeTransformation`.

- `SchemaGetter.Getter` is a tagged union exposing only `pipe`: `new SchemaGetter.Getter`, `onSome` and `onNone` are gone in favour of `SchemaGetter.map` / `compose` / `run` and `transformEffect` / `transformOptionalEffect`.

- `Stream.scan` and `Stream.scanEffect` take `() => initial`; `Stream.partition` returns `[passes, fails]`; `Stream.mapBoth` takes `onElement` / `onError`.

- `Effect.orElseSucceed` passes the error to its fallback and `Effect.isEffect` narrows to `Effect<unknown, unknown, unknown>`.

- `ByteSize.Input` string literals are checked at compile time; parse external strings with `ByteSize.fromString`.

- Arbitrary shrinking changed, so property-test replay tokens recorded at rc.115 no longer reproduce.

### Documentation

#### The Claude Code and Copilot plugins teach the rc.116 surface

- The `effect-v4-schema` transformation reference composes transformations with `SchemaTransformation.composeTransformation` and describes the `Getter` surface rc.116 left behind; the source-lookup and testing skills report rc.116 as the kit's pin and the two-copy lockfile shape the bridge now produces (`rc.115` for the toolchain, `rc.116` for the kit); the session-start briefing reports rc.116.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.5.2 | 0.6.0 |
| @effected/schemastore | dependency | updated | 0.13.1 | 0.14.0 |
| @effect/platform-node | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | devDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |
| effect | peerDependency | updated | 4.0.0-rc.115 | 4.0.0-rc.116 |

### Maintenance

#### The rc.115 `packageExtensions` bridge is retired

- The toolchain (`@savvy-web/tsdown-plugins`, `rolldown-pnpm-config`, `@vitest-agent/*`) has republished declaring `effect` and its `@effected/*` inputs as regular dependencies, so the workspace no longer needs the `packageExtensions` block that pinned them by hand. Its ten keys named versions no longer installed and the lockfile diff on removal was the checksum line alone. Nothing published changes; this is the workspace's own install shape. [#792][#792]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#792]: https://github.com/spencerbeggs/effected/pull/792

## 0.13.1

### Bug Fixes

- Fixes closure issues in all packages.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.5.1 | 0.5.2 |
| @effected/schemastore | dependency | updated | 0.13.0 | 0.13.1 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.13.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.12.0 | 0.13.0 |

### Other

- `check` and `build` now report an orphaned document: a file left behind at a sibling shape of a derived path (`<name>.json`, `<name>-<v>.json`, `<v>/<name>.json`, `<v>/<name>-<v>.json`) for a label the config still declares, that no target, frozen version, or catalog path claims — the file an `appendVersion` flip or a `layout` change leaves under the old name. Stale (exit 1) under `check`, reported and never deleted under `build`; the report carries the paths in `orphaned` and the human line names the remedy. Only those derived shapes are probed — `outputDir` is never listed, so sharing it with another config, a deploy folder, or the repository root does not fail `check` (short of two configs deriving one schema name and label under different layouts into the same directory). Minor because a repository holding such a file now fails a previously-passing `check` — the failure is the point (for a published label the advertised URL was serving a stale document with no report), and the remedy is deleting the orphan by hand. Closes #747. [#753][#753]

### Thanks

Thanks to [@fuleinist](https://github.com/fuleinist) for their contributions!

[#753]: https://github.com/spencerbeggs/effected/pull/753

## 0.12.0

### Features

- The package now has a library entry beside its `bin`: `AjvValidator.layer`, the shipped ajv strict-mode `SchemaValidator` engine (declared keyword families and the standard `ajv-formats` vocabulary registered, a fresh instance per call), moved here from `@effected/schemastore` together with the `ajv` / `ajv-formats` dependencies. The command composes it at its edge; it is exported for a program that drives `SchemaPipeline` itself and wants the same verdict.

- Pre-flight now reads each frozen file and verifies its `$id`: a run fails with `FrozenVersionIdMismatchError` when a frozen file's `$id` is absent, differs from the derived one, or the file's text does not parse. A `baseUrl` change on a hosted schema is a re-publish event for every frozen label it affects, and this catches it before a stale file ships.

- `check` and `build` now report an `orphaned` catalog: when no schema declares a `catalog` but a file already exists at `config.catalogPath`, `check` reports it stale (exit 1) and `build` reports it without deleting it.

- `ConfigLoader` now requires `frozen[].$id` on a loaded config — a config built by an older `@effected/schemastore` is rejected as malformed rather than silently accepted. [#746][#746]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.11.0 | 0.12.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#746]: https://github.com/spencerbeggs/effected/pull/746

## 0.11.0

### Breaking Changes

#### Loads the new keyed config shape, verifies frozen versions, and writes one catalog file

- The CLI now loads `@effected/schemastore`'s keyed `defineConfig` shape (schemas keyed by name, versions/current, derived `$id` and catalog URLs) — every `schemastore.config.ts` must be updated to that shape before `build` or `check` will run against it.

- Before generating or checking anything, the `Runner` now verifies that every declared frozen version's file exists on disk. A missing one fails with `FrozenVersionMissingError` and exits `1` before any write happens, so a config that advertises a version whose file was deleted or never committed is caught immediately — this prevents the catalog from advertising a 404.

- Drift classification is now reported per schema rather than as one run-wide verdict, and `--drift`/`--force` force the same policy across every schema for that run. All declared catalog entries are assembled into a single `catalog.json` array at the config's `catalogPath`, replacing any per-schema catalog file from the previous config shape.

- The human, JSON and step-summary report shapes changed to match: the JSON report's `drift` field is now `{ onDrift, policy? }` — `policy` present only when a flag forced one tolerance, and the old `source` field is gone (it read "flag" for any flag, so it could not answer whether the policy was forced); `catalog` is a single object (`{ path, entries, outcome }`) rather than a per-schema list. The `--drift` and `--on-drift` flag descriptions were updated to describe the new config shape. [#740][#740]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.10.0 | 0.11.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#740]: https://github.com/spencerbeggs/effected/pull/740

## 0.10.0

### Features

- `DriftError` now names each drifting schema instead of only a count: its `drifted` field carries, per schema, the `$id`, the `change` kind, the published `version` (when known) and the suggested `nextVersion` (when derivable). `count` is still available as a getter derived from `drifted.length`, and the rendered message lists every drifting schema.

- Combining `--force` with an explicit `--drift` other than `allow` is now a usage error (`ConflictingFlagsError`, exit `64`) instead of silently resolving to `allow` — `--force` is shorthand for `--drift=allow`, so the combination was always contradictory.

### Bug Fixes

- Catalog entries are now compared to the file on disk with a single read (previously a separate `exists` check plus a read), and the comparison is structural (`CanonicalJson.equals`) rather than a hand-rolled deep-equal — a path that does not parse, or does not exist, is treated as "different" so a build repairs it. [#730][#730]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.5.0 | 0.5.1 |
| @effected/schemastore | dependency | updated | 0.9.1 | 0.10.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#730]: https://github.com/spencerbeggs/effected/pull/730

## 0.9.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/cli | dependency | updated | 0.4.1 | 0.5.0 |
| @effected/schemastore | dependency | updated | 0.9.0 | 0.9.1 |

## 0.9.0

### Features

- First release of the `schemastore` command, the bin-only companion to `@effected/schemastore`. It replaces the per-repository `generate-schema.ts` script and its drift test with one `schemastore.config.ts` and two `package.json` scripts.

#### `build` and `check`

- `schemastore build [config]` generates every declared schema, runs the lint and ajv gates, applies the drift policy, and writes what passes — content-compared, so unchanged files are untouched — plus each derived catalog entry.
- `schemastore check [config]` is the identical walk with no writes: it reports what `build` would do under the same flags and exits under the same conditions. It is the CI gate, so it also exits `1` on stale documents — whenever a build would write anything (a committed schema or catalog entry that differs from what the config generates, or is missing) — with a message that says to run `schemastore build` and commit the result.

#### Config discovery

- The config is `schemastore.config.ts` (also `.mts`, `.js`, `.mjs`) found by walking upward from the working directory, or the file named by the optional positional argument. It is loaded through `jiti` against the config file's own path, so relative specifiers and the `effect` / `@effected/schemastore` imports resolve from the consumer's tree. Relative `path` values resolve against the config file's directory, never the working directory.

#### Drift flags

- `--drift=strict|semantic|allow` and `--on-drift=error|warn` override the config's `drift` block for one run; `--force` is shorthand for `--drift=allow`.
- Under `onDrift: error` a drifting published schema holds every write and exits `1`, naming each drifting schema, its change class and the suggested next version; under `warn` the run writes, exits `0` and warns once per schema.
- An unpublished schema is never drift; gate failures fail both commands regardless of `onDrift`.

#### Output

- `--format=json` writes one document to stdout (config path, per-schema outcome, per-catalog-entry outcome, the effective drift policy and its source) and moves all human text to stderr.
- When `GITHUB_STEP_SUMMARY` is set, both commands append a markdown table and the drift verdict; a failure to write it is logged, never fatal.

#### Exit codes

- `0` success (including drift under `warn`), `1` drift under `error`, a gate failure, or (`check` only) a stale document a build would write, `2` config not found, failed to load or failed validation, `3` infrastructure failure, `64` usage error.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/schemastore | dependency | updated | 0.8.0 | 0.9.0 |
| @effect/platform-node | dependency | added | — | 4.0.0-rc.115 |
| @effected/cli | dependency | added | — | workspace:^ |
| jiti | dependency | added | — | ^2.6.0 |
| @effected/schemastore | peerDependency | added | — | workspace:* |
| effect | peerDependency | added | — | 4.0.0-rc.115 |

- `@effected/schemastore` and `effect` are peer dependencies; the package ships nothing importable, only the bin. [#721][#721]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#721]: https://github.com/spencerbeggs/effected/pull/721
