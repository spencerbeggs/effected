---
"@effected/yaml": minor
---

## Features

### `indentSequences` formatting option

`YamlStringifyOptions` and `YamlFormattingOptions` gain `indentSequences`, controlling how block sequences nested under a mapping key are presented. The default, `false`, keeps the kit's existing byte-compatible output (sequence items at the key's column); `true` indents them one level, matching the `yaml` npm package's default.

```ts
import { Yaml, YamlStringifyOptions } from "@effected/yaml";

const options = YamlStringifyOptions.make({ indentSequences: true });
Yaml.stringify({ key: ["a", "b"] }, options);
// key:
//   - a
//   - b
```

Top-level sequences stay at column zero in both modes. Existing output is unchanged unless `indentSequences` is set explicitly.
