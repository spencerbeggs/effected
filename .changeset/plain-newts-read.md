---
"@effected/config-file": minor
---

## Features

Added `ConfigFile.read`, a one-shot read-and-decode over a schema and an
explicit `ConfigCodec` — for the common case of reading one config file
without standing up a per-schema service class and its layers.

```ts
import { ConfigFile } from "@effected/config-file";
import { JsonCodec } from "@effected/config-file";

const config = ConfigFile.read("./app.json", { schema: AppShape, codec: JsonCodec });
```

The codec is always an explicit argument, never inferred from a file
extension — this keeps the free-standing-codec tree-shaking guarantee: a
consumer that only ever passes `JsonCodec` never pulls in the YAML or TOML
parsing engines.
