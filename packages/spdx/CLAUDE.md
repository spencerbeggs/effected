# @effected/spdx

SPDX license identifiers, exceptions and license expressions as Effect Schema classes.

**Pure tier:** `dependencies: {}`, peer-depends on `effect` only, no IO, `"sideEffects": false`. Never add a filesystem, network or clock dependency here; a boundary-tier consumer owns that.

**Design doc:** `@../../.claude/design/effected/packages/spdx.md` — load when changing the public surface, the parser grammar, or regenerating the vendored datasets.

## Public surface

`src/index.ts` is the only re-exporting module. Outside it, modules import explicitly — no barrels.

- `src/License.ts` — `License` (`Schema.Class`) with a static valid/deprecated catalog, plus the single typed `InvalidSpdxExpressionError`.
- `src/LicenseException.ts` — `LicenseException` (`Schema.Class`) with its own valid/deprecated catalog.
- `src/SpdxExpression.ts` — `SpdxExpression` plus the tagged-union AST nodes `LicenseNode` / `LicenseRefNode` / `WithExceptionNode` / `AndNode` / `OrNode`, and the sync predicate `isValidExpression`.

`License` and `LicenseException` each carry validating constructors `parse` (Effect) and `parseResult` (Result) — **not `make`**, which `Schema.Class` reserves — an `of(...)` construct-from-parts helper mirroring `SemVer.of`, and the predicates `isKnownId`, `isDeprecatedId`, `isLicenseRef`.

`SpdxExpression` is a recursive tagged-union AST built with `Schema.suspend`, carrying a `FromString` codec, an Effect `parse`, the sync `isValidExpression`, and a canonical fully-parenthesized `.toString()`. The parser is hardened and depth-capped: malformed or unknown input fails through `InvalidSpdxExpressionError`, never as a defect.

## Conventions and gotchas

- **`parse` / `parseResult`, never `make`.** `Schema.Class` reserves `make`, so the validating constructors take these names. The sync `Result` form is the primitive; the `Effect` twin derives from it — kit convention, `@../../.claude/design/effected/formatter-convention.md`.
- **Vendored datasets are real TypeScript under `src/internal/`** — 695 active + 26 deprecated license ids and 66 exceptions, committed as data literals (`licenseIds.ts`, `exceptions.ts`). Deprecated ids are valid-but-flagged, never rejected.
- **The datasets are devDep-only vendoring.** `spdx-license-ids`, `spdx-exceptions`, `spdx-expression-parse` and `oxc-parser` are **devDependencies only** — never import them from `src/**` at runtime. `scripts/generate-data.ts` regenerates the literals by rewriting their byte-spans via `oxc-parser`; re-run it and diff when the upstream data bumps (it is idempotent).
- **Differential oracle test.** `__test__/oracle.int.test.ts` checks the engine against `spdx-expression-parse` and must agree on 695/695 ids. If the engine disagrees with the oracle, **fix the engine.** A test-only ambient shim `types/spdx-expression-parse.d.ts` types the oracle dependency.
- `package.json` stays `"private": true`. The bundler emits the publishable manifest.

## Test and build

```bash
pnpm vitest run packages/spdx          # this package's tests
pnpm build --filter @effected/spdx     # dev + prod, from the repo root
```

Tests live in `__test__/` (`oracle.int.test.ts` is integration), use `@effect/vitest`, and assert with `assert.*` — **never `expect`**.

Never run `node savvy.build.ts --target prod` directly: it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
