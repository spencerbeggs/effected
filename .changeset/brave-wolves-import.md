---
"@effected/lockfiles": minor
---

## Features

### Workspace importer support

`Lockfile.importers` exposes each workspace importer's declared dependencies, populated for pnpm, bun and npm; yarn Berry records no importers, so its `importers` array is always empty. Each importer is a new `LockfileImporter` (`path`, `dependencies`), and each declared dependency a new `ImporterDependency` (`name`, `specifier` decoded through `@effected/npm`'s `DependencySpecifier.FromString`, an optional `version` populated by pnpm only, and `depType`).

Look an importer up by path with `lockfile.importer(path)`:

```ts
import { Lockfile } from "@effected/lockfiles";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
  const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });
  const root = lockfile.importer("."); // Option<LockfileImporter>
  return Option.map(root, (importer) => importer.dependencies.length);
});
```

## Refactoring

* `ResolvedPackage.integrity` and `WorkspaceDependency.depType` now type against `@effected/npm`'s consolidated `IntegrityHash` and `DependencyField` vocabulary instead of this package's own copies. `ResolvedPackage.integrity` now preserves yarn Berry checksums that were previously dropped; an absent integrity is omitted, but a present but unparseable integrity now fails the parse typed at validation rather than being silently dropped.
* Removed the local `DependencyType` export. Import `DependencyField` from `@effected/npm` instead — the two vocabularies are equivalent.
