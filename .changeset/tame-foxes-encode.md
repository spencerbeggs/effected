---
"@effected/config-file": minor
---

## Features

- `ConfigFileShape.encode(value, options?)` serializes `value` to text without writing it — byte-for-byte what `write` would put on disk, with no event emitted and path-less errors (`ConfigEncodeError = ConfigCodecError | ConfigValidationError`). Useful for a `--dry-run` flag or a "show me the file" preview.
- `write(value, path, options?)` gains the same `options`, so the two share one encoding path and cannot drift.
- New `ConfigEncodeOptions.header`: text prepended verbatim ahead of the serialized document, separated by exactly one newline (a header already ending in `\n` is not given another). The caller owns the header's validity in the target format — `#` for TOML/YAML, `//` for JSONC; JSON has no comment syntax, so a header there yields an unparseable file by construction. The motivating case is a `#:schema` directive at the top of a TOML file.

```ts
import { ConfigFile, TomlCodec } from "@effected/config-file";

const text = yield* config.encode(value, { header: "#:schema https://example.com/config.schema.json" });
```

`save` and `update` are unchanged.

Closes #650.
