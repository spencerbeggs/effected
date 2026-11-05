---
"@effected/source": minor
---

## Features

* `EditDistance` provides pure Levenshtein distance and "did you mean" suggestions as plain functions with no Effect and no IO (#1199). `EditDistance.suggest(input, candidates, options?)` returns the candidates within `maxDistance` edits (`2` by default, or a function of the input).

```ts
import { EditDistance } from "@effected/source";

EditDistance.suggest("stauts", ["status", "stack", "build"]); // => ["status"]
```
