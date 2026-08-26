# @effected/schema-org

schema.org vocabulary as Effect Schema classes, a `JsonLdDocument` that assembles them into one JSON-LD document, a script-safe serializer, and offline conformance validation against the vendored vocabulary.

**Pure tier:** `dependencies: {}`, peer-depends on `effect` only, no IO, `"sideEffects": false`. The vendored vocabulary is a compiled TypeScript literal, never a file read — if validation ever needed to *fetch* the vocabulary this would become a boundary package. Never add a filesystem, network or clock dependency.

**Design doc:** `@../../.claude/design/effected/packages/schema-org.md` — load before changing the public surface, the node vocabulary, the serializer or the vendored dataset.

## The one invariant

**Every string in a graph originates in author-written TSDoc, and `JSON.stringify` does not escape `<`.** A description containing the literal `</script>` closes the JSON-LD block early and injects markup. `JsonLdDocument.toScriptBody()` escapes `<`, `>` and `&` after stringify; there is deliberately **no unescaped text serializer**, because the escaped form is semantically identical to every parser and a second entry point could only be chosen wrongly.

`toJsonLd()` returns the wire *value* and carries the loudest TSDoc in the package: **never `JSON.stringify` it into a page.** It exists because `Schema.encode(JsonLdDocument)` is public regardless, so naming it is the only way to attach the warning.

The `__test__/serializer.test.ts` fixture is mandatory and includes a **positive control** asserting `JSON.stringify` of the same graph *does* contain `</script>`. Without it the escaping assertions pass against an empty graph or a stubbed serializer.

## Two entrypoints

- `.` — node classes, `NodeRef`, `JsonLdDocument`. Loads no vocabulary data.
- `./validate` (`src/conformance-entry.ts`) — `Vocabulary`, `Conformance`, and the only path reaching `src/internal/vocabulary.ts` (~73 KB).

`__test__/entrypoints.test.ts` asserts the boundary structurally, with a positive control — review cannot enforce it, since one convenience import would silently undo it and nothing would fail.

**A subpath export key must not differ from a module name only in case.** `"./conformance"` + `src/Conformance.ts` emits `Conformance.d.ts` and `conformance2.d.ts`, and API Extractor's entry `conformance.d.ts` resolves case-insensitively onto the *module*, producing a CI-fatal `ae-forgotten-export` for `JsonLdDocument`. The subpath is `./validate` for that reason. The same collision at the source layer is a TS1149 error, which is why the entry file is `conformance-entry.ts` rather than `conformance.ts`.

## Conventions and gotchas

- **`Schema.optional`, not `Schema.optionalKey` — a scoped exception, not a kit-wide precedent.** Every field originates in a possibly-absent TSDoc tag, so `optionalKey` would make every call site a wall of conditional spreads. Explicit `undefined` is legal and the key is dropped at serialization, which is required anyway: JSON-LD has no undefined and no meaningful null.
- **No schema inheritance.** `APIReference` does not extend `TechArticle`. The `rdfs:subClassOf` chain lives in the vendored vocabulary — the thing the validator reads — and duplicating it in TypeScript would give two sources of truth. Shared fields are spread from the `@public` records `ThingFields`, `CreativeWorkFields`, `TechArticleFields`.
- **One arity per property, always the wire shape.** No `T | ReadonlyArray<T>` anywhere. A repeatable property is always an array, even at length one, which is identical to a scalar in the JSON-LD data model. Where arity is uncertain the choice is **many**, because the error costs are asymmetric: wrong toward many costs one pair of brackets, wrong toward one costs a breaking change. `mainEntity` is singular **by schema.org's own definition** — that collapse is not ours to revisit.
- **Node-valued properties hold a `NodeRef`, never an embedded node.** The package declines the inline form at the type level rather than silently flattening one representation into the other.
- **`additional` is the catch-all and the reason the validator is not tautological.** Typed fields are correct by construction; the catch-all is the one door an undefined-on-this-type property can enter through. It is flattened into the node at serialization — a key colliding with a typed field, `@id` or `@type` fails at `JsonLdDocument.buildResult`.
- **Identity is validated at graph assembly, not node construction.** `NodeRef.to` and every `make` are total; `JsonLdDocument.buildResult` raises `InvalidNodeIdError`, `DuplicateNodeIdError` and `ConflictingTermError` on the `E` channel. The `@id` rule is deliberately loose (non-empty, no whitespace, no control characters) because absolute IRIs, `_:blank` and fragments are all legal.
- **A dangling reference is not an error** — it is how a node points at something described on another page. `JsonLdDocument.danglingReferences` reports them so a closed-world consumer can gate; the package refuses to decide whether your graph is closed.
- **The decode direction is declared unimplemented.** Decoding the wire form **succeeds and silently drops the catch-all**, because a flattened term is an excess key — a half-working round trip, which is worse than a failing one. `__test__/JsonLdDocument.test.ts` pins that asymmetry so it cannot start half-working by accident.
- **The vocabulary table's index rows are comma-joined strings (`"12,44,90"`), not nested number arrays — do not "tidy" them.** A long nested array is re-wrapped by Biome at 120 columns, so the generator and the formatter would fight forever and the file would never be a fixpoint; a string literal is one Biome cannot break, and it is smaller. Rows decode lazily and memoize per type index.
- **The generator lives at `lib/scripts/generate-data.ts`**, which is where this repo keeps package-local tooling that is not shipped source (`packages/runtimes/lib/scripts/generate-defaults.ts` is the precedent; spdx's `scripts/` placement is the inconsistent one). Its input is the `-current` vocabulary document committed at `lib/data/schemaorg-current-https.jsonld` (release v30.0), and bumping the vocabulary means replacing that file and re-running the generator in the same commit. It is committed rather than submoduled because the upstream repo is 254 MB and this is the single release file we read from it. Hand-run, idempotent, and it **asserts rather than assumes**: every `domainIncludes` target must resolve, every parent must resolve or carry a prefix the document's own `@context` declares, every interned index must be in range. The upstream document is data, not truth — at v30.0 three properties name a class `-current` never declares, and those drops are recorded in the generated header.
- **A prefixed term is resolved three ways, and two of them are easy to get silently wrong.** `schema:license` is native and validates identically to `license`; a prefix the vocabulary document's `@context` declares (`gs1:`, `fibo-…`) is skipped in silence; an undeclared prefix (`bogus:`) is **reported**. A "has a colon, skip it" rule stops validating everything a consumer writes in prefixed form — a validator answering a question it never evaluated.
- `package.json` stays `"private": true`. The bundler emits the publishable manifest.

## Test and build

```bash
pnpm vitest run packages/schema-org        # this package's tests
pnpm build --filter @effected/schema-org   # dev + prod, from the repo root
```

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — **never `expect`**.

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. A clean build log does not prove a build ran either — a turbo cache hit replays the previous output, so check `dist/prod/issues.json`'s `generatedAt` postdates your last edit.

Inline class factories synthesize `_base` heritage symbols; `savvy.build.ts` suppresses `ae-forgotten-export` narrowly on that pattern. Never widen it — an internal type named on a `@public` signature is genuine surface and must be exported or inlined.
