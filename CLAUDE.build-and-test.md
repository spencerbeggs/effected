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
- **Filesystem doubles**: a suite requiring `FileSystem` provides `@effected/memfs` (a devDependency), never a hand-rolled `FileSystem.layerNoop` over a `Map`. Misbehaviour goes in as a fault handler (`layerFaultyWith` / `makeFaulty`) that declines by returning `undefined`, so the fixture delegates everything it does not name; `layer*` re-seeds per `Effect.provide`, while `make*` + `Layer.succeed` pins one volume for assertions that run after the effect. Rule and riders → `@./.claude/design/effected/effect-standards.md`.
- **Location**: tests live in each package's `__test__/` directory, never co-located in `src/` (unit: `*.test.ts`; e2e: `e2e/*.e2e.test.ts`; integration: `integration/*.int.test.ts`).
- **Pre-build**: the root `globalSetup` (`vitest.setup.ts`) runs `turbo run build:dev --output-logs=errors-only` via `AgentPlugin.runScript` before **every** vitest run — CLI and the MCP `run_tests` tool alike — so tests always see fresh `dist/dev` artifacts. Turbo's cache makes it a fast no-op when nothing changed.
- **Scratchpad**: the `scratchpad` vitest project (agent probe venue, contract in `scratchpad/CLAUDE.md`) exists locally only — the discover strategy in `vitest.config.ts` drops it when `CI` is set, and `scratchpad/**` is excluded from coverage. Run it with `pnpm exec vitest run --project scratchpad --coverage.enabled=false`.
- **CI**: `pnpm ci:test` sets `CI=true`.
- **Coverage thresholds**: `vitest.config.ts` applies the global thresholds **only** when `CI` is set or the run passes `--coverage`. They measure the whole repo, so a filtered run (`vitest run <path>`, `--project <name>`) would fail them by construction with every selected test green — which is what once made a local exit code meaningless. Locally, an unfiltered-threshold run's **exit code is a real signal again**; do not "restore" unconditional thresholds.

## Probes: write no file

An agent probing behaviour must not leave a file under `__test__/`. A stray `__test__/tmp-probe.test.ts` is collected by the ordinary suite and inflates the `Tests:` count, and the inflation looks exactly like added coverage — which destroys the count-delta audit below. **Do not solve this with an exclude pattern**: an exclude catches only the names someone predicted, and it fails silently when it misses.

Three mechanisms, in order of preference:

1. **A probe that writes no file cannot be collected.** Run it from inside the package: `cd packages/<name> && node --input-type=module -e '<script>'`. `-e` writes nothing to disk, and running from *inside* the package is what makes bare specifiers (`effect`, `@effected/*`) resolve — under pnpm's store layout the **importer's** location decides resolution, so the same script run from the repo root dies with `ERR_MODULE_NOT_FOUND` on `@effected/*`.
2. If a file is genuinely needed, `scratchpad/` is the sanctioned venue (see above and `scratchpad/CLAUDE.md`).
3. Backstop only: `@vitest-agent/plugin` prints a warning on a zero-collection run.

## Reading the gates

Three of this repo's gates are assertions that a **number did not change**: the `suppressed:` count in `dist/<target>/issues.json` (where `suppressed: 0` usually means the build never ran), the `Tests:` line from a suite run, and `packages.length` assertions in fixture tests. Each has independently caught a silent wrong answer.

Each also shares one weakness: **the number lives in one place and its reason lives in another**, so a diff alone cannot say whether a moved count is a regression or a correct consequence. The discipline that works: **when a count moves, state which count and why, in the report. An unexplained count change is a finding, not noise.** When you add or change a count gate, write next to it what would have to be true for the number to change legitimately.

## Absence results need a second, differently-derived source

**An absence result and a broken query are indistinguishable at the call site.** A grep returning zero, a `str.replace` that matched nothing, a projection that dropped the field, a mutant nothing caught, a build log with no errors — each looks identical whether or not the thing you care about is true. `suppressed: 0` and "the build did not run" produce the same JSON; a cached turbo replay and a real build produce the same clean log.

The remedy is not a better query — it is **a positive control asserted first**: prove the query finds something you *know* is there, then trust it to report that something is not. And the sharp form, which is the one that gets skipped: **the control must expect a NON-ZERO answer.** A control returning zero when zero is correct looks exactly like success on a broken tool.

Where a control is impossible, use a second signal derived **differently** — `generatedAt` in `issues.json` against source mtime for "did this build actually run", `pnpm run lint` against the MCP tool for a severity, the whole-suite `Tests:` line against a filtered one.

**A control must vary only the thing under test.** Expecting a non-zero answer is necessary and not sufficient: a control run against the **suspect input** cannot distinguish "the tool is broken" from "this input is special". Run it against a **known-good** input — a file you are confident about, not the one that produced the surprising result.

This is not hypothetical. A run of `grep -c ""` that returned nothing was read as proof that `grep` itself was broken, and the conclusion "every grep-derived negative is unverified" followed. The control had been run against the very file that was the problem. `grep` was fine; the file was not.

**The concrete trap: a single NUL (`U+0000`) byte makes a source file binary to `grep` and `rg`, which then skip its contents.** Measured: on a file whose only difference is one embedded NUL, `grep` prints **nothing and exits 1** — byte-identical to a genuine no-match — while `rg` at least says `binary file matches` and exits 0. `grep -a` / `rg --text` search it correctly. A NUL reaches a source file legitimately (a delimiter in a template string), so this is a property of one file, never of the environment: **scope the suspicion to the file before you indict the tool.**

---

**Related context:** [CLAUDE.dependencies.md](./CLAUDE.dependencies.md) for catalogs and peer closure.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the repo overview.*
