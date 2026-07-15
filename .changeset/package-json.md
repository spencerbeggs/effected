---
"@effected/package-json": minor
---

## Features

Initial release: package.json parsing, editing, validation and file IO as Effect schemas. `Package` is a `Schema.Class` over the manifest's known fields — `name` is a branded npm name, `version` is a real `SemVer` — with a `rest` catch-all that round-trips every unknown top-level key.

### The Package model

Decode a manifest, edit it immutably, read the computed properties back. Mutation statics are dual, and serialization applies the canonical `sort-package-json` key order:

```ts
import { Package } from "@effected/package-json";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const pkg = yield* Package.decode({ name: "@acme/widget", version: "1.0.0", private: true });
  const next = yield* Package.setVersion(pkg, "1.1.0");
  return [next.name, next.version.toString(), next.isScoped, next.isPrivate] as const;
});

console.log(Effect.runSync(program));
// => ["@acme/widget", "1.1.0", true, true]
```

### File IO with typed failures

`PackageJsonFile` is the only IO surface — one service, `read` and `write`, over core `FileSystem` / `Path`. `read` fails four distinct ways: `PackageJsonNotFoundError`, `PackageJsonReadError`, `PackageJsonParseError` and `PackageDecodeError`.

```ts
import { PackageJsonFile } from "@effected/package-json";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const bumpMinor = Effect.gen(function* () {
  const files = yield* PackageJsonFile;
  const pkg = yield* files.read("./package.json");
  const next = pkg.copyWith({ version: pkg.version.bump.minor() });
  yield* files.write("./package.json", next);
});

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

Effect.runPromise(bumpMinor.pipe(Effect.provide(PackageJsonFile.layer), Effect.provide(PlatformLive)));
```

### Validation and specifier resolution

`PackageValidator` runs a replaceable rule set and aggregates every failure into one `PackageValidationError`. `Package.resolve` expands `catalog:` and `workspace:` specifiers through the `@effected/npm` resolver contracts as an explicit step `write` never performs for you. Leaf concepts (`PackageName`, `DependencySpecifier`, `Dependency`, `SpdxLicense`, `PackageManager`) are usable on their own.
