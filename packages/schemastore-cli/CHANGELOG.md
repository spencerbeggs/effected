# @effected/schemastore-cli

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
| @effected/schemastore | peerDependency | added | — | workspace:\* |
| effect | peerDependency | added | — | 4.0.0-rc.115 |

- `@effected/schemastore` and `effect` are peer dependencies; the package ships nothing importable, only the bin. [#721][#721]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#721]: https://github.com/spencerbeggs/effected/pull/721
