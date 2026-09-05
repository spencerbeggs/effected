# @effected/spdx

## 0.6.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.0

### Features

#### `License` catalog metadata

- `License` gains four derived getters, backed by a new generated vendored
  dataset:

- `referenceUrl` — the canonical SPDX web page (`Option`, `none` for a&#10;`LicenseRef`/`DocumentRef`)

- `name` — the license's full title, e.g. `"MIT License"` for `MIT`&#10;(`Option`, `none` for a `LicenseRef`/`DocumentRef`)

- `osiApproved` — whether the OSI has approved the license

- `fsfLibre` — whether the FSF lists the license as libre

- Schema fields are unchanged, so encoded shape and structural equality are
  untouched.

#### `SpdxExpression` license reads

- `primaryLicense` — the single license an expression can be said to be
  under, when there is one. Deliberately `Option.none()` for an `AND`&#10;expression — a conjunction has no single license, and picking one would
  silently drop a term that legally applies.
- `licensesOf` — every license an expression names, in written order,
  de-duplicated by identifier. [#539][#539]

```ts
import { SpdxExpression } from "@effected/spdx";

// "(MIT OR Apache-2.0)"  => Option.some(License("MIT"))
// "(MIT AND Apache-2.0)" => Option.none()
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#539]: https://github.com/spencerbeggs/effected/pull/539

## 0.4.0

### Features

- `SpdxExpression` now accepts `WITH` exceptions on a `LicenseRef`/`DocumentRef` reference, matching the SPDX ABNF's `simple-expression` production. `LicenseRef-Foo WITH Bison-exception-2.2` and `DocumentRef-tool-1.2:LicenseRef-Foo WITH Bison-exception-2.2` now parse instead of being rejected.
  ```ts
  import { SpdxExpression, WithExceptionNode, LicenseRefNode } from "@effected/spdx";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const expr = yield* SpdxExpression.parse("LicenseRef-Foo WITH Bison-exception-2.2");
    return expr instanceof WithExceptionNode && expr.license instanceof LicenseRefNode;
  });

  console.log(Effect.runSync(program));
  // => true
  ```
  `WithExceptionNode.license` is now typed as `LicenseNode | LicenseRefNode` to reflect the widened grammar. The exception must still be a cataloged SPDX exception id, and `LicenseRef-Foo+` (a `+` on a reference) is still rejected. [#400][#400]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#400]: https://github.com/spencerbeggs/effected/pull/400

## 0.3.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.2.0

### Bug Fixes

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `SpdxExpression`'s internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.1.2

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.1.0

### Features

- ### New package: SPDX license identifiers, exceptions and expressions as Effect schemas
  `@effected/spdx` models SPDX license identifiers, license exceptions and the full compound-license expression grammar as Effect Schema classes, backed by the official SPDX datasets vendored as devDependency-generated TypeScript so there is no runtime data dependency. It ships free-standing `License` and `LicenseException` catalogs, a from-scratch expression parser hardened with depth limits, codecs, and a typed error channel — a malformed expression fails as a typed error, never a defect.

  The parser is verified against `spdx-expression-parse` as an oracle for compatibility, and exposes a sync `isValidExpression` predicate alongside its Effect surface.
  ````ts
  import { SpdxExpression } from "@effected/spdx";
  import { Effect } from "effect";

  const parsed = Effect.runSync(SpdxExpression.parse("(MIT OR Apache-2.0) AND BSD-3-Clause"));
  ``` Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````
