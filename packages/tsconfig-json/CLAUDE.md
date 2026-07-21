# @effected/tsconfig-json

tsconfig.json schemas, `extends`-chain resolution and config discovery. The one **new** (non-migration) `0.1.0` gate package; designed 2026-07-13.

**Design doc:** `@../../.claude/design/effected/packages/tsconfig-json.md` — load when changing the merge semantics, the extends-target engine, or the enum tables.

## Tier: boundary

`effect` is the only non-workspace peer (`catalog:effect` in this manifest); `@effected/jsonc` and `@effected/walker` are `workspace:~` in `peerDependencies` (so a published patch floats), mirrored by the plain `workspace:*` in `devDependencies` — the two specifiers now deliberately differ. Runtime `dependencies` stays empty — **zero external runtime dependencies**. All IO goes through core `FileSystem`/`Path` in `R`; a `PlatformError` from the underlying IO flows through **untranslated**.

**HARD RULE: zero `typescript` imports, including `import type`.** The version-coupled enum mappings live in `TsEnumCodec` as plain data tables; nothing else in the package may know TypeScript's numeric enums exist.

## Module map (one concept per module)

- `CompilerOptions` — string-level literal-union schemas: case-insensitive decode, canonical-lowercase encode; typed live option set plus passthrough so unknown **and** dead options survive.
- `TsconfigJson` — the document schema, the `TsconfigJsonFromString` JSONC codec (bound once at module top level) and `TsconfigParseError`. **Every parse is JSONC** via `@effected/jsonc`; there is no JSON-strict path.
- `ResolvedTsconfig` — the pure merge engine: E4 per-field semantics, path-option absolutization, final-phase `${configDir}` substitution, `pathsBase` provenance. No `FileSystem`, no `Path` service.
- `TsEnumCodec` — string↔numeric data maps (including the `node18`=101 / `node20`=102 gaps) and the `lib` normalizer. `encodeCompilerOptions` returns the exported `ProgrammaticCompilerOptions` (values `ProgrammaticCompilerOptionsValue`) — a structural transcription of typescript 6.0.3's `CompilerOptionsValue` that keeps the zero-`typescript`-imports rule (one documented internal assertion), feeds the external `type-registry-effect` package's `TsEnvironment` (the former `@effected/ts-vfs`, now outside this kit), and emits `lib` in the **file-name form** (`lib.esnext.d.ts`) — verified against typescript 6.0.3's `pathForLibFile`, which joins the entry verbatim onto the lib directory.
- `PortableTsconfig` — an **allow-list** filter (never a deny-list), forced `composite: false` / `noEmit: true`, and a `$schema` stamp.
- `JsxConfig` — a pure projection from decoded compiler options to the JSX transform a bundler can configure: `react-jsx` / `react-jsxdev` → the `automatic` runtime (`importSource` defaulting to `"react"`, tsc's own default), `react` → `classic`; `preserve`, `react-native` and an absent `jsx` → `Option.none()`. The classic factory options stay on `CompilerOptions`.
- `TsconfigLoader` — `load` / `resolve` / `compilerOptions` (a thin projection of `resolve` down to the merged options), each an `Effect.fn` with a named span (`TsconfigLoader.load` etc.): depth-first `extends` with **per-branch** cycle stacks (diamonds are legal), `MAX_EXTENDS_DEPTH = 32`, and `TsconfigExtendsError` with reasons `not-found` / `cycle` / `depth` / `empty`.
- `TsconfigLoaderSync` — the sync facade for sync-only host APIs (bundler plugin hooks, config factories): the **unchanged** `TsconfigLoader` pipeline under `Effect.runSyncExit`, over consumer-supplied `SyncFileSystem` / `SyncPath` ops (`node:fs` one-liners and `node:path` itself satisfy them) adapted into per-call service values — never layers, so no memoization to poison across calls. The adapters are deliberately asymmetric: an unsupported `Path` member throws a **named defect**, while an un-overridden `FileSystem` member fails typed with `makeNoop`'s `NotFound`. Typed failures (`TsconfigParseError` / `TsconfigExtendsError` / `PlatformError`) are **thrown as themselves**, defects rethrown as-is — never a fiber-failure wrapper. No `node:*` import, no posix assumption; Windows correctness is the consumer passing a win32-appropriate `path`.
- `TsconfigDiscovery` — `findNearest` over `Walker.ascend` + `Walker.findUpward`; absence is `Option.none()`, never an error; `stopAt` is inclusive.
- `internal/extendsTarget` — **not exported**: E1 relative/rooted and E2 bare-specifier target resolution, plus the hardened `exports`-map subset.

## The tsc-parity discipline

The `extends`/merge semantics were **extracted from TypeScript 6.0.3 source** (`commandLineParser.ts` / `moduleNameResolver.ts`) and encoded as data-driven tests with `typescript.js` line citations embedded in the test comments. The following parity facts cost real review cycles — **do not regress them**:

- A malformed or non-object `package.json` coerces to `{}` and **falls through** to the `<pkg>/tsconfig.json` probe (tsc's `readJson(...) || {}`).
- There is **no `package.json` presence gate** — a manifest-less package directory still resolves via its `tsconfig.json`.
- The ancestor `node_modules` walk **continues past a present-but-unresolved candidate**; an `exports` map blocks only that package's own fallbacks, never a farther ancestor's copy.
- A falsy `"tsconfig"` manifest field target falls through to the `tsconfig.json` probe.
- `exports`-map `*` patterns match by **longest base prefix** (most specific), not first-in-order.
- Enum **values** are case-insensitive (lowercased before lookup); option **names** are case-sensitive.

## The file-only FileSystem contract

Target probing uses `fs.exists`, which is true for a directory, where tsc's `host.fileExists` is file-only. The loader documents a **file-only contract** (see the `TsconfigLoader.ts` header): a directory hit fails typed via `readFileString`'s `PlatformError` — never a defect — where tsc would retry `"./dir.json"`. Accepted, documented divergence; do not "fix" it by rewriting the tsc-cited engine.

## Hardening (do not relax)

- `extends` depth guard (32) and per-branch cycle detection in the loader.
- `exports`-map recursion depth guard (32) in `internal/extendsTarget`.
- `Object.hasOwn` on every untrusted map read; `__proto__` / `constructor` / `prototype` keys skipped; wildcard-substituted maps built with `Object.create(null)`.
- Malformed input always fails through the **typed** channel (`TsconfigParseError`, `TsconfigExtendsError`, `PlatformError`) — never as a defect.

## Testing and building

Tests live in `__test__/` (158 passing), use `@effect/vitest`, and assert with `assert.*` — **never** `expect`.

```bash
pnpm vitest run packages/tsconfig-json
pnpm build --filter @effected/tsconfig-json   # from the repo root
```

- Resolution suites run on in-memory fixture trees from `__test__/fixtures.ts`: `FileSystem.layerNoop` with `exists`/`readFileString` over a `Map`, merged with core `Path.layer` — **no platform package, even in tests**. The map holds file paths only, so `exists` is structurally file-only, matching the loader's contract.
- `savvy.build.ts` carries the standard **narrow** suppression `{ messageId: "ae-forgotten-export", pattern: "_base" }`; exactly 3 suppressed entries are expected in `issues.json` (the two error bases plus `JsxConfig_base`). Never widen it, and never run `node savvy.build.ts --target prod` directly.

## Consumers this API was designed against

- `rspress-plugin-api-extractor`'s tsconfig-parser — the `0.1.0` gate proof.
- `@savvy-web/bundler`'s tsconfig-resolver.
- `type-registry-effect` (external; the former `@effected/ts-vfs`) — `TsEnumCodec.encodeCompilerOptions` produces the shape its `TsEnvironment` hands to `@typescript/vfs`.
