# @effected/spdx

SPDX license identifiers, exceptions and license expressions as Effect Schema classes.

**Pure tier:** `dependencies: {}`, peer-depends on `effect` only, no IO, `"sideEffects": false`. Never add a filesystem, network or clock dependency here; a boundary-tier consumer owns that.

**Design doc:** `@../../.claude/design/effected/packages/spdx.md` — load when changing the public surface, the parser grammar, or regenerating the vendored datasets.

## Public surface

`src/index.ts` is the only re-exporting module. Outside it, modules import explicitly — no barrels.

- `src/License.ts` — `License` (`Schema.Class`) with a static valid/deprecated catalog, the derived catalog-metadata getters `referenceUrl` / `name` / `osiApproved` / `fsfLibre`, plus the single typed `InvalidSpdxExpressionError`.
- `src/LicenseException.ts` — `LicenseException` (`Schema.Class`) with its own valid/deprecated catalog.
- `src/SpdxExpression.ts` — `SpdxExpression` plus the tagged-union AST nodes `LicenseNode` / `LicenseRefNode` / `WithExceptionNode` / `AndNode` / `OrNode`, the sync predicate `isValidExpression`, and the expression-reading pair `primaryLicense` / `licensesOf`.

`License` and `LicenseException` each carry validating constructors `parse` (Effect) and `parseResult` (Result) — **not `make`**, which `Schema.Class` reserves — an `of(...)` construct-from-parts helper mirroring `SemVer.of`, and the predicates `isKnownId`, `isDeprecatedId`, `isLicenseRef`.

`SpdxExpression` is a recursive tagged-union AST built with `Schema.suspend`, carrying a `FromString` codec, an Effect `parse`, the sync `isValidExpression`, and a canonical fully-parenthesized `.toString()`. The parser is hardened and depth-capped: malformed or unknown input fails through `InvalidSpdxExpressionError`, never as a defect.

The `SpdxExpression` facade stays an `as const` object, NOT a static class: `export type SpdxExpression = LicenseNode | ... | OrNode` (the AST union) already claims that name as a type alias, and a type alias cannot merge with a class (only an interface can) — `export class SpdxExpression` would be a duplicate-identifier error. This is one of the three recorded holdouts in the kit's static-class-conversion sweep — with `@effected/config-file`'s `MergeStrategy` and `EncryptedCodecKey`, all three the same cause, a class cannot merge with a same-named type ([the container rule](../../.claude/design/effected/effect-standards.md#a-sanctioned-grouped-statics-container-is-a-static-class-not-an-as-const-object)); the facade's member TSDoc is consequently still exposed to the `as const` inference loss in the built `.d.ts`.

## Conventions and gotchas

- **`WITH` binds to a simple *expression*, and a reference is one.** Per the SPDX ABNF, `LicenseRef-Foo WITH Bison-exception-2.2` is grammatical, so `WithExceptionNode.license` is a **union** of `LicenseNode` and `LicenseRefNode` — never narrow it back. The parser materializes all three simple-license forms into one internal leaf and applies **one** shared `WITH <known exception>` check; never re-branch that tail, which is how the reference forms drifted from the id form. The exception must still be cataloged, and only a cataloged id may carry `+` (`LicenseRef-Foo+` is rejected).
- **The metadata getters are derived, never stored.** `referenceUrl` / `name` / `osiApproved` / `fsfLibre` read `src/internal/licenseMeta.ts`; `name` and `referenceUrl` are `Option` (none for a `LicenseRef-*`), the two flags are plain booleans. `referenceUrl` is **templated** from the id rather than vendored, because every upstream entry's URL is exactly `https://spdx.org/licenses/<id>.html` — the generator asserts that template against upstream for every id, so it is a checked invariant, not an assumption. Entries are `[id, name, flags]` tuples with bit flags, not objects: three repeated keys across 721 ids would cost consumers ~20 KB for no information. Never "tidy" them into objects.
- **`primaryLicense` returns `Option.none()` for `AND`, and that is the whole point.** Simple, `WITH` and `OR` (leftmost) all have a defensible single answer; a conjunction does not, and picking a term would silently drop one that legally applies. A caller that lands on none uses `licensesOf` — the ordered, de-duplicated array — instead. Never "improve" `AND` into a first-term guess.
- **`parse` / `parseResult`, never `make`.** `Schema.Class` reserves `make`, so the validating constructors take these names. The sync `Result` form is the primitive; the `Effect` twin derives from it — kit convention, `@../../.claude/design/effected/formatter-convention.md`.
- **Vendored datasets are real TypeScript under `src/internal/`** — 695 active + 26 deprecated license ids and 66 exceptions, committed as data literals (`licenseIds.ts`, `exceptions.ts`, `licenseMeta.ts`). Deprecated ids are valid-but-flagged, never rejected.
- **The datasets are devDep-only vendoring.** `spdx-license-ids`, `spdx-exceptions`, `spdx-expression-parse` and `oxc-parser` are **devDependencies only** — never import them from `src/**` at runtime. `scripts/generate-data.ts` regenerates the literals by rewriting their byte-spans via `oxc-parser`; re-run it and diff when the upstream data bumps (it is idempotent).
- **The metadata generator reads a vendored submodule, so re-pinning is an obligation.** `licenseMeta.ts` is generated from `.repos/spdx-license-list-data` (v3.28.0, CC0-1.0) — **read-only, like everything under `.repos/`; never write to it**. When the `spdx-license-ids` devDependency bumps, re-pin that submodule to a tag covering it **in the same commit** and re-run the generator; it fails loudly with that instruction when the catalog cannot cover an installed id.
- **Differential oracle test.** `__test__/oracle.int.test.ts` checks the engine against `spdx-expression-parse` and must agree on 695/695 ids. If the engine disagrees with the oracle, **fix the engine** — never pin the oracle back or exclude the case. **An oracle bump is a grammar review, not a version bump:** probe the new oracle's answers for the forms around the change and let the corpus record each accept and reject. A test-only ambient shim `types/spdx-expression-parse.d.ts` types the oracle dependency.
- `package.json` stays `"private": true`. The bundler emits the publishable manifest.

## Test and build

```bash
pnpm vitest run packages/spdx          # this package's tests
pnpm build --filter @effected/spdx     # dev + prod, from the repo root
```

Tests live in `__test__/` (`oracle.int.test.ts` is integration), use `@effect/vitest`, and assert with `assert.*` — **never `expect`**.

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
