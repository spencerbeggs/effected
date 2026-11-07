---
"@effected/lockfiles": minor
---

## Features

### `LockfileDiff.compare`

Reports what moved between two parsed lockfiles, as an update tool does after an install. It is pure and total. The result carries `catalogs` and `importers` lists and a `hasChanges` getter. Each `CatalogChange` and `ImporterChange` holds `specifier` and `version` as `{ before, after }` and a `kind` of `added`, `removed` or `changed`.

```ts
import { Lockfile, LockfileDiff } from "@effected/lockfiles";
import { Effect } from "effect";

declare const beforeText: string; // the lockfile before `pnpm update`
declare const afterText: string; // and after

const program = Effect.gen(function* () {
  const before = yield* Lockfile.parse(beforeText, { format: "pnpm" });
  const after = yield* Lockfile.parse(afterText, { format: "pnpm" });
  const diff = LockfileDiff.compare(before, after);

  for (const change of diff.catalogs) {
    // A side that does not exist, or a version that does not resolve, is absent.
    const from = change.version.before ?? "-";
    const to = change.version.after ?? "-";
    console.log(`${change.catalog}/${change.name} ${change.kind}: ${from} -> ${to}`);
  }
});
```

Resolved versions are normalized across pnpm, bun and npm. Yarn always compares empty, because it records no importers or catalogs. Changes name importers by path (`.` for the root), and the default catalog is named `default` in every format.
