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
import { defineConfig, SchemaTarget } from "@effected/schemastore";
import { ReleaseOutput, SCHEMA_URL } from "./src/schema/release-output.js";

export default defineConfig({
 schemas: [
  SchemaTarget.make({
   schema: ReleaseOutput,
   $id: SCHEMA_URL,
   name: "silk-release-action",
   version: "5.0",
   path: "schemas/5.0/silk-release-action-5.0.json",
   published: true,
   jsonSchema: { onExcessProperty: "error" },
  }),
 ],
 catalog: [
  {
   name: "silk-release-action",
   description: "Structured output of the silk-release GitHub Action",
   fileMatch: ["silk-release-output.json"],
   baseUrl: "https://raw.githubusercontent.com/savvy-web/silk-release-action/main/schemas",
   path: "schemas/catalog-entry.json",
  },
 ],
 drift: { policy: "semantic", onDrift: "error" },
});
```

- `schemas` — at least one `SchemaTarget`; `published` (default `false`) marks a version other people depend on.
- `catalog` — zero or more SchemaStore catalog entries; `versions` is derived from every versioned schema of that name.
- `drift` — the default policy for published schemas (`strict`, `semantic` or `allow`) and what drift means (`error` or `warn`). Defaults to `{ policy: "semantic", onDrift: "error" }`.

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

- `build` generates every schema, runs the gates (structural lints and ajv strict mode), applies the drift policy, and writes what passes — content-compared, so unchanged files are untouched — along with each catalog entry.
- `check` is the identical walk with no writes: it reports what `build` would do under the same flags and exits under the same conditions. It is the CI gate.
- `--drift` and `--on-drift` override the config's `drift` block for one run; `--force` is sugar for `--drift=allow`.
- `--format=json` emits one JSON document on stdout (config path, per-schema outcome, per-catalog-entry outcome, effective drift policy and its source); human text moves to stderr.
- When `GITHUB_STEP_SUMMARY` is set, both commands append a markdown summary table.

An unpublished schema is never drift: a contract change at a pinned but unpublished version rewrites the file in place.

## Exit codes

| code | meaning |
| ---- | -------------------------------------------------------------------------- |
| 0 | success, including drift under `onDrift: warn` |
| 1 | drift under `onDrift: error`, or a gate failure |
| 2 | config not found, failed to load, or failed `SchemastoreConfig` validation |
| 3 | infrastructure failure |
| 64 | usage error |

## License

MIT
