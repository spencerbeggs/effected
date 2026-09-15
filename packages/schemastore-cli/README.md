# @effected/schemastore-cli

[![npm](https://img.shields.io/npm/v/@effected%2Fschemastore-cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/schemastore-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The `schemastore` command: build and check SchemaStore-shaped JSON Schema documents from a `schemastore.config.ts`. It is the command-line companion to [`@effected/schemastore`](https://www.npmjs.com/package/@effected/schemastore), which owns the pipeline; this package ships the plumbing every consumer used to write by hand — flag parsing, the contract gate, the drift test — once, as a `bin`.

It is not a library: nothing is importable from it. Every type a config file needs comes from `@effected/schemastore`, which the CLI declares as a peer so your config and the pipeline share one `effect` and one `@effected/schemastore` instance.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

`@effected/schemastore` and `@effected/schemastore-cli` release together at one version; install them at the same version.

```bash
npm install --save-dev @effected/schemastore-cli @effected/schemastore effect
```

```bash
pnpm add -D @effected/schemastore-cli @effected/schemastore effect
```

## Configure

Create `schemastore.config.ts` (also `.mts`, `.js`, `.mjs`). The CLI finds it by walking upward from the working directory, or takes its path as a positional argument. Relative `path` values resolve against the config file's directory.

```ts
import { defineConfig } from "@effected/schemastore";
import { OkfitConfig } from "./src/config-schema.js";

export default defineConfig({
 outputDir: "schemas",
 baseUrl: "schemastore",
 schemas: {
  okfit: {
   schema: OkfitConfig,
   versions: ["1.0"],
   published: true,
   catalog: { description: "okfit configuration", fileMatch: ["okfit.toml", ".okfit.toml"] },
  },
 },
});
```

A second label is appended to `versions` only once the first is published
and its file already exists on disk — see "The lifecycle" in the
`building-schemastore-schemas` skill's `drift-and-versioning.md` reference.
A first-run config should declare a single label; naming an extra one before
its file exists fails the build with `FrozenVersionMissingError`.

`schemas` is keyed by file base name — the key IS the schema's `name`, and `$id`, the write `path` and every catalog URL derive from it, `outputDir` and `baseUrl`; there is no `$id` override. `versions` lists every label the catalog advertises; `current` (default: the newest) is the one generated at `path`/`$id`, and every other label becomes a **frozen** file the CLI verifies still exists on disk but never regenerates — advertising a frozen label with nothing on disk fails the build before anything is written. `published` (default `false`) marks a version other people already depend on. `baseUrl: "schemastore"` expands `$id` to `https://json.schemastore.org/…` and the catalog URL to `https://www.schemastore.org/…`; any other value is one `https://` base for both. `outputDir` and `onDrift` are top-level only; `baseUrl` and `drift` are top-level defaults an entry may override. `catalog` is required under `baseUrl: "schemastore"` and optional under a custom host. Every schema's declared `catalog` entry lands in ONE file at `catalogPath` (default `<outputDir>/catalog.json`) — never one file per schema.

Then add two scripts:

```json
{
 "scripts": {
  "schema:build": "schemastore build",
  "schema:check": "schemastore check"
 }
}
```

## Commands

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
```

- Before anything is generated, every advertised frozen version is checked for existence — a schema that advertises a label with nothing on disk fails with `FrozenVersionMissingError` (exit `1`) and nothing is written.
- `build` generates every schema, runs the gates (structural lints and ajv strict mode), applies the drift policy, and writes what passes — content-compared, so unchanged files are untouched — along with the single `catalog.json` every declared catalog entry lands in.
- `check` is the identical walk with no writes: it reports what `build` would do under the same flags and exits under the same conditions. It is the CI gate, so it also fails (exit `1`) whenever a build would write anything — a committed schema or catalog file that differs from what the config generates, or is missing, is stale; run `schemastore build` and commit the result.
- `--drift` and `--on-drift` override the config's `drift` block for one run; `--force` is sugar for `--drift=allow` and nothing else — combined with an explicit non-`allow` `--drift` it is a usage error (exit 64), not a precedence question; `--force --drift=allow` is accepted.
- `--format=json` emits one JSON document on stdout (config path, per-schema outcome and effective drift tolerance, the single catalog entry's outcome, and `drift: { onDrift, policy? }` — `policy` present only when a flag forced one tolerance over every schema's own); human text moves to stderr.
- When `GITHUB_STEP_SUMMARY` is set, both commands append a markdown summary table.

An unpublished schema is never drift: a contract change at a pinned but unpublished version rewrites the file in place.

## Exit codes

| code | meaning |
| ---- | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error` (the error lists one line per drifting schema: `$id`, change, current and next version), a gate failure, a missing frozen version (`FrozenVersionMissingError`), or — for `check` — any document `build` would write |
| 2 | config not found, failed to load, or failed `SchemastoreConfig` validation |
| 3 | infrastructure failure |
| 64 | usage error |

## License

MIT
