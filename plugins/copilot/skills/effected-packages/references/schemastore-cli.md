# @effected/schemastore-cli

The `schemastore` command: a bin-only companion to `@effected/schemastore` that loads a `schemastore.config.ts`, builds or checks every schema and catalog entry it declares under a per-schema `published` flag and a drift policy, and reports to a terminal, JSON or a GitHub step summary. **Integrated tier** — it runs under `effect/unstable/cli`'s `Command.Environment`, loads consumer TypeScript through `jiti`, and touches the real filesystem. Nothing is importable from it: every type a config file needs comes from `@effected/schemastore`.

For the end-to-end procedure — writing the config, deciding `published`, wiring the CI gate, retiring a hand-rolled generator script — load the `building-schemastore-schemas` skill. This reference is the package's contract.

## Install

```sh
pnpm add -D @effected/schemastore @effected/schemastore-cli
```

`effect` and `@effected/schemastore` are **peers** of the CLI, and the two `@effected` packages release as a fixed pair at one version. That is what keeps the consumer's config and the CLI's pipeline on ONE `effect` and ONE `SchemaTarget` class: a `SchemaTarget` constructed in the config must be the class the pipeline pattern-matches, and a schema's annotation symbols must be the ones `Schema.toJsonSchemaDocument` reads. Never vendor or bundle either.

## The config module

```ts
import { defineConfig, SchemaTarget } from "@effected/schemastore";
import { MyConfig } from "./src/schema/my-config.js";

export default defineConfig({
 schemas: [
  SchemaTarget.make({
   schema: MyConfig,
   $id: "https://example.com/schemas/my-config-1.0.json",
   name: "my-config",
   version: "1.0",
   path: "schemas/my-config-1.0.json",
   published: false,
   jsonSchema: { onExcessProperty: "error" },
  }),
 ],
 catalog: [
  {
   name: "my-config",
   description: "Configuration for my tool",
   fileMatch: ["my-config.json", ".config/my-config.json"],
   baseUrl: "https://example.com/schemas",
   path: "schemas/catalog-entry.json",
  },
 ],
 drift: { policy: "semantic", onDrift: "error" },
});
```

- Discovered as `schemastore.config.{ts,mts,js,mjs}` walking upward from the working directory, or named by the optional positional argument. Loaded through `jiti` **relative to the config file**, so `./x.js` specifiers resolve to `.ts` sources and `effect` resolves from the consumer's own `node_modules`.
- Relative `path` values — on schemas and catalog entries alike — resolve against the **config file's directory**, never the working directory.
- `catalog[].versions` is derived from every versioned schema of that name, published or not, as `<baseUrl>/<name>-<version>.json`. **Each versioned schema's `$id` must equal that derived URL** — the CLI does not cross-check them, and a `$id` under a versioned subdirectory yields a catalog entry whose URLs resolve to nothing.
- `drift` is the default for published schemas; the flags below override it for one run.

## Commands

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=…] [--on-drift=…] [--force] [--format=human|json]
```

- **`build`** generates, gates (structural lint + ajv strict mode), applies the drift table, and writes what passes — content-compared, so an unchanged or merely reformatted file is untouched — then the catalog entries the same way. When any schema fails the gate, or drifts under `onDrift: "error"`, **nothing is written** and every otherwise-writable schema reports `held`.
- **`check`** is the identical walk with no writes: it reports exactly what `build` would do under the same flags (`would write`, `unchanged`, `DRIFT`, `held`, `GATE FAILED`) and exits under the same conditions — and, as the CI gate, it also exits `1` whenever a build would write anything (`StaleError`: ``N document(s) are stale; run `schemastore build` and commit the result.``), evaluated after the gate and drift verdicts. It replaces a hand-written drift test.
- **`--force`** is `--drift=allow` for one run, announced loudly; it never overrides a gate failure.
- **`--format=json`** emits one document on stdout — config path, effective drift policy with its `source` (`config` | `flag`), per-schema `{ $id, path, name?, version?, published, change, verdict, outcome, nextVersion?, findings }`, per-catalog-entry outcome, `drifted`, `gateFailed`, `wrote` — and moves every human line to stderr.
- When `GITHUB_STEP_SUMMARY` is set (read through Effect `Config`), both commands append a markdown table and the drift verdict; a failure to write it is logged, never fatal.

## Drift

| published | policy | `none` / `created` | `annotations` | `contract` |
| ----------- | ------------ | -------------------- | --------------- | --------------------- |
| `false` | any | write | write | write |
| `true` | `allow` | write | write | write, loud warning |
| `true` | `semantic` | write | write | **drift** |
| `true` | `strict` | write | **drift** | **drift** |

`onDrift: "error"` refuses every write and exits 1, naming each drifting schema, its change class and the suggested next label; `onDrift: "warn"` writes anyway and exits 0 — the posture for an automated dependency-bump workflow. An unpublished schema is never drift: it regenerates in place until someone depends on its label. The change classes are `@effected/schemastore`'s `DocumentDiff` verdicts (`default` / `examples` / `readOnly` / `writeOnly` are **contract**, not documentation).

## Exit codes

| code | meaning |
| ------ | --------- |
| 0 | success, including drift under `onDrift: "warn"` |
| 1 | drift under `onDrift: "error"`, a gate failure, or — for `check` — any document `build` would write |
| 2 | config not found, failed to load, or not a `defineConfig(...)` value |
| 3 | infrastructure failure |
| 64 | usage error |

A bare `schemastore` or `--help` exits 0.
