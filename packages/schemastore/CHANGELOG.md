# @effected/schemastore

## 0.1.1

### Documentation

* Added the package README, which ships in the published artifact.
* Corrected the package-documentation usage example so the lint advisory it
  describes actually fires against the shown output — the prior example's
  schema had no `description` at all, so the advisory it was meant to
  demonstrate never triggered. [#219][#219]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#219]: https://github.com/spencerbeggs/effected/pull/219

## 0.1.0

### Features

* ### Initial release

  `@effected/schemastore` builds, versions, validates and lints SchemaStore-shaped Draft-07 JSON Schema documents from Effect Schema sources.

  ```ts
  import { CatalogEntry, DocumentLint, StoreDocument } from "@effected/schemastore";
  import { Effect, Schema } from "effect";

  const Config = Schema.Struct({ name: Schema.String });

  const program = Effect.gen(function* () {
    const document = yield* StoreDocument.fromSchema(Config, {
      $id: "https://example.com/config.schema.json",
    });
    const findings = DocumentLint.lint(document);
    const text = yield* Effect.fromResult(document.serializeResult());
    return [findings.length, text.endsWith("\n")] as const;
  });
  ```

  It sits on top of core's own `Schema.toJsonSchemaDocument` + Draft-07 lowering and owns what core does not:

  * **`StoreDocument`** — assembles the SchemaStore publication shape (`$schema` + `$id` + root + `$defs`) and re-grafts the non-standard editor keyword families (the vscode five, plus `x-taplo`, `x-tombi-` and `x-intellij-` prefixes) that the Draft-07 lowering otherwise drops.
  * **`CatalogEntry`** — the `catalog.json` entry vocabulary, supporting both versioned and unversioned catalog modes, with fileMatch hygiene lints.
  * **`SchemaVersioning`** — a branded `SchemaVersion` with numeric (not lexical) ordering, so `1.10` sorts after `1.9`.
  * **`DocumentLint`** — a total structural lint (unresolved refs, unknown keywords, missing description URLs, excessive nesting) that never fails, only reports findings.
  * **`SchemaFile`** — write-if-changed file IO over `FileSystem`/`Path`, answering `"written" | "unchanged"` as a value.
  * **`SchemaValidator`** — a contract seam for real-engine validation (ajv or similar) that the consumer closes at the edge; this package ships no validation engine itself.
  * **`CanonicalJson`** — deterministic serialization (insertion-order keys, single trailing newline) with typed failures instead of `JSON.stringify`'s silent drops of `undefined`/`NaN`/non-plain values. [#215][#215]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.2.1 | 0.3.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215
