# @effected/glob

## 0.5.0

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

## 0.4.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.3.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.2.2

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.2.0

### Features

- ### Synchronous compilation: `GlobPattern.compileResult` and `GlobSet.compileResult`
  ```ts
  import { Result } from "effect";
  import { GlobPattern } from "@effected/glob";

  const compiled = GlobPattern.compileResult("packages/*");
  if (Result.isSuccess(compiled)) compiled.success.matches("packages/a");
  ```
  Both new statics return `Result<_, GlobPatternError>` instead of an `Effect`. Compiling a pattern or a pattern set is pure string→predicate work with no IO and no async step, so the sync form is now the primitive: `GlobPattern.compile` and `GlobSet.compile` are thin derivations of their sync counterparts, adding only the tracing span. Both `compile` signatures are unchanged.

  This removes the `Effect.runSync(Effect.result(...))` escape hatch that synchronous call sites — a lint-staged handler, a config predicate — were forced through for work that never actually needed an Effect runtime. [#125][#125]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#125]: https://github.com/spencerbeggs/effected/pull/125

## 0.1.2

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.1

### Documentation

- Documents on `GlobPattern.enumerationPrefix` (with a cross-reference on `crossesSegments`) that the getter is meaningful for non-negated patterns only. A negated pattern's prefix is still computed from the inner pattern while `matches` inverts the result, so the pattern can match paths outside its own `enumerationPrefix` — a consumer that bounds traversal to the prefix must guard on `negated` and deep-walk from the inner prefix instead. [#106][#106]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.1.0

### Features

- Full-fidelity glob matching as Effect schemas. The complete minimatch dialect — extglobs, `{a,b}` braces and sequences, character classes including POSIX classes, true `**` globstar, negation — compiled to pure string predicates, hardened against hostile input, with zero runtime dependencies. `GlobPattern.compile` is the one fallible entry point; once a `GlobPattern` exists, `matches` is total — pure, synchronous, no error channel, and no hostile pattern can make it overflow, allocate unboundedly or hang, because every guard fired before the instance was constructed.
  ### Compile once, match many
  `GlobSet.compile` builds include/exclude sets where a leading `!` is an exclusion filter. A compiled pattern also carries the metadata a directory enumerator needs to skip trees that cannot match.
  ```ts
  import { GlobPattern, GlobSet } from "@effected/glob";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
    const pattern = yield* GlobPattern.compile("packages/**");
    console.log(pattern.matches("packages/a/b/c"));
    // true — ** really crosses segment boundaries
    console.log(pattern.enumerationPrefix, pattern.crossesSegments);
    // "packages/" true

    const set = yield* GlobSet.compile(["packages/*", "!packages/internal"]);
    console.log(set.matches("packages/core"), set.matches("packages/internal"));
    // true false
  });

  Effect.runPromise(program);
  ```
  ### Embed patterns in config schemas
  `GlobPattern.FromString` is a `Schema.Codec<GlobPattern, string>` that validates compilability at decode time, so an uncompilable pattern fails as a schema issue before your program ever sees a `GlobPattern`.
  ```ts
  import { GlobPattern } from "@effected/glob";
  import { Schema } from "effect";

  const Config = Schema.Struct({
    include: Schema.Array(GlobPattern.FromString),
  });
  ```
  Compilation is the only thing that fails, and it fails with one tagged `GlobPatternError` whose `reason` names the guard that fired — `PatternTooLong`, `ExpansionBudgetExceeded` or `NestingDepthExceeded` — carrying `limit` and `actual` rather than a message you have to parse. Where upstream truncates an over-budget brace expansion (silently changing what the pattern matches), this package fails instead. `GlobPattern.escape` / `unescape` build patterns safely from user-supplied literals. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
