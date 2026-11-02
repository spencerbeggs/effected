# @effected/plugin

The effected carrier: no logic of its own. `src/bin/effected.ts` and `src/bin/effected-mcp.ts` each call their front end's `main` (`@effected/cli/main`, `@effected/mcp/main`) with `distribution: { name: "@effected/plugin", version: PLUGIN_VERSION }`; `src/version.ts` holds `PLUGIN_VERSION`, which the bundler replaces at build.

- The front ends declare the same bin names on purpose (each also installs alone), so the e2e passes `allowSharedBins` and proves the carrier's shims with `runCarrierBin` / `carrierCommand`.
- `__test__/e2e/packed-install.e2e.test.ts` packs `dist/prod/npm/pkg` for the whole closure: build it first with `pnpm build --filter @effected/plugin...`. It skips locally without that build and fails under CI. Its pnpm workspace case proves the `publicHoistPattern` that `@effected/pnpm-plugin-effected` sets.
- Nothing belongs here but bin shims. Shared logic goes in `@effected/engine`.
