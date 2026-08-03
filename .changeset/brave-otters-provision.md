---
"@effected/npm": minor
---

## Features

* `PackageManagerCache.defaultDirectory(manager, { platform, home })` is a
  pure, no-IO facts table answering where each package manager caches by
  default: `npm`, `pnpm`, `yarn-classic`, `yarn-berry` (split from a bare
  `yarn` because the two majors document different cache locations) and
  `bun`. Every cell is verified against the manager's own documentation or
  source, cited on the member — two of the three rows this replaces in prior
  art were wrong (pnpm's macOS store is not the Linux XDG path, and yarn
  Classic's cache was never `~/.yarn/cache`).

```ts
import { PackageManagerCache } from "@effected/npm";

PackageManagerCache.defaultDirectory("pnpm", { platform: "darwin", home: "/Users/ci" });
// => "/Users/ci/Library/pnpm/store"
```
