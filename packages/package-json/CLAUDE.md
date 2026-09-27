# @effected/package-json

package.json parsing, editing, validation and file IO as Effect schemas —
boundary tier. **One module per concept in `src/`**; the consolidation is the
point, do not re-fragment it. Everything exports from `src/index.ts` (single
entry point, no barrel re-exports below it) — read it for the inventory of
what each module owns.

## Knowledge bundle

Durable knowledge lives under `okf/`; `okf/project.md` is authoritative on the
package roster. Load the concept a task needs:

- `okf/modules/package-json.md` — Load when: changing the public surface, the
  tier or dependency posture, the module layout, the `rest` wire transform and
  `.extend()` story, wire provenance and the guarded replay, `Funding`,
  `Repository.directoryUrl`, `PackageManager` versus `PackageManagerRange`
  (its `packageManager` and `devEngines.packageManager` readers and three
  renderings), the error set, `PackageJsonFile`, or the Effect-wrapping policy.
- `okf/decisions/package-json-tolerance-ladder.md` — Load when: choosing
  between `Package`, `PackageManifest`, `LenientManifest`, npm's `Manifest`
  and the text path, or adding a tier.
- `okf/interfaces/package-json-text.md` — Load when: working on the decode-free
  text path — `PackageJsonFormat`'s canonical key order, `PackageIndent` /
  `"preserve"`, the surgical `modify` mutator, or re-baselining the
  `sort-package-json` fixtures.
- `okf/interfaces/package-json-entry-point.md` — Load when: touching
  `resolveEntryPoint`, its condition policy, or the `exports`-encapsulation
  rule.
- `okf/invariants/package-manager-shares-strict-schemas-by-identity.md` — Load
  when: touching `PackageManager`'s `version` or `integrity` field or the
  identity assertions that pin them.
- `okf/decisions/spdx-delegation.md` — Load when: touching `License.ts` or
  asking why `UNLICENSED` / `SEE LICENSE IN` live here and not in
  `@effected/spdx`.
- `okf/decisions/format-naming.md`, `okf/conventions/format-package-convention.md`
  — Load when: naming or shaping a formatter static.
- `okf/gotchas/api-extractor-forgotten-export-on-class-factories.md` — Load
  when: a build reports `ae-forgotten-export`; `savvy.build.ts` carries a
  **narrow** `_base` suppression — never widen it.

`Package.resolve` expands `catalog:` / `workspace:` specifiers through the
`CatalogResolver` / `WorkspaceResolver` contracts owned by `@effected/npm`
(`okf/modules/npm.md`); `PackageJsonFile.write` never resolves — compose
`Package.resolve` explicitly.

## Operating rules

- All IO lives in `src/PackageJsonFile.ts`; every other module is pure. If a
  change wants to read or write, route it through `PackageJsonFile` or leave
  it to the caller.
- `Schema.Class` instances are not `Pipeable` in v4; `Package` hand-rolls the
  `pipe` overload block. Preserve it.
- Never run an Effect inside a getter — decode via `Schema.decodeUnknownExit`.
- A new wire-provenance replay branch is presumed unguarded until a
  mutate-in-place round-trip test says otherwise; the string branch needs its
  own such test.
- `package.json` stays `"private": true`; the bundler emits the publishable
  manifest.

## Test and build

```bash
pnpm vitest run packages/package-json          # this package's tests
pnpm build --filter @effected/package-json     # from the repo root
```

Tests live in `__test__/` (`integration/*.int.test.ts` for `PackageJsonFile`),
use `@effect/vitest`, and assert with `assert.*` — **never `expect`**. Never
run `node savvy.build.ts --target prod` directly.
