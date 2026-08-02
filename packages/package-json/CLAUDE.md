# @effected/package-json

package.json parsing, editing, validation and file IO as Effect schemas. Fourth migration; merged. 12 `src/` modules (down from 34 v3 files), 14 test files, 197 tests.

**Design doc:** `@../../.claude/design/effected/packages/package-json.md` — load when
changing the public surface, the `rest` wire transform, or the error taxonomy.

## Tier: boundary

**Boundary tier**, driven by the IO boundary. It carries no third-party runtime
dependency — its `dependencies` are `workspace:~` edges to pure `@effected`
packages plus the `effect` peer — so it never rises to integrated.
All IO **lives in `src/PackageJsonFile.ts`** — one module, one `Context.Service`,
two methods (`read`, `write`). Every other module is pure. Keep it that way: if a
change wants to read or write, route it through `PackageJsonFile` or leave it to
the caller. `PackageJsonFile` reads and writes over core `FileSystem` / `Path`
(v4 — no `@effect/platform` peer); its layer requires those services, and the
consumer provides `@effect/platform-node` at the edge.

It depends on `@effected/npm`, `@effected/semver` and `@effected/spdx` via
`workspace:~`. **Core SPDX license validity is delegated to `@effected/spdx`**
(`License.ts` calls its `isValidExpression`); this package keeps only its
npm-specific `UNLICENSED` and `SEE LICENSE IN` cases. That delegation dropped the
former `spdx-expression-parse` runtime dependency and its ambient shim — the dep
that once made this package integrated — so its tier is now boundary.

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
  statics and its own error. `PackageManager` models the same
  `<name>@<version>[+<integrity>]` triple as `@effected/npm`'s
  `PackageManagerPin`, and since the **2026-07-28 consolidation** shares both
  strict pieces with it rather than re-deriving them: `integrity` is npm's
  `CorepackIntegrityHash` (the shared corepack `<algo>.<hex>` narrowing), and
  the version — since the 2026-08-02 migration — IS `@effected/semver`'s
  `SemVer.PinnableVersionString` (decode rules through `SemVer.isPinnable`).
  That version fold was a **deliberate strictening** of
  `PackageManager.FromString` — `pnpm@01.2.3`, `1.2.3-01` and `1.2.3-a..b`
  were accepted by the old regex, and `pnpm@ 10.33.0` (padded version) by the
  pre-migration trimming parse; all now fail typed, matching corepack's own
  `semver.valid` check minus its trim — and the check sits on the *field*, so
  `make` refuses a malformed version (and any build metadata, which the
  grammar cannot express) rather than producing a manifest value that
  re-parses differently. The public `.d.ts` is unchanged: a `Schema.check` is
  **erased from the built type**, so the break is behavioural only — and, for
  the same reason, severing either shared schema would not be a type error.
  The guard is a runtime identity assertion for both halves:
  `PackageManager.fields.integrity.value === CorepackIntegrityHash` (a
  `Schema.Option` keeps the inner schema on `.value`) and
  `PackageManager.fields.version === SemVer.PinnableVersionString` (a bare
  field keeps the schema directly on `fields`), each with a control; the
  version half is additionally pinned by an equivalence test against
  `SemVer.parseResult` over a corpus. Do not downgrade any of these to a
  source-text check.
  **The name grammar is the one place the two schemas diverge, deliberately.**
  This field model keeps any `[a-z]+` name; the pin closes the set to four.
  Field model = manifests as they exist in the wild, pin = the kit's
  provisioning vocabulary. The evidence lives in the class's TSDoc (corepack
  0.34.0 recognises only npm/pnpm/yarn and would reject the very real
  `bun@1.2.20`; it skips its own name check for URL specs; npm documents no
  constraint on the field, only on `devEngines.packageManager.name`). Do not
  "align" it with the pin.
- **`PackageValidator.ts`** — rule-based validation over a decoded `Package`;
  `layer` (default rules) and the parameterized `layerRules` factory.
- **`PackageJsonFile.ts`** — the IO surface.
- **`PackageJsonFormat.ts`** — the decode-free formatter: `PackageJsonFormat`
  with two statics, `sortValue` (value→value, total, returns its input type
  `T`) and `formatToString` (text→text, `Result<string, PackageJsonSyntaxError>`),
  plus `PackageFormatTextOptions`. Named for the kit formatter convention
  (`@../../.claude/design/effected/formatter-convention.md`) — `JsoncFormatter`,
  `YamlFormat` and `TomlFormat` spell the same capability the same way.
  **`sortValue` only ever reorders keys**; it never adds or removes one, which
  is what lets the return type be `T`. Never add a key-removing option there
  (`stripEmpty` lives on the text path, defaulted off) — `tsc` rejects it,
  because removing a key makes `T → T` a lie. A non-object (array, scalar,
  `null`) returns **unchanged** rather than mangled, so a mistyped `Json` union
  degrades to identity instead of losing data.
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
- **A `Schema.Class` modeling a sub-object of a round-tripped document needs
  its own `rest` catch-all**, not just the top-level `Package`. `Person` lacked
  one, so object-form `author`/`contributors`/`maintainers` silently dropped
  unknown keys on read→write (`{"name":"Dee","twitter":"@dee"}` re-encoded as
  `{"name":"Dee"}`). It now collects unknown keys into `rest` and flattens them
  back on encode, so the on-disk shape never carries a literal `rest` key.
  Check every new sub-object class against a round-trip test.
- **Wire provenance is remembered in a `WeakMap`, and `Schema.Class` instances
  are NOT frozen — so the replay must be guarded.** `Person` and `Repository`
  both remember the exact wire value each instance was decoded from and replay
  it on encode for byte-level fidelity. An instance mutated **in place** keeps
  its provenance entry while no longer being described by it; an unguarded
  replay then writes the ORIGINAL value back and the edit is silently
  discarded. `Person.isFaithful` / `Repository`'s `wire === url` check are what
  prevent it. Two traps if you touch either:
  - **`rest` is the field the string branch forgets.** A shorthand has no
    syntax for extra keys, so a person decoded from `"Ann"` that later gains
    `rest` is *not* faithfully described by it — the three named fields still
    match, and without an explicit clause the added keys vanish on write.
    `isShorthandExpressible` is that clause.
  - **A test that rebuilds with `Person.make({ ...person, x })` cannot catch
    any of this.** That produces a NEW instance with no provenance, so the
    replay path is never reached. Mutate the same instance in place.
- **An edited shorthand re-emits as a shorthand.** When provenance is stale,
  `Person.FromValue` rebuilds the shorthand (`"Ann <new@x.dev>"`) rather than
  upgrading to the object form; the object form is the fallback **only** when
  the shorthand genuinely cannot carry the value (it gained `rest`). Shape
  fidelity is the promise — a manifest's `author` must not silently change
  representation because one field was edited — and data fidelity outranks it
  in the one case where they conflict. `isShorthandExpressible` decides both,
  deliberately the same predicate: split them and a person can be refused the
  replay yet handed back as shorthand, dropping the very keys the refusal
  detected.
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
