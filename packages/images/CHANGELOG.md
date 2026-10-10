# @effected/images

## 0.1.1

### Maintenance

- Republished to re-verify the package's npm trusted publishing setup. No code changes. [#986][#986]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#986]: https://github.com/spencerbeggs/effected/pull/986

## 0.1.0

### Features

#### Image facts from bytes

- `ImageFacts` reads the format, MIME type and pixel dimensions of a PNG, JPEG, GIF, WebP or AVIF file straight from its header. The readers are in-house, so the package has no runtime dependency beyond `effect` and replaces `image-size` for consumers.

```ts
import { ImageFacts } from "@effected/images";
import { Result } from "effect";

declare const bytes: Uint8Array;

const result = ImageFacts.fromBytesResult(bytes);
if (Result.isSuccess(result)) {
  const { format, mimeType, width, height } = result.success;
  const file = `card.${result.success.extension}`;
}
```

- `ImageFacts.fromBytesResult` is the synchronous primitive and returns a `Result`; `ImageFacts.fromBytes` is the same read as an `Effect`.
- `mimeType` is a literal union of the five media types, and the `extension` getter returns `jpg` for `jpeg` and the format name otherwise.
- `ImageFormat` is the `png | jpeg | gif | webp | avif` union; `ImageMimeType` and `ImageExtension` are exported as types.
- Unreadable bytes fail with one `ImageParseError` whose `reason` is `unrecognized`, `truncated` or `malformed`. The readers never throw and bound every length and walk they perform.

#### Generated-image cache at `@effected/images/cache`

- `ImageCache.getOrGenerate` skips an expensive renderer, such as an Open Graph card generator, when the same parameters were already rendered.

- `ImageCacheKey.fromParams` derives a SHA-256 key from a salt and the canonical JSON of your schema-encoded parameters, using core `Crypto`. Failures are `ImageCacheKeyError`.

- `ImageCache.getOrGenerate(key, generate, { accept })` returns the bytes, their `ImageFacts` and whether it was a `hit`. Passing `accept` narrows the result's `facts.format` to the accepted formats.

- A stored entry that no longer parses, or whose format is outside `accept`, is treated as a miss and overwritten. A generated result that is empty, unparseable or outside `accept` fails with `ImageGenerateError` and is never stored.

- `ImageBackend` is the storage port: `layerDirectory` writes through a temp file and an atomic rename, `layerFrom` adapts any structurally matching store such as the `Cache` from `@effected/store`, and `layerNone` stores nothing for when caching is switched off. Failures are `ImageBackendError`. [#977][#977]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#977]: https://github.com/spencerbeggs/effected/pull/977
