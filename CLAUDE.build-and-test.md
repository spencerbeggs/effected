# Build and test mechanics — effected

Child context file for how builds and tests actually run. The rules that bite live in the parent; this file explains the machinery behind them.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

## Build pipeline

[Turbo](https://turbo.build/) orchestrates builds across workspace packages: `pnpm build` runs `turbo run build:dev build:prod`. Each package builds with `node savvy.build.ts` using [@savvy-web/bundler](https://github.com/savvy-web/bundler), producing `dist/dev/` and `dist/prod/` outputs. Task graph: `build:prod` depends on `types:check` and `build:dev`; both depend on upstream `^build:dev`.

`@savvy-web/bundler` is a **`devDependency` of every package that builds** — it is what `savvy.build.ts` imports. The workspace sets `autoInstallPeers: true`, so root `devDependencies` are just `@savvy-web/silk` and `@vitest-agent/plugin`, with the rest auto-installed as peers.

The bundler's `publishConfig`-driven transform produces the publishable manifest at build time from the `"private": true` source manifest.

## Typechecking

**Every package typechecks with `tsc --noEmit`** (the `types:check` script), with `typescript` (`catalog:build`) as the devDependency behind it. **`catalog:build` is not declared in `pnpm-workspace.yaml`** — grep for it there and you find nothing. It is injected by the `@savvy-web/pnpm-plugin-silk` configDependency; its absence from the workspace file is expected, not a bug to repair by adding it. `@effect/tsgo` was removed from all packages (d0599438) and survives only as a catalog entry with no consumer — do not reintroduce it as a package's typechecker.

## Toolchain packages

The `@savvy-web/*` packages are in active development — if behavior seems unexpected, read the installed source in `node_modules/@savvy-web/`.

- **@savvy-web/bundler** — build pipeline, dual outputs, package.json transform.
- **@savvy-web/silk** — meta-package providing Biome config, commitlint/lint-staged presets, markdownlint custom rules, and tsconfig bases. Root `tsconfig.json` extends `@savvy-web/silk/tsconfig/node/root.json`.

Biome, commitlint, lint-staged and markdownlint all take their presets from `@savvy-web/silk`; configs live at the repo root and in `lib/configs/`.

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with the `@vitest-agent/plugin` `AgentPlugin` (project discovery, agent-friendly output, v8 coverage with `basic` thresholds); pool is `forks`.
- **Effect code**: test with `@effect/vitest` (`catalog:effect`).
- **Location**: tests live in each package's `__test__/` directory, never co-located in `src/` (unit: `*.test.ts`; e2e: `e2e/*.e2e.test.ts`; integration: `integration/*.int.test.ts`).
- **CI**: `pnpm ci:test` sets `CI=true`.

---

**Related context:** [CLAUDE.dependencies.md](./CLAUDE.dependencies.md) for catalogs and peer closure.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the repo overview.*
