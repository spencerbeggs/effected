---
"@effected/package-json": minor
---

## Features

`resolveEntryPoint` — a new pure, IO-free function answering "which file is this manifest's `"."` entry point?" over a structural `EntryPointManifest` (`{ exports?, main? }`), so a manifest read straight from a tarball resolves with nothing else validated.

```ts
import { resolveEntryPoint } from "@effected/package-json";

resolveEntryPoint({ exports: { import: "./esm.js", require: "./cjs.js" } });
// Result.succeed("./esm.js")

resolveEntryPoint({ exports: { require: "./cjs.js" } }, { conditions: ["require"] });
// Result.succeed("./cjs.js")
```

It honours all three legal `exports` spellings (string shorthand, subpath map, root conditions), and conditions are checked in caller-supplied order. When `exports` is present but nothing matches the requested conditions, resolution fails typed with `UnresolvedEntryPointError` rather than falling through to `main` — matching Node's own encapsulation rule. `main`, and then the legacy `index.js` default, only apply when `exports` is absent entirely.
