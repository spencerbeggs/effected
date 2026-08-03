---
"@effected/lockfiles": minor
---

## Features

* `filenamesFor(format)` returns every filename a format is genuinely written
  under, primary name first — npm's `npm-shrinkwrap.json` alternate and bun's
  older binary `bun.lockb` variant, in addition to the conventional name.
  `filenameFor` now delegates to it, so the conventional-name behavior is
  unchanged.

```ts
import { filenamesFor } from "@effected/lockfiles";

filenamesFor("npm"); // ["package-lock.json", "npm-shrinkwrap.json"]
```
