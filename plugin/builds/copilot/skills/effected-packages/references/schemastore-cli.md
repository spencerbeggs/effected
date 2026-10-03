# @effected/schemastore-cli

The `schemastore` command: a companion to `@effected/schemastore` that loads a `schemastore.config.ts`, builds or checks every schema and catalog entry it declares under a per-schema `published` flag and a drift policy, validates a payload against a published document, and reports to a terminal, JSON or a GitHub step summary. **Companion — no tier** (like `pnpm-plugin-effect`): it runs under `effect/cli`'s `Command.Environment`, loads consumer TypeScript through `jiti`, and touches the real filesystem. Every type a config file needs comes from `@effected/schemastore`; the only things importable from THIS package are engine layers over the library's contracts — `AjvValidator.layer`, the shipped ajv strict-mode `SchemaValidator` engine (documents), and `AjvInstanceValidator.layer`, the shipped `InstanceValidator` engine (payloads) — which the commands compose at their edges, exported so a program driving `SchemaPipeline` or validating payloads itself can get the same verdicts, and housed here so `ajv` is a cost only the (dev-installed) command pays, never the library's runtime importers.

For the end-to-end procedure — writing the config, deciding `published`, wiring the CI gate, retiring a hand-rolled generator script — load the `building-schemastore-schemas` skill. This reference is the package's contract.

## Install

```sh
pnpm add -D @effected/schemastore @effected/schemastore-cli
```

`effect` and `@effected/schemastore` are **peers** of the CLI, and the two `@effected` packages release as a fixed pair at one version. That is what keeps the consumer's config and the CLI's pipeline on ONE `effect` and ONE `SchemaTarget` class: a `SchemaTarget` constructed in the config must be the class the pipeline pattern-matches, and a schema's annotation symbols must be the ones `Schema.toJsonSchemaDocument` reads. Never vendor or bundle either.

## The config module

```ts
import { defineConfig } from "@effected/schemastore";
import { MyConfig } from "./src/schema/my-config.js";

export default defineConfig({
 name: "my-config",
 outputDir: "schemas",
 baseUrl: "https://example.com/schemas",
 schemas: {
  "my-config": {
   schema: MyConfig,
   versions: ["1.0"],
   published: false,
   jsonSchema: { onExcessProperty: "error" },
   catalog: { description: "Configuration for my tool", fileMatch: ["my-config.json", ".config/my-config.json"] },
  },
 },
 drift: "semantic",
 onDrift: "error",
});
```

- Discovered as `schemastore.config.{ts,mts,js,mjs}` walking upward from the working directory, or named by the optional positional argument. Loaded through `jiti` **relative to the config file**, so `./x.js` specifiers resolve to `.ts` sources and `effect` resolves from the consumer's own `node_modules`.
- `name` is required: the config's identity, the base name of its catalog slice `<catalogDir>/<name>.json` (`catalogDir` defaults to `<outputDir>/catalogs`). The command also maintains the merged `catalog.json` in `catalogDir`'s parent — the union of every slice there, sorted by `url` — so several configs can share one `outputDir` and all check green; a `url` or entry `name` advertised twice, or an invalid slice, fails both commands (`CatalogMergeError`, exit `1`). A schema's `catalog` block may set `name` — the entry's display name, defaulting to the key, which still names the file and URL; `defineConfig` rejects two schemas of one config resolving to one catalog name.
- `schemas` is keyed by file base name — the key IS the schema's `name`. Relative `outputDir`, `catalogDir` and every derived schema/frozen `path` resolve against the **config file's directory**, never the working directory.
- `$id`, the write `path` and every catalog URL are derived from ONE layout (`outputDir`/`baseUrl`, this entry's or the config's default `baseUrl`, and `layout`), so they cannot disagree with each other — there is no `$id` override. A first-run config declares a single `versions` label; a second is appended only once the first is published and its file already exists on disk.
- `drift` is a top-level default an entry may override; `onDrift` is top-level and run-wide, never overridable per schema. Together they default to `{ policy: "semantic", onDrift: "error" }`; the flags below override the effective policy for one run.

## Commands

```text
schemastore build [config] [--drift=strict|semantic|allow] [--on-drift=error|warn] [--force] [--format=human|json]
schemastore check [config] [--drift=…] [--on-drift=…] [--force] [--format=human|json]
schemastore validate <payload.json> [config] [--schema <path|$id|url>] [--format=human|json]
```

- **`build`** generates, gates (structural lint + ajv strict mode), applies the drift table, and writes what passes — content-compared, so an unchanged or merely reformatted file is untouched — then the catalog entries the same way. When any schema fails the gate, or drifts under `onDrift: "error"`, **nothing is written** and every otherwise-writable schema reports `held`.
- **`check`** is the identical walk with no writes: it reports exactly what `build` would do under the same flags (`would write`, `unchanged`, `DRIFT`, `held`, `GATE FAILED`) and exits under the same conditions — and, as the CI gate, it also exits `1` whenever a build would write anything (`StaleError`: ``N document(s) are stale; run `schemastore build` and commit the result.``), evaluated after the gate and drift verdicts, or when an output nothing claims sits on disk — an orphaned catalog slice no schema declares (or a merged `catalog.json` with no slice left), or a document left behind at a sibling shape of a derived path (`<name>.json`, `<name>-<v>.json`, `<v>/<name>.json`, `<v>/<name>-<v>.json` — an `appendVersion` flip or a `layout` change moved it) that no target, frozen version, catalog slice or merged catalog names; nothing else in `outputDir` is looked at, so a shared or deploy directory is safe unless two configs derive one schema name and version under different layouts into it; `build` reports both and deletes neither — delete by hand. It replaces a hand-written drift test.
- **`--force`** is `--drift=allow` for one run, announced loudly; it never overrides a gate failure. Combined with an explicit non-`allow` `--drift` (`strict` or `semantic`) it is refused as a usage error (`ConflictingFlagsError`, exit `64`) before the config loads — a contradiction, not a precedence question; `--force --drift=allow` is redundant and accepted.
- **`validate`** answers the question the publication story exists for: does THIS payload conform to the published document it names? The reference is `--schema` or the payload's own `$schema`, resolved file-first and then against every identity a config schema derives (a target `$id`, a frozen version's `$id`/`url`, the catalog `url`) — CI validates an action's output against the committed document with no third-party tool and no network fetch. The payload's `$schema` self-reference is the pointer naming the document: it is stripped before validating ONLY when the resolved document does not declare `$schema` as a root property (a generated document sets `additionalProperties: false`, which would otherwise reject the very self-reference that names it); a document that DOES declare `$schema` — the `HostedSchema` pattern, where the source struct carries `$schema: Schema.Literal(...)` and the generated document requires and const-constrains the key — validates the payload verbatim. A non-conforming payload exits `1`, one finding per problem with the JSON pointer into the instance and the keyword; `--format=json` writes one report document to stdout and moves the human lines to stderr.
- **`--format=json`** emits one document on stdout — `mode`, `configPath`, `drift: { onDrift, policy? }` (`policy` present only when a flag forced one tolerance over every schema's own), per-schema `{ $id, path, name, version?, published, change, verdict, policy, outcome, nextVersion?, frozen?, findings }`, one optional `catalog: { slice?, merged? }` — `slice: { path, entries, outcome, caseFoldedMatch? }` for this config's `<catalogDir>/<name>.json` (outcome `written` | `unchanged` | `would-write` | `held` | `orphaned`; `caseFoldedMatch` is the on-disk path claimed when the volume resolved `<name>.json` to a file differing only in case) and `merged: { path, entries, outcome, slices, conflicts?, invalid? }` for the merged `catalog.json` (outcomes add `blocked`; `slices` lists every slice merged, `conflicts: [{ kind: "url", url, slices } | { kind: "name", name, slices }]` and `invalid: [{ path, reason }]` appear only when non-empty), one optional `orphaned: string[]` of leftover document paths in config order, `drifted`, `gateFailed`, `wrote` — and moves every human line to stderr.
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

The command runs under `CliRuntime.main` (`exitCode: 3`, `env.appModule`), so a failure is the `@effected/cli` standard report on stderr: a status line naming the error and its message (`✗ DriftError: 1 published schema(s) drifted; nothing was written.`), the message's further lines, and an `in:` trail of the command's own spans when the failure happened inside one (a missing config prints none), painted for a person, plain for an agent, the log form under GitHub Actions. Gate on the exit code and the error's text, never on the line's leading characters.

| code | meaning |
| ------ | --------- |
| 0 | success, including drift under `onDrift: "warn"` |
| 1 | drift under `onDrift: "error"`, a gate failure, a merged catalog blocked by a URL or name conflict or an invalid slice, — for `check` — any document `build` would write or an output nothing claims (an orphaned catalog slice, merged catalog or document), or — for `validate` — a payload that does not conform to the resolved document |
| 2 | config not found, failed to load, not a `defineConfig(...)` value, a `catalogDir` that is a file or cannot be listed, or — for `validate` — a payload that cannot be read or parsed, or a schema reference that resolves to no readable document |
| 3 | infrastructure failure (for `validate`, an engine mechanism failure — a document the instance engine cannot compile — included) |
| 64 | usage error (for `validate`, a payload with no `$schema` and no `--schema` given, included); `--wizard` is the kit's prompt-gated flag, so a run that is not interactive (a pipe, CI, an agent) leaves it out of help and rejects it at `64` (it was accepted at `0` before the command moved onto `CliRuntime.main`) |

A bare `schemastore` or `--help` exits 0.
