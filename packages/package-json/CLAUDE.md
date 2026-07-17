# @effected/package-json

package.json parsing, editing, validation and file IO as Effect schemas. Fourth migration; merged. 12 `src/` modules (down from 34 v3 files), 11 test files, 91 tests.

**Design doc:** `@../../.claude/design/effected/packages/package-json.md` — load when
changing the public surface, the `rest` wire transform, or the error taxonomy.

## Tier: integrated

**Integrated tier**, because it takes one external runtime dependency:
`spdx-expression-parse` (typed by the ambient shim
`src/spdx-expression-parse.d.ts`). Under the three-tier taxonomy any runtime
import outside `effect` core makes a package integrated — this is the only
`@effected` package that carries such a dependency. It also depends on
`@effected/npm` and `@effected/semver` via `workspace:*`; those pure-to-integrated
`workspace:*` edges are separate from the `spdx` dep that sets the tier.

It also does IO, and **all of it lives in `src/PackageJsonFile.ts`** — one
module, one `Context.Service`, two methods (`read`, `write`). Every other module
is pure. Keep it that way: if a change wants to read or write, route it through
`PackageJsonFile` or leave it to the caller. `PackageJsonFile` reads and writes
over core `FileSystem` / `Path` (v4 — no `@effect/platform` peer); its layer
requires those services, and the consumer provides `@effect/platform-node` at the
edge. The IO alone would make it boundary; the `spdx-expression-parse` dependency
is what lifts it to integrated.

A review proposed splitting the IO into its own package; **the split was
reversed**. The v3 motivation — isolating the `@effect/platform` peer — evaporates
in v4, where platform abstractions live in `effect` core. A future split remains
a one-module extraction.

## Relationship to @effected/npm

`Package.resolve` expands `catalog:` and `workspace:` specifiers, but this
package cannot implement resolution — it has no view of the workspace. The
service contracts (`CatalogResolver`, `WorkspaceResolver`,
`DependencyResolutionError`) therefore spun out into the internal sibling
`@effected/npm`, which ships shape-only contracts plus no-op layers. `Package.ts`
imports them; an application supplies the real implementation.

`PackageJsonFile.write` never resolves. Compose `Package.resolve` explicitly.

## Public surface

Everything exports from `src/index.ts` (single entry point; no barrel
re-exports below it).

- **`Package.ts`** — the `Package` `Schema.Class`: typed known fields plus a
  `rest` catch-all for round-trip fidelity, computed getters (`isPrivate`,
  `isScoped`, `isESM`, `hasDependency`, `get*Dependencies`), dual-signature
  mutation statics via `Function.dual` (`setVersion`, `addDependency`, …),
  `copyWith`, `Package.decode`, the `Package.schema` wire codec plus
  `Package.wireFor` for `.extend()`ed subclasses, `Package.resolve`, and the
  pure `toJsonString` serializer. Also the `@public` field schemas
  (`DependencyMapField`, `StringMapField`, `BinField`, `ExportsField`,
  `PublishConfigField`, `PeerDependenciesMetaField`, `RepositoryField`) — these
  are genuine reusable API on their own merit, not scaffolding.
- **`DependencySpecifier`** — the specifier taxonomy (one `protocolOf` classifier over eleven protocols, `range` | `tag` | `git` | `url` | `npm` | `file` | `link` | `portal` | `catalog` | `workspace` | `unknown`, plus predicate statics). **Relocated to `@effected/npm`** when lockfiles became its second consumer; `src/DependencySpecifier.ts` was deleted and `index.ts` **re-exports** it (with `DependencyKind`, `DependencyProtocol`, `DependencySpecifierBrand`, `InvalidDependencySpecifierError`, `isValidDependencySpecifier`) from there. This package no longer owns the file.
- **`Dependency.ts`** — one class with a `kind` field (typed against `@effected/npm`'s kit-wide `DependencyKind`), replacing v3's four copy-pasted tagged classes; the protocol getters delegate to npm's `DependencySpecifier`.
- **`PackageName.ts`**, **`License.ts`**, **`PackageManager.ts`**,
  **`Person.ts`**, **`DevEngines.ts`** — leaf concepts, each owning its own
  statics and its own error. `PackageManager.integrity` is `@effected/npm`'s
  `IntegrityHash` (the corepack `<algo>.<hex>` form) and `PackageManager.FromString`
  now fails typed on a malformed integrity.
- **`PackageValidator.ts`** — rule-based validation over a decoded `Package`;
  `layer` (default rules) and the parameterized `layerRules` factory.
- **`PackageJsonFile.ts`** — the IO surface.
- **`internal/format.ts`** — private; canonical key order (aligned verbatim to
  `sort-package-json@4.0.0`'s default `sortOrder` — re-baseline the fixtures in
  `__test__/fixtures/` together with `KEY_ORDER` when bumping that reference),
  map alphabetization (the dependency maps plus the HashMap-backed `scripts` /
  `engines` / `bin`, whose source order the model does not retain), empty-map
  stripping, and indent detection/resolution for `PackageIndent`
  (`number | "tab" | "preserve"`). Never re-export it.

## Conventions and gotchas

- **Branded types** export as `string & Brand.Brand<"…">`, never
  `typeof X.Type`. Applies to the locally owned `ScopedPackageName`,
  `UnscopedPackageName` and `SpdxLicense`. `DependencySpecifierBrand` follows the
  same convention but is now defined in `@effected/npm` and re-exported here.
- **No `*_base` exports.** Class factories are written inline. `savvy.build.ts`
  carries a **narrow** suppression: `{ messageId: "ae-forgotten-export",
  pattern: "_base" }`. **Never widen it.** An internal type named on a `@public`
  method signature is a different symbol that still forgotten-exports — inline it
  structurally or mark it `@public`.
- `Schema.Class` instances are not `Pipeable` in v4; `Package` hand-rolls the
  `pipe` overload block. Preserve it if you touch the class.
- `parseRange` decodes via `Schema.decodeUnknownExit` — never run an Effect
  inside a getter.
- `PackageJsonFile.read` deliberately has no `exists` pre-check (TOCTOU); it
  routes `PlatformError` with `reason._tag === "NotFound"` to
  `PackageJsonNotFoundError`.
- `package.json` stays `"private": true`. The bundler emits the publishable
  manifest.

## Test and build

```bash
pnpm vitest run packages/package-json          # this package's tests
pnpm build --filter @effected/package-json     # from the repo root
```

Tests live in `__test__/` (`integration/*.int.test.ts` for `PackageJsonFile`),
use `@effect/vitest`, and assert with `assert.*` — **never `expect`**.

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`,
emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a
clean gate.
