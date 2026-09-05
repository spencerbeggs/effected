# @effected/schema-org

## 0.2.0

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

## 0.1.0

### Features

- Initial release. schema.org vocabulary as Effect Schema classes, with a&#10;`JsonLdDocument` graph assembler, a script-safe serializer, and offline
  conformance validation against a vendored schema.org v30.0 vocabulary.

```ts
import { JsonLdDocument, NodeRef, SoftwareSourceCode, TechArticle } from "@effected/schema-org";
import { Result } from "effect";

const built = JsonLdDocument.buildResult([
  SoftwareSourceCode.make({ "@id": "https://example.com/pkg#source", name: "example", version: "1.2.3" }),
  TechArticle.make({
    "@id": "https://example.com/pkg/docs#intro",
    headline: "Getting started </script>",
    isPartOf: [NodeRef.to("https://example.com/pkg#source")],
  }),
]);

console.log(Result.getOrThrow(built).toScriptBody());
```

- `toScriptBody()` is the only text serializer, and it escapes `<`, `>` and `&`&#10;after stringify — `JSON.stringify` does not escape `<`, so a description
  containing a literal `</script>` would otherwise close the JSON-LD block early
  and inject markup into the page.

- Six node classes ship from the root entrypoint: `SoftwareSourceCode`,&#10;`TechArticle`, `APIReference`, `Person`, `Organization`, `CreativeWork`, plus&#10;`NodeRef`/`NodeId`/`JsonLdDocument`.

#### Offline conformance validation

- Offline conformance checking against the vendored vocabulary lives behind a
  separate `./validate` subpath, so a consumer that only builds and serializes
  graphs never pays for the \~75 KB vocabulary table:

```ts
import { Conformance, Vocabulary } from "@effected/schema-org/validate";

console.log(Vocabulary.version); // "30.0"
for (const issue of Conformance.check(doc)) console.error(issue._tag, issue.message);
```

- `Conformance.check` reports `UnknownTerm`, `PropertyNotOnType`,&#10;`DeprecatedType`, `DeprecatedProperty` and `DanglingReference` issues;&#10;`Conformance.validate`/`validateResult` gate on the structural kinds by
  default and raise `NonConformantGraphError`. [#539][#539]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#539]: https://github.com/spencerbeggs/effected/pull/539
