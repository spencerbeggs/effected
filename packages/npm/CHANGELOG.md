# @effected/npm

## 0.1.0

### Features

* Effect service contracts for resolving pnpm `catalog:` and `workspace:` dependency specifiers, plus the kit-wide dependency vocabulary. `CatalogResolver.rangeOf` turns a package name plus an optional catalog name into the configured range; `WorkspaceResolver.versionOf` turns a workspace package name into its concrete version. Both are `Context.Service` contracts shipping a no-op default layer, and neither reads a file — the package is the seam, and something that can see the workspace supplies the implementation. An unmatched specifier is `Option.none()`, not an error; the error channel is reserved for the resolution mechanism failing.

  ### Resolver contracts

  The `Default` layer merges both no-op resolvers. Provide it when the contracts need satisfying but nothing should resolve.

  ```ts
  import { CatalogResolver, Default, WorkspaceResolver } from "@effected/npm";
  import { Effect, Option } from "effect";

  const program = Effect.gen(function* () {
    const catalog = yield* CatalogResolver;
    const workspace = yield* WorkspaceResolver;
    return yield* Effect.all([
      catalog.rangeOf("effect", Option.none()),
      workspace.versionOf("@effected/semver"),
    ]);
  });

  Effect.runPromise(Effect.provide(program, Default)).then(console.log);
  // => [Option.none(), Option.none()]
  ```

  A real resolver is a `Layer.succeed` over the shape — `@effected/workspaces` implements these against a discovered monorepo, but a fixed record is a legitimate implementation for a test or a tool that already knows its own catalog. Both contracts raise `DependencyResolutionError`, carrying the `specifier` and a structural `cause`.

  ### Dependency vocabulary

  The package also holds the shared vocabulary second consumers pulled in: `DependencySpecifier` (a branded string with an eleven-protocol taxonomy and a `FromString` codec decoding to a `ClassifiedSpecifier` union that re-encodes byte-for-byte), `DependencySection` (`DependencyKind` / `DependencyField` with the bidirectional `fieldOf` / `kindOf` mapping), and `IntegrityHash` (a brand over the SRI, corepack and yarn textual forms). [#81][#81]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/semver | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
