# CLAUDE.md — @effected/images

Image facts (format, MIME type, pixel dimensions) read from bytes with one typed
parse failure, plus a generated-image cache: `getOrGenerate` skips an expensive
renderer when the same parameters were already rendered.

**Design doc:** `@./okf/modules/images.md` — load before changing behavior; it is
the contract this package implements.

## Tier: boundary

`effect` is the only peer. **Zero external runtime dependencies, zero
`@effected/*` edges, no `node:` import anywhere under `src/`** (`TextEncoder` is
a global). `@effected/store`, `@effected/memfs` and `@effect/platform-node` are
devDependencies for tests only; no `src/` file imports them and no published
`.d.ts` names a store type. Never add `image-size` or any image library — the
readers are in-house. The key digest is core `Crypto.digest("SHA-256", ...)`
with `Crypto.Crypto` in `R`; never `node:crypto`, never a hand-rolled hash.

## Subpaths

- `.` — `ImageFacts`, `ImageFormat`, `ImageParseError`, and the types
  `ImageExtension` and `ImageMimeType`. Pure, no IO. `src/ImageFormat.ts` holds
  the two internal tables, `EXTENSIONS` and `MIME_TYPES`; every extension and
  media type in the package, `ImageFacts.mimeType`'s schema and
  `layerDirectory`'s file names included, is read from them.
- `./cache` — `ImageCache`, `ImageCacheKey`, `ImageCacheKeyError`,
  `ImageBackend`, `ImageBackendError`, `ImageGenerateError`. Needs `FileSystem`,
  `Path` and `Crypto` in `R`; a Node app provides all three with `NodeServices.layer`.

Module-per-concept: one exported concept per `src/<Concept>.ts`, engines in
`src/internal/`, only `index.ts` and `cache.ts` re-export.

## The sync rule

A surface with no IO and `R = never` ships a `*Result` primitive and derives its
`Effect` form with `Effect.fromResult`, adding only a span
(`ImageFacts.fromBytesResult` / `fromBytes`). IO surfaces and
`ImageCacheKey.fromParams` (`Crypto` in `R`) are `Effect` only. Never name a sync form `*Sync`.
`Schema.Class` reserves `make`, so the key constructor is `fromParams`.

## Reader hardening

Readers never throw. Every length and offset is bounds-checked before it is
read, the JPEG segment walk and the AVIF box walk carry a step budget, and
nothing is allocated in proportion to a length read from the input. A PNG may
declare width up to 2^31-1; larger is `malformed`, never a `Schema` construction
throw. Segment payloads are skipped by length, so an EXIF thumbnail's own SOF
cannot be mistaken for the main image. A sweep asserts that no prefix of a valid
file is ever reported `malformed` (a short prefix is `truncated`).

## Cache policies

- A stored hit that fails to parse, or is outside `accept`, is a miss and is overwritten.
- Generated output that is empty, unparseable or outside `accept` is never stored.
- Backend errors are surfaced, never swallowed; the generator's own error passes through.
- The directory backend writes a temp file then renames (atomic); a key that is
  not 64 lowercase hex digits is a defect so a key can never traverse a path.
- The directory backend accepts and ignores `tags`.
- `ImageBackend.layerNone` stores nothing: `get` misses, `set` discards.
- `getOrGenerate` is generic in `const F`; the runtime is the same for every `F`.
- Keys are digest-only: SHA-256 hex of `salt + NUL + canonical JSON of the encoded params`;
  `namespace` becomes the backend tag and is not hashed.

## Build and the self-reference

`./cache` names root types through `import type * as Images from
"@effected/images"`, and `savvy.build.ts` sets `dtsExternals:
["@effected/images"]` so `cache.d.ts` refers to the root's types instead of
copying them (the `cli`/`jsonl` pattern). The `_base` suppression is the narrow
house one; never widen it. A second suppression matches only the three messages `The symbol "Images" needs`, `ImageFacts` and `ImageParseError`: the type-only self-reference namespace and the two root types it reaches, reported against `cache.d.ts`. It is not a blanket `cache.d.ts` suppression. Only `Images` shows in `issues.json`'s `suppressed` array: the other two come from the self-reference pass with no file or line and are not listed once suppressed, but narrowing the pattern turns both into ciFatal warnings (checked with a cold build). A new named root type that a cache signature, or a member of `ImageFacts`, reaches would surface as a fourth message: write it structurally or derive it (`ImageExtension` is `ImageFacts["extension"]`, and the getter spells out its union) instead of widening the pattern. **Known upstream issue:** `dist/prod/issues.json`
carries one accepted `ae-wrong-input-file-type` warning, a defect in
`@savvy-web/tsdown-plugins`' self-reference resolution — do not try to fix or suppress it here.

```bash
pnpm vitest run packages/images        # from the repo root
pnpm build --filter @effected/images   # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never
`expect`), and take `FileSystem` from `@effected/memfs`, never `layerNoop`. Gate
a build on `dist/prod/issues.json`'s `generatedAt` postdating your last edit.
