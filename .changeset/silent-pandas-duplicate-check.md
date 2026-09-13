---
"@effected/workspaces": minor
---

## Features

- New `DuplicateCheck` value class: `DuplicateCheck.run(lockfile, { names? })` walks a parsed `@effected/lockfiles` `Lockfile` and reports every package name resolved at two or more distinct versions, each `DuplicatedVersion` naming every `DuplicateInstance` and the importers/packages that pull it (`Dependent`). `DuplicateCheck.kit` is the predicate for `effect` plus every `@effected/*` name — the check issue #298 and #603 asked for, now a report instead of a `pnpm why` transcript:

```ts
import { DuplicateCheck } from "@effected/workspaces";
import { Lockfile } from "@effected/lockfiles";

const lockfile = yield* Lockfile.parse(text, { format: "pnpm" });
const report = DuplicateCheck.run(lockfile, { names: DuplicateCheck.kit });
report.isClean; // false when any reported name resolved at >1 version
```

`PeerCheck` and `DuplicateCheck` now share one join between importers and resolved instances, so both report the same `unresolvedImporters` (the npm/bun root-importer limitation) from the same code.
