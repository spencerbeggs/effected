---
type: Module
title: "@effected/images"
description: Image facts read from bytes with one typed parse failure, plus a generated-image cache keyed by a Schema-encoded parameter object.
status: draft
kind: package
resource: ../../packages/images
layer: L1
tags:
  - architecture
  - performance
generated:
  by: "okfit/claude-code"
  at: 2026-10-09T16:21:59Z
  body_sha256: d7f0d90903476b2f131d04fe5f0003d4148f5d89ae5278f40076070bd21fe397
---

# `@effected/images`

`@effected/images` reads format, MIME type and pixel dimensions from image bytes, with the parse failure typed once, and offers a cache that answers "have I already generated an image from these parameters?" so a build stops re-running an expensive renderer on every run.

## Tier and dependencies

Boundary tier: the `./cache` surface does IO with `FileSystem` and `Path` in `R`, so the package is boundary. It has zero external runtime dependencies and `peerDependencies` is `effect` alone, with no `@effected/*` runtime edge. [`@effected/store`](store.md) and [`@effected/memfs`](memfs.md) are devDependencies for tests only, and `@effect/platform-node` is a devDependency supplying `NodeCrypto.layer` for tests. No published declaration names a store type; see [the structural port decision](../decisions/image-backend-is-a-structural-port.md). The format readers are in-house, per [the in-house readers decision](../decisions/image-formats-read-in-house.md).

## Subpath layout

| Subpath | Exports | Surface |
| --- | --- | --- |
| `.` | `ImageFacts`, `ImageFormat`, `ImageParseError` | pure, no IO |
| `./cache` | `ImageCache`, `ImageCacheKey`, `ImageCacheKeyError`, `ImageBackend`, `ImageBackendError`, `ImageGenerateError` | boundary |

The package follows the [module-per-concept layout](../conventions/module-per-concept-layout.md): one `src/<Concept>.ts` per exported concept, only the two entrypoints re-export, and engines live in `src/internal/`.

## API

- `ImageFormat` is the literal union `png | jpeg | gif | webp | avif`.
- `ImageFacts` is a `Schema.Class` with `format`, `mimeType` (derived from `format` by the readers, stored so it survives encode and decode), and positive-integer `width` and `height` as stored in the file. `ImageFacts.fromBytesResult` is the engine and `ImageFacts.fromBytes` is derived from it.
- `ImageParseError` is a tagged error with `reason` of `unrecognized`, `truncated` or `malformed` and an optional `format` once a signature matched. A consumer expresses its policy as one `catchTag`.
- `ImageCacheKey.fromParams(schema, params, { salt, namespace })` encodes `params` through the schema, serializes them canonically (keys sorted recursively), and digests `salt`, a NUL byte and the canonical text. The key carries `digest`, `salt` and `namespace`; the namespace becomes the backend tag and is not part of the digest. `salt` is the caller's generator identity, so a template change bumps it and every old key misses. `ImageCacheKeyError.reason` is `encode`, `non-json` or `digest`.
- `ImageBackend` is the port: `get(key)` and `set({ key, value, contentType?, tags? })`, failing with `ImageBackendError`. `layerDirectory` stores `<directory>/<key>.<ext>` through a temp file and rename, accepts and ignores `tags`, and treats a key that is not 64 lowercase hex digits as a defect so a key can never become a path traversal. `layerFrom` adapts any structurally matching service.
- `ImageCache.getOrGenerate(key, generate, { accept? })` returns `{ bytes, facts, hit }`. A hit whose stored bytes no longer parse, or whose format is outside `accept`, is treated as a miss and overwritten. A generator result that is empty, unparseable or outside `accept` fails with `ImageGenerateError` and nothing is stored. Backend errors are surfaced, never swallowed, and the generator's own error passes through untouched.

## The sync rule

Every surface that does no IO ships a `*Result` sync primitive and derives its `Effect` form from it, adding only the span; surfaces that do IO are `Effect` only. This is the [sync-primitive policy](../conventions/sync-primitive-policy.md) applied package-wide, named `*Result` and never `*Sync`. `ImageBackend` and `ImageCache` cannot be sync because the platform `FileSystem` is async underneath. `ImageCacheKey.fromParams` is `Effect`-only with `Crypto.Crypto` in `R`, which is outside the rule by the policy's own test, and no sync caller is lost since a key exists only to be handed to `getOrGenerate`.

## Core primitives

Verdict at the site, per [the require-in-R default](../conventions/require-in-r-default.md): the key digest adopts core `Crypto.digest("SHA-256", ...)` with `Crypto.Crypto` in `R`, and `effect/encoding/Hex` for the hex form. It passes the three shape checks. It is not a sync site, because its only consumer, `getOrGenerate`, is effectful. It is not a stream, because the input is a short canonical string. Hex is only encoded, never decoded. `NodeServices.layer` provides `Crypto` alongside `FileSystem` and `Path`, so a Node application wires the whole `./cache` surface with one layer. Core `Crypto` is marked `@stability unstable`, so a change to it surfaces at an Effect advance. Canonical JSON stays in-house in `src/internal/canonical.ts` because core has none and `@effected/schemastore`'s `CanonicalJson` is a file formatter that preserves insertion order and never sorts keys. A hand-rolled SHA-256, `node:crypto` and Effect's `Hash` were rejected. Core `PersistedCache` and `KeyValueStore` were also considered as the storage backend and rejected; see [the backend decision](../decisions/image-backend-is-a-structural-port.md).

## Build and the self-reference

Cache-side modules name root types through a type-only `import type * as Images from "@effected/images"` and import runtime values relatively, the `cli` and `jsonl` pattern, with `dtsExternals` set so `cache.d.ts` refers to the root's types. The bundler's second API Extractor pass resolves that self-reference into `src`, leaving one accepted `ae-wrong-input-file-type` warning; see [the gotcha](../gotchas/self-reference-api-extractor-pass-looks-clean-when-it-crashes.md). No suppression is added.

## Hardening

Per the [input-hardening standards](../conventions/input-hardening-standards.md), readers bounds-check every offset and length, never throw, carry a step budget on the JPEG segment walk and the AVIF box walk, and allocate nothing in proportion to a length read from the input. In the AVIF reader only a top-level box may be `truncated`; a nested box that overruns its complete parent is `malformed`. The directory backend rejects inherited object keys as content types with `Object.hasOwn`.

## Excluded

SVG (no intrinsic pixel size), BMP, ICO, TIFF, HEIC, JPEG XL, EXIF orientation, any image transformation, and cache eviction or TTL in the directory backend. A remote image check (`./remote`, `HttpClient` in `R`) is anticipated and out of scope for the first release; the layout leaves room for it. Dependencies and tiers follow the [dependency policy](../conventions/dependency-policy.md).

## Dogfood consumers

[tsdoctor](../consumers/tsdoctor.md) adopts `ImageFacts` in its bundle-asset sizing (sync) and its Open Graph service (Effect), and [systems](../consumers/systems.md) adopts `ImageFacts` and `ImageCache` with the directory backend in its generated Open Graph image writer; both drop `image-size`. A store-backed wiring for systems is the follow-on.
