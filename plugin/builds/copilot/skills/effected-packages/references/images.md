# @effected/images

Image facts read from bytes, and a generated-image cache: `ImageFacts` gives the format, MIME type and pixel dimensions of a PNG, JPEG, GIF, WebP or AVIF file with one typed parse failure, and `ImageCache.getOrGenerate` skips an expensive renderer (an Open Graph card, say) when the same parameters were already rendered. Boundary tier: the root is pure; `./cache` needs `FileSystem`, `Path` and `Crypto` in `R`. Zero external runtime dependencies, zero `@effected/*` edges, and `effect` is the only peer. No image library is involved — the readers are in-house.

## Import

```ts
import { ImageFacts, ImageParseError } from "@effected/images";
import { ImageBackend, ImageCache, ImageCacheKey } from "@effected/images/cache";
```

**Platform**: the cache does real IO and hashing — provide `FileSystem`, `Path` and `Crypto` once at the edge. On Node, `NodeServices.layer` from `@effect/platform-node` provides all three. The root needs nothing.

## Core API

- **`ImageFacts`** — a `Schema.Class` with `format` (`"png" | "jpeg" | "gif" | "webp" | "avif"`), `mimeType` (one of the five media types, typed `ImageMimeType`), and positive-integer `width` and `height` as stored in the file. The `extension` getter gives the conventional file extension (`ImageExtension`: `jpg` for `jpeg`, the format name otherwise); it is derived from `format` and not part of the encoded form (a `{ ...facts }` spread drops it too), so name an output file with it instead of keeping a private table. `ImageFacts.fromBytesResult(bytes)` is the synchronous engine returning `Result<ImageFacts, ImageParseError>`; `ImageFacts.fromBytes(bytes)` is the `Effect` form. A `Buffer` slice or any `subarray` view reads identically.
- **`ImageParseError`** — the one parse failure, with `reason` `"unrecognized"` (no known signature), `"truncated"` (recognized but cut short) or `"malformed"` (self-contradicting header), and `format` once a signature matched. Handle policy with one `Effect.catchTag("ImageParseError", ...)`.
- **`ImageCacheKey.fromParams(schema, params, { salt, namespace })`** — encodes `params` through the schema, serializes canonically (keys sorted, `undefined` members omitted) and digests `salt`, a NUL and that text with SHA-256 via core `Crypto`. `salt` is the generator's identity: bump it when the template changes and every old key misses. `namespace` becomes the backend tag and is not hashed. Fails with `ImageCacheKeyError` (`reason`: `"encode"`, `"non-json"` or `"digest"`). It is named `fromParams` because `Schema.Class` reserves `make`.
- **`ImageBackend`** — the storage port: `get(key)` and `set({ key, value, contentType?, tags? })`, failing with `ImageBackendError` (`operation`: `"get"` or `"set"`). `ImageBackend.layerDirectory({ directory })` stores `<directory>/<key>.<ext>` through a temp file and atomic rename, ignores `tags`, and treats a key that is not 64 lowercase hex digits as a defect. `ImageBackend.layerNone` stores nothing (`get` always misses, `set` discards) and needs nothing in `R`: provide it when caching is off and keep one `getOrGenerate` code path. `ImageBackend.layerFrom(Tag)` adapts any service whose `get` and `set` match structurally — for example `@effected/store`'s `Cache` — with no package edge: `ImageBackend.layerFrom(Cache)`.
- **`ImageCache`** — `ImageCache.layer` (requires `ImageBackend`) provides `getOrGenerate(key, generate, { accept? })`, returning `{ bytes, facts, hit }`; with `accept`, `facts.format` is typed as the accepted formats. A stored entry that no longer parses or is outside `accept` is a miss and is overwritten. A generator result that is empty, unparseable or outside `accept` fails with `ImageGenerateError` (`reason`: `"empty"`, `"unparseable"` or `"rejected-format"`) and is never stored. Backend errors are surfaced, never swallowed; the generator's own error passes through untouched. Wrap a Promise-returning renderer as `Effect.tryPromise({ try: () => render(info), catch: (cause) => cause })`: the one-argument `Effect.tryPromise` wraps the rejection in `UnknownError`, losing the generator's own error.

## Usage

```ts
import { ImageFacts } from "@effected/images";
import { ImageBackend, ImageCache, ImageCacheKey } from "@effected/images/cache";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Schema } from "effect";

// Sync, no runtime: dimensions of a file already in memory.
declare const bytes: Uint8Array;
const facts = ImageFacts.fromBytesResult(bytes);

// Cached generation.
const CardParams = Schema.Struct({ title: Schema.String });
declare const renderCard: () => Effect.Effect<Uint8Array>;

const CacheLive = ImageCache.layer.pipe(Layer.provide(ImageBackend.layerDirectory({ directory: ".cache/og" })));

const program = Effect.gen(function* () {
  const cache = yield* ImageCache;
  const key = yield* ImageCacheKey.fromParams(CardParams, { title: "Hello" }, { salt: "og-card-v1", namespace: "og" });
  return yield* cache.getOrGenerate(key, renderCard, { accept: ["png"] });
}).pipe(Effect.provide(CacheLive), Effect.provide(NodeServices.layer));
```

## Not included

SVG (no intrinsic pixel size), BMP, ICO, TIFF, HEIC, JPEG XL, EXIF orientation, any image transformation, and eviction or TTL in the directory backend.
