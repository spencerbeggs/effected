# @effected/cli

The `effected` command: a front end of the `effected` tool, on `effect/cli` and
`@effected/cli-kit`. Application package, no library tier. A consumer installs
`@effected/plugin`, not this package. (The CLI presentation library is
`@effected/cli-kit`.)

## Import

```ts
import { CLI_VERSION, main, makeRootCommand, run } from "@effected/cli";
import { main } from "@effected/cli/main";
```

## Core API

- **`makeRootCommand(deps)`** — builds the `effected` command tree from its
  dependencies (`SchemaCommandDeps`); there is no `rootCommand` constant.
  `--version`, `--help` and the `schema`, `package` and `action` subcommands.
- **`main(options?)`** — runs the program on the Node services and owns the
  process. `options.distribution` names the carrier the bin was installed
  through; `--version` then ends with `via <name> <version>`.
- **`run(...)`** — the same program over a platform layer you supply, so a test
  drives it in-process (over `@effected/memfs`) without spawning.
- **`CLI_VERSION`** — this package's own version, replaced at build.

The `effected` bin is declared here and again by `@effected/plugin`, which
passes its own `distribution`. Shared logic belongs in `@effected/engine`.

## `effected schema`

```text
effected schema build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json] [--ignore-version-mismatch]
effected schema check [config] [same flags]
effected schema validate <payload.json> [config] [--schema <path|$id|url>] [--format=human|json] [--ignore-version-mismatch]
```

Run next to a `schemastore.config.{ts,mts,js,mjs}` (found by walking upward) or
pass its path; none found is exit `2`. The config default-exports
`defineSchemastore(...)` from `@effected/plugin`.

- **`build`** generates, gates (structural lint plus ajv strict mode), applies
  the drift table and writes what passes. A gate failure, or drift under
  `onDrift: "error"`, writes nothing.
- **`check`** is the same walk with no writes and the CI gate: it also exits `1`
  when a build would write anything or an orphaned output sits on disk. A
  person sees a coloured line diff of each changed document; the JSON report
  carries `diff.hunks` and `diff.unified`.
- **`validate`** checks a payload against the document it names. Each finding
  has `location: { file, line, column }`, one-based, from the payload text.
- **`--format`** defaults to JSON under `--agent` and to human text otherwise;
  JSON writes one document to stdout and human text moves to stderr.
- **`--force`** is `--drift=allow` for one run and is refused beside any other
  `--drift`.
- **Version mismatch.** When the config's `@effected/schemastore` is not the
  tool's, the command fails with exit `2` naming both versions. Align them
  through the catalog; `--ignore-version-mismatch` runs on with a warning.

| published | policy | no change / created | annotations | contract |
| --- | --- | --- | --- | --- |
| `false` | any | write | write | write |
| `true` | `allow` | write | write | write, loud warning |
| `true` | `semantic` | write | write | drift |
| `true` | `strict` | write | drift | drift |

Exit codes: `0` success (including drift under `onDrift: "warn"`); `1` drift
under `error`, a gate failure, a blocked catalog merge, a stale or orphaned
output under `check`, or a payload that does not conform; `2` config not found
or failed to load, a version mismatch, or an unreadable payload; `3`
infrastructure failure; `64` usage error. Failures arrive on stderr as the
`@effected/cli-kit` standard report; gate on the exit code.

## `effected package build`

```text
effected package build [--format=human|json] [--no-exe] [--verbose]
```

Builds the package in the current directory from its `package.json` plus an
optional `effected.toml`; a package with neither needs no config. The
`[package.build]` table holds `format`, `externals`, `bundle`, `bundledPackages`,
`dtsExternals`, `bundleNodeModules`, `minify`, `emitDts`, `define`, `plugins`
(module paths exporting a rolldown plugin), `overrides`, `looseFiles`, `jsx`,
`manifest.drop`, `meta` and `exe`; `[package.tsdoctor]` shapes the emitted
`tsdoctor.json`. `meta.tsdoc.suppressWarnings` defaults to
`[{ messageId = "ae-forgotten-export", pattern = "_base" }]` and
`meta.optimistic` previews the next versions from pending changesets. Config is
found at `<root>/.config/effected.toml`, `<root>/effected.toml`,
`<pkg>/.config/effected.toml`, `<pkg>/effected.toml` and
`<pkg>/lib/configs/effected.toml`, later winning; root defaults merge under the
package's (objects per key, arrays replace).

Artifacts land in `dist/prod/<group>/{pkg,meta}` with `dist/prod/targets.json`
and `dist/prod/issues.json` beside them; each build also appends to
`.cache/effected/build.jsonl` and `issues.jsonl` at the workspace root. **Read
`issues.json`'s `buildOk` first**: a crashed build can leave every bucket empty.
`--no-exe` skips the single-executable compile; `--verbose` measures gzip sizes.

Exit codes: `0` built; `1` the build failed or recorded an error; `2` the config
or a plugin would not load, or the directory is not a package; `3` a file could
not be read or written; `64` usage error.

## `effected action build`

```text
effected action build [--no-validate] [--no-persist] [--format=human|json]
```

Bundles a GitHub Action on rolldown from the `[action]` tables of `effected.toml`:
`entries` (`main` `src/main.ts`; `pre`, `post`, `workers` optional), `build`
(`minify` true, `sourceMap` false, `externals`, `ignore`, `importCheck` true),
`validation` (`requireActionYml` true, `maxBundleSize`, `strict`) and
`persistLocal` (`enabled` true, `path` `.github/actions/local`, `actTemplate`
true). Each entry becomes one self-contained ESM file at `dist/<entry>.js`; a
computed `import()` stays native. `ignore` aliases a package to a throwing stub.
Unless `importCheck = false`, each bundle is then imported in an isolated
temporary directory with no `PATH`, which runs an action that has no
`GITHUB_ACTIONS` guard. Exit `1` on validation errors or a failed entry; a missing
`[action]` table or an unloadable config is `2`.
