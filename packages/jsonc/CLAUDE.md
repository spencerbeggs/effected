# @effected/jsonc

Zero-dependency JSONC parse/edit/format schemas: parse into values or an AST, strip comments offset-preservingly, compute byte-minimal edits, format, modify by path, visit as a `Stream`.

**Tier: pure.** Peer-depends on `effect` only. Zero runtime deps, no IO. Second migration; merged. Public facades in `src/`, the engine in `src/internal/`, tests in `__test__/`.

**For the full design:** → `@../../.claude/design/effected/packages/jsonc.md`

Load when changing the public API, the error set, the hardening story, or the jsonc/yaml parity convention.

## Engine/facade split

The scanner, parser, navigator and limits in `src/internal/` are a **vendored engine** (~1,245 lines, ported with attribution to Microsoft's `jsonc-parser` design, MIT) — house policy for pure-tier format packages: vendor and attribute, never take a runtime dep.

The split is a **cycle firewall**, and `noImportCycles` is error-level. `src/internal/` returns raw records (`{ code, offset, length }` parse errors, `_tag`-discriminated navigate results); the facade materializes the `Schema.Class` types and tagged errors, deriving `line`/`character` from `offset`. An internal module importing the facade fails the lint — with the one edge `internal/parser.ts` → `JsoncNode.js`, which is why the depth cap lives in the zero-dependency leaf `internal/limits.ts`: every recursive surface imports one constant without closing a cycle.

## Hardening invariant

Malformed or hostile input must fail through the typed `E` channel — never as a `Cause.Die` defect, never as `RangeError: Maximum call stack size exceeded`.

`MAX_NESTING_DEPTH = 256` (in `internal/limits.ts`) is enforced independently at five recursive surfaces:

1. `internal/parser.ts` value mode → `NestingDepthExceeded` parse error
2. `internal/parser.ts` tree mode → same
3. `JsoncNode.ts` walkers (`evaluateNode`, `findAtOffsetImpl`, `buildPath`) → bounded placeholder; reachable only via hand-built trees
4. `Jsonc.ts` `deepEqual` (backs `equals`/`equalsValue`) → returns `false`
5. `JsoncVisitor.ts` `visitValue` → in-band `Error` event, then an iterative `skipDeepContainer()`

`internal/navigate.ts` needs no cap: `skipValue()` is an iterative balanced-bracket skip, so it cannot overflow. The skip algorithm itself (bracket counting over the flat token stream, plus the malformed-closer guard) has a single copy in `internal/skip.ts` (`skipBalancedValue`), parameterized over a token cursor; the parser, navigator and visitor each adapt their own advance discipline to it.

The parser's tree mode constructs nodes via `makeNodeUnsafe` in `JsoncNode.ts` — a validation-free internal path (not re-exported from `index.ts`) that exists because schema construction re-validates the recursive `children` field per node, doubling cost per nesting level (#13). The parser guarantees validity by construction; public `JsoncNode.make`/`new` remain fully validating.

Errors preserve structure. `JsoncModificationError` carries typed `path`/`expected`/`depth`/`offset?` fields — never a `reason: string`.

## Public surface

Exported from `src/index.ts`:

- `Jsonc` — `parse`, `parseTree` (`Effect`, failing with the aggregate `JsoncParseError`); `stripComments`, `equals`, `equalsValue` (pure, total); `fromString`, `JsoncFromString`, `schema(target)`. Plus `JsoncParseError`, `JsoncParseErrorDetail`, `JsoncParseErrorCode`, `JsoncParseOptions`
- `JsoncNode`, `JsoncNodeType`, `JsoncPath`, `JsoncSegment` — the AST; no parent pointers (they would break equality, serialization and encode/decode)
- `JsoncEdit` (+ `applyAll`), `JsoncRange`, `JsoncFormattingOptions`
- `JsoncFormatter` — `format`, `formatToString`
- `JsoncModifier` — `modify`; `JsoncModificationError`, `JsoncModifyOptions`
- `JsoncVisitor`, `JsoncVisitorEvent` — SAX `Stream`, infallible at type level

`fromString` and `schema` are schema-producing: bind results to a `const` on hot paths.

## Working here

```bash
pnpm vitest run packages/jsonc/__test__   # this package's tests
pnpm build --filter @effected/jsonc       # dev + prod, in order
```

Never run `node savvy.build.ts --target prod` directly. It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.

Tests live in `__test__/`, use `@effect/vitest`, and assert with `assert.*` — never `expect`.

`savvy.build.ts` carries one narrow API Extractor suppression: `{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage symbols synthesized by inline class factories. Never widen it. `package.json` stays `"private": true` — the bundler emits the publishable manifest.
