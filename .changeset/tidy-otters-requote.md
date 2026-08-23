---
"@effected/yaml": minor
---

## Features

Added an opt-in `requoteScalars` option to `YamlFormattingOptions`, read by `YamlFormat.format` / `YamlFormat.formatToString`. By default, formatting preserves an already-quoted scalar's own quote style and `quoteStyle` only governs quotes the stringifier introduces. Setting `requoteScalars: true` makes `quoteStyle` apply to scalars already quoted in the source, but only when the re-quote provably preserves the parsed value: single→double applies proper double-quote escaping, and double→single is skipped whenever the value carries characters single-quoted style cannot express (newlines, tabs, control and other non-printable characters). Plain scalars, block scalars, and scalars carrying a tag, anchor, or spanning multiple source lines are left untouched.

```ts
import { YamlFormat, YamlFormattingOptions } from "@effected/yaml";

const options = YamlFormattingOptions.make({ quoteStyle: "double", requoteScalars: true });
const formatted = YamlFormat.formatToString("key: 'value'\n", undefined, options);
// key: "value"
```

The option is deliberately absent from `Yaml.stringify` (which serializes plain values) and `YamlFormat.modify` (which takes a bare `YamlStringifyOptions`) — it only applies where a source quote exists to re-quote.
