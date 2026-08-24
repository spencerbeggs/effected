---
"@effected/yaml": minor
---

## Features

Adds `quoteCompat: "yaml-1.1"` to `YamlStringifyOptions`. When set, the stringifier additionally quotes plain scalars that a YAML 1.1 resolver (js-yaml, PyYAML, libyaml) would implicitly coerce to a non-string — `yes`/`no`/`on`/`off` booleans, sexagesimals like `1:30`, underscored numbers, and other YAML 1.1 type ambiguities that this package's own YAML 1.2 rules would otherwise leave unquoted:

```ts
import { Yaml } from "@effected/yaml";

Yaml.stringify({ enabled: "yes" }, { quoteCompat: "yaml-1.1" });
// => "enabled: \"yes\"\n" — quoted so a 1.1 consumer reads it back as a string
```

The option is strictly additive to the existing quoting rules and available anywhere stringify options are accepted, on both the value path (`Yaml.stringify`) and the node path (`YamlDocument`, `YamlFormat`).
