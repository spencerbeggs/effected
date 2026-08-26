# @effected/package-json

package.json parsing, editing, validation and file IO as Effect schemas. **One module per concept in `src/`** — the consolidation is the point; do not re-fragment it. (Test counts move every commit and are not tracked here; run `pnpm test --filter @effected/package-json`.)

**Design doc:** `@../../.claude/design/effected/packages/package-json.md` — load when
changing the public surface, the `rest` wire transform, the tolerance ladder or
the error taxonomy. One child:

- `@../../.claude/design/effected/packages/package-json-text.md` — Load when:
  working on the decode-free text path — `PackageJsonFormat`'s canonical key
  order, `PackageIndent`/`"preserve"`, or the surgical `modify` mutator.

## Tier: boundary

**Boundary tier**, driven by the IO boundary. It carries no third-party runtime
dependency — its `dependencies` are `workspace:^` edges to pure `@effected`
packages (`jsonc`, `npm`, `semver`, `spdx`) plus the `effect` peer — so it never
rises to integrated.
All IO **lives in `src/PackageJsonFile.ts`** — one module, one `Context.Service`,
five methods: `read` / `write` (strict `Package`), `readManifest` /
`writeManifest` (the presence-lenient `PackageManifest`, which accepts the
private workspace-root shape `read` rejects), and `modify`. Every other module is
pure. Keep it that way: if a change wants to read or write, route it through
`PackageJsonFile` or leave it to the caller. `PackageJsonFile` reads and writes over core `FileSystem` / `Path`
(v4 — no `@effect/platform` peer); its layer requires those services, and the
consumer provides `@effect/platform-node` at the edge.

It depends on `@effected/npm`, `@effected/semver` and `@effected/spdx` via
`workspace:^`. **Core SPDX license validity is delegated to `@effected/spdx`**
(`License.ts` calls its `isValidExpression`); this package keeps only its
npm-specific `UNLICENSED` and `SEE LICENSE IN` cases. That delegation dropped the
former `spdx-expression-parse` runtime dependency and its ambient shim — the dep
that once made this package integrated — so its tier is now boundary.

**Do not split the IO into its own package.** The motivation would be isolating
an `@effect/platform` peer, and in v4 the platform abstractions live in `effect`
core, so there is nothing to isolate. It stays a one-module extraction should
that ever change.

## Relationship to @effected/npm

`Package.resolve` expands `catalog:` and `workspace:` specifiers, but this
package cannot implement resolution — it has no view of the workspace. The
service contracts (`CatalogResolver`, `WorkspaceResolver`,
`DependencyResolutionError`) therefore spun out into the internal sibling
`@effected/npm`, which ships shape-only contracts plus no-op layers. `Package.ts`
imports them; an application supplies the real implementation.

`PackageJsonFile.write` never resolves. Compose `Package.resolve` explicitly.

## Public surface

Everything exports from `src/index.ts` (single entry point; no barrel re-exports below it). The module-by-module map of what that entry point carries lives in `@./CLAUDE.surface.md` — Load when: looking for which module owns a construct, or adding an export.

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
  are NOT frozen — so the replay must be guarded.** `Person`, `Repository`,
  `Bugs` and `Funding` each remember the exact wire value an instance was
  decoded from and replay it on encode for byte-level fidelity. An instance
  mutated **in place** keeps its provenance entry while no longer being
  described by it; an unguarded replay then writes the ORIGINAL value back and
  the edit is silently discarded. **Every replay branch must therefore be
  guarded by a faithfulness check** — on the object branches
  `Person.isFaithful`, `isFaithfulRepository`, `isFaithfulBugs` and `Funding`'s
  `isFaithfulObject`; on the string branches value equality on the url AND an
  expressibility predicate (`isShorthandExpressible`,
  `isStringExpressibleRepository`, `isStringExpressibleBugs`,
  `Funding`'s `isStringExpressible`), because a shorthand carries only the url
  and silently drops anything the value gained that it has no syntax for.
  `Repository` and `Bugs` once shipped this bug on BOTH branches: the object
  branches replayed unconditionally, and the string branches checked only that
  the url still matched, so a value that gained a field the shorthand cannot
  express re-encoded without it. A new replay branch is presumed to have that
  bug until a mutate-in-place round-trip test says otherwise — and the string
  branch needs its OWN such test, because an object-input one never reaches it. Three
  traps if you touch any of them:
  - **`rest` is the field the string branch forgets.** A shorthand has no
    syntax for extra keys, so a person decoded from `"Ann"` that later gains
    `rest` is *not* faithfully described by it — the three named fields still
    match, and without an explicit clause the added keys vanish on write.
    `isShorthandExpressible` is that clause.
  - **`rest` counts as part of the value on the object branch too.** A
    faithfulness check comparing only the named fields passes while a key
    added to `rest` after decoding is silently dropped, so each check compares
    `rest` against the remembered wire's unknown keys as well.
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
