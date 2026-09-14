# @effected/schemastore-cli

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
