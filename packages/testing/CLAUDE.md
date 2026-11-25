# @effected/testing

Private test support for this workspace. It is never published: `"private": true` with no `publishConfig`, so it is not in the `effected` catalog and is not one of the kit's publishable packages. It has a `types:check` script and tests, and no build.

Concept → `okf/modules/testing.md`. Tier and depth rules → `okf/decisions/vitest-test-tiers.md`, `okf/conventions/testing-standards.md`.

## Rules

- **Zero `@effected/*` dependencies of any kind.** Any package whose tests need it takes this one as a devDependency (`workspace:*`), and turbo's `^types:check` graph must stay acyclic. `@effected/memfs` is the one package that never may: its own law allows no `@effected` edge, dev included.
- **No assertion library.** `Corpus.pin` and `Growth.assertOrder` throw through `node:assert/strict`; callers keep using `assert.*` from `@effect/vitest` for everything else.
- It is distinct from the `./testing` subpaths other packages export (`@effected/cli-kit/testing` and the like), which are consumer-facing helpers for those packages.

## Modules

- `Depth` reads `EFFECTED_TEST_DEPTH` (`sample` or `full`; unset is `sample`; anything else throws).
- `Corpus` selects a committed sample of a corpus at sample depth and pins exact counts at full depth.
- `Growth` is the one scaling-ratio measurement. Its own `Growth.hostile.test.ts` is the positive control and runs in the hostile tier on every pull request. With `EFFECTED_GROWTH_REPORT` naming a file it appends every measurement there, and `lib/scripts/growth-report.ts` prints the checks nearest their bounds; the Hostile Tests job does both on every run.

A test file that reads `Depth` or `Corpus` is named `.parity.test.ts`, `.corpus.test.ts` or `.property.test.ts`. A test file that reads `Growth` is named `.hostile.test.ts`. The root `__test__/test-kinds.test.ts` holds both rules.
