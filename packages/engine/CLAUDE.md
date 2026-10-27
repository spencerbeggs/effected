# @effected/engine

Platform-free primitives shared by every front end of an Effect v4 tool:
distribution identity, remediation, launch context, a one-permit lane for
process-global work with its scoped restores, and transport-neutral process
crash guards (`./guard`).

**Design doc:** `@./okf/modules/engine.md` — Load when: changing the public
surface, adding a new cross-front-end primitive, or deciding whether a
capability belongs here versus in `@effected/cli` or a consumer's own
`engine` package.

## Pure tier — no exceptions

`effect` is the only peer, and the only dependency of any kind. No
`process`, no `node:` import, no platform package — not even as a
devDependency edge into `src/`. There is no IO here and nothing to provide
at the edge.

**Kit dependents are `@effected/mcp` (peer) and `@effected/cli` (a regular
dependency, for `CliRuntime.main`'s `distribution` option).** Why a regular
dependency → `@./okf/decisions/cli-engine-edge.md`. Adding any other
dependent is a new Decision, not a drive-by import.

## Public surface

One module per concept. `src/index.ts` is the only re-exporting module.

- `src/Distribution.ts` — `Distribution` (`Schema.Struct` + type),
  `DistributionField` (`Schema.NullOr(Distribution)`), `CurrentDistribution`
  (a `Context.Reference`, not a `Context.Service` — reading it adds nothing
  to `R`), `distributionSuffix`.
- `src/Remediation.ts` — `Remediation` (`Schema.Struct` + type): what a
  caller, usually an agent, should do after a failure.
- `src/Distribution.ts` also carries `withDistributionVersion(d)(formatVersion)`
  (decorates a `--version` formatter shaped like
  `CliOutput.Formatter["formatVersion"]` with `distributionSuffix`; it WRAPS
  the formatter in effect, coloured or custom, never replaces it) and
  `withDistribution` (provides `CurrentDistribution` from a nullable value).
  `@effected/cli`'s `MainOptions.distribution` is built on both.
- `src/LaunchContext.ts` — `LaunchContext` (`usable`, `resolve`,
  `projectDir`, `isUnsubstituted`), `ProjectDirInput` and `ResolveInput`:
  resolves launch-supplied locations from caller-supplied `argv`/`env`/`cwd`
  rather than reading `process` itself. `usable` (trim, reject empty and
  `${VAR}`) is the one guard; `resolve` returns `Option`; `projectDir` is
  `resolve` with the `cwd` fallback. No host constant (`CLAUDE_PLUGIN_DATA`)
  is baked in: callers pass `keys`.
- `src/Exclusive.ts` — `Exclusive` (`make`, `promise`, instance `run`),
  `ExclusivePromiseOptions`, `ExclusiveRunOptions`, `ExclusiveTimeout`: a one-permit lane. Queue wait
  is interruptible; once the permit is held the caller's interrupt is
  masked; the REQUIRED timeout interrupts only the body; the body's scope
  closes, then the permit is released, then the caller sees the outcome.
  `Exclusive.promise` aborts its signal on interrupt and then WAITS for the
  promise to settle (core's `Effect.promise` abandons it). That wait hangs
  forever on a promise that ignores its signal; `abandon: true` aborts and
  resumes at once instead. The body's scope still closes before the permit
  is released either way.
- `src/ProcessScope.ts` — `ProcessScope` (`chdir`, `env`), `ProcessCwdHost`,
  `ProcessScopeError`: scoped restores of the working directory and an env
  record. The state is passed in (structural host, plain record), so the
  module reads no `process`. No temp-dir helper: it would be IO, which this
  pure tier does not do.
- `src/ProcessGuard.ts` — `ProcessGuard` (`run`, `parseInjectCrash`) plus the
  `ProcessGuardHost`, `ProcessGuardPolicy`, `ProcessGuardControl`,
  `ProcessGuardOptions` and `ProcessGuardInjection` types: transport-neutral
  crash guards. Exported **only** from the `./guard` subpath
  (`src/guard.ts`), never from `src/index.ts`.

## `./guard` has no runtime import at all

`src/guard.ts` and `src/ProcessGuard.ts` import nothing, not even `effect`
or a type: the guards must be listening before anything a server's
`main.ts` loads evaluates. `__test__/entrypoints.test.ts` pins the source
graph AND the built `dist/dev/pkg/guard.js` graph to `guard` +
`ProcessGuard` with zero packages; `@effected/mcp`'s own entrypoint test
re-checks the installed copy, because `McpGuard.ts` statically imports it.
The host is structural (`on`/`emit`/`stderr`/`exit`), so the purity rule
holds: `process` is passed in by the caller. `setTimeout` (for
`injectCrash`) is the only global used.

`ProcessGuard.run` launches nothing. The caller's `load(guard)` starts the
server and calls `guard.markConnected()` once it is serving (a plain
callback, so a non-Effect LSP and `McpGuard`'s `McpStdio.launch` `onReady`
use the same shape) and `guard.useFormat(fn)` to upgrade the fallback
formatter. Report wording is `McpGuard`'s, unchanged, because `McpGuard.run`
is now this guard plus an MCP launch.

## Test and build

Tests live in `__test__/`, use `@effect/vitest`, assert with `assert.*` —
never `expect`.

```bash
pnpm vitest run --project @effected/engine   # this package's tests, from the repo root
pnpm build --filter @effected/engine         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` that
looks exactly like a clean gate.
