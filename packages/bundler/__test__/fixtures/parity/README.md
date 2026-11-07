# Parity fixtures

The output of the previous bundler for `@effected/jsonc`, which `__test__/e2e/parity.e2e.test.ts` compares `Bundler.build` against byte for byte.

- **Producing tool:** `@savvy-web/bundler@2.7.4`, through `pnpm build --filter @effected/jsonc --force`.
- **Date:** 2026-11-06.
- **Input:** `packages/jsonc` at the commit that added these files, built locally with no `CI` set, so the meta `package.json` carries the optimistic next versions of that moment.

`pkg/` holds `dist/prod/npm/pkg/{package.json,index.js,index.d.ts}`, `meta/` holds `dist/prod/npm/meta/{jsonc.api.json,package.json,tsconfig.json,tsdoctor.json}`, and `targets.json` is `dist/prod/targets.json`. All are verbatim, and `packages/bundler/biome.json` keeps the formatter away from this directory, since a reformat would break the comparison.

The bytes follow `packages/jsonc`, the `effect` it builds on and any pending changeset, so editing any of those changes the expected output. That is why the test is opt-in. The previous bundler is what proves the bytes: once it leaves the workspace these cannot be regenerated, only retired.
