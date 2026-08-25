---
"@effected/yaml": minor
---

## Features

Adds `quoteCompat: "yaml-1.1"` to `YamlStringifyOptions`. When set, the stringifier additionally quotes plain scalars that a YAML 1.1 resolver (js-yaml, PyYAML, libyaml) would implicitly coerce to a non-string — `yes`/`no`/`on`/`off` booleans, 1.1 timestamps, sexagesimals like `1:30`, underscored numbers, and other YAML 1.1 type ambiguities that this package's own YAML 1.2 rules would otherwise leave unquoted:

```ts
import { Yaml } from "@effected/yaml";
import { Result } from "effect";

const result = Yaml.stringifyResult({ enabled: "yes" }, { quoteCompat: "yaml-1.1" });
if (Result.isSuccess(result)) {
	result.success; // "enabled: 'yes'\n" — quoted so a 1.1 consumer reads it back as a string
}
```

The option is strictly additive to the existing quoting rules, composes with `quoteStyle` (which still picks the quote character), and is available anywhere stringify options are accepted, on both the value path (`Yaml.stringify`, `Yaml.stringifyResult`) and the node path (`YamlDocument`, `YamlFormat`).

## Bug Fixes

- `YamlDocument.stringify` now honors `quoteStyle` — the document-path options adapter previously dropped the field, so node-path callers always got single quotes regardless of what they passed
