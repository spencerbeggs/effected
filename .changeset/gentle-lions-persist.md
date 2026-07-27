---
"@effected/tsconfig-json": minor
---

## Features

`PortableTsconfig.make` accepts an optional second argument to include `@types` package names in the portable output:

```ts
interface PortableTsconfigOptions {
	readonly includeTypes?: boolean;
}

PortableTsconfig.make(input, { includeTypes: true });
```

Portable tsconfigs previously dropped `types` unconditionally, which silently removed Node globals (`console`, `process`, `Buffer`, etc.) from virtual TypeScript environments built with `@typescript/vfs` and Twoslash. Passing `includeTypes: true` carries the source `types` array (package names, not paths) onto the portable shape.

* Default is `false` — existing calls to `make(input)` are unaffected.
* An empty `types: []` in the source is preserved as an explicit opt-out, not treated as absent.
* `typeRoots` is still dropped in both modes since it holds absolute, machine-specific paths that can never be portable.

`types` is opt-in rather than always included because it changes the failure mode: emitting it makes TypeScript require those packages to resolve, which a virtual environment with no `node_modules` cannot satisfy on its own.
