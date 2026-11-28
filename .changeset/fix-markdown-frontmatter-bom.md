---
"@effected/markdown": minor
---

## Features

`FrontmatterSource.split` takes an opt-in `{ bom: "skip" }` option for a source that may begin with a UTF-8 byte order mark. It steps over exactly one leading U+FEFF before reading the fence, records `bom: true` on the result when it did (`false` when the source had none), and keeps every offset (`valueStart`, `valueEnd`, `bodyOffset`) relative to the source as passed, so callers no longer strip the mark and shift offsets back by hand. `FrontmatterSource.join` re-emits the mark when `bom` is `true`, so the round trip stays byte-exact. The default (`bom: "keep"`) is unchanged: a leading mark is text and the fence reads as absent.

```ts
import { FrontmatterSource } from "@effected/markdown";

const split = FrontmatterSource.split("﻿---\ntitle: hi\n---\n", { bom: "skip" });
split.bom; // true
split.frontmatter?.valueStart; // 5
```
