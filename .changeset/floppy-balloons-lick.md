---
"@effected/app": minor
"@effected/claude-code-plugin": minor
"@effected/cli": minor
"@effected/commands": minor
"@effected/config-file": minor
"@effected/copilot-plugin": minor
"@effected/git": minor
"@effected/github": minor
"@effected/github-actions": minor
"@effected/github-references": minor
"@effected/glob": minor
"@effected/jsonc": minor
"@effected/jsonl": minor
"@effected/lockfiles": minor
"@effected/markdown": minor
"@effected/memfs": minor
"@effected/npm": minor
"@effected/package-json": minor
"@effected/pnpm-plugin-effect": minor
"@effected/runtimes": minor
"@effected/sbom": minor
"@effected/schema-org": minor
"@effected/schemastore": minor
"@effected/semver": minor
"@effected/spdx": minor
"@effected/store": minor
"@effected/templates": minor
"@effected/toml": minor
"@effected/tsconfig-json": minor
"@effected/walker": minor
"@effected/workspaces": minor
"@effected/xdg": minor
"@effected/yaml": minor
---

## Breaking Changes

### `@effected/schemastore` no longer ships `AnnotationCarriers`

`AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

### `StoreDocument` and `SchemaPipeline` error channels are wider

`StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

## Features

### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

`StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

### The whole kit tracks Effect `4.0.0-rc.112`

Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

## Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

## Documentation

### The Claude Code and Copilot plugins are Effect v4 only

The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest.

## Dependencies

| Dependency | Type | Action | From | To |
| :--- | :--- | :--- | :--- | :--- |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
