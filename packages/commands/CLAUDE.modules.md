# Modules — @effected/commands

The seven source modules and the test layout. Surfaces only — the rules that
govern them live in the parent.

**Parent:** [@effected/commands context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/commands.md`

## Source modules

- `Redaction.ts` — `apply` / `applyArgs` (by **value**, from `Redacted`) and
  `scrubArgs` (flag heuristic). Value-based is primary; the heuristic is a
  backstop for secrets a caller forgot to declare.
- `Retry.ts` — `isTransient` / `transient()` / `TRANSIENT_PATTERNS`. Vocabulary
  for `Effect.retry({ while, schedule, times })`, **not** a retrying runner.
- `Run.ts` — `collect` / `collectTee` / `text` / `lines` / `json` / `jsonLine` /
  `exitCode` / `succeeds` / `stream` / `detach` / `extendEnv`, plus
  `CommandOutput`, `CommandFailedError` and `CommandOutputError` (`kind` +
  `command` + optional `cause`, with optional `exitCode` / `stderr` / `stdout`
  context — **already redacted**, carried by the combinators that parse
  independently of the exit code so a bad payload is diagnosable without a
  re-run).
- `ScriptedSpawner.ts` — the **public scripted-spawner test double**:
  `ScriptedSpawner.make(script)` returns `{ layer, spawns }` — a Layer providing
  core's `ChildProcessSpawner` answering from the script, plus the spawn log
  (command/args/cwd/env/extendEnv/full options/`unrefed`). Statics `notFound` /
  `permissionDenied` build the two common spawn-failure `PlatformError`s.
  Standard commands only; a piped command dies loudly. This does NOT violate the
  one rule: it implements nothing for production — it is the test-side analogue
  of `makeTest` on a service, providing core's own contract from a script.
- `LocalExec.ts` — the inverted contract `@effected/workspaces` implements:
  `LocalExec` (`context`, `None`-is-success), `LocalExecError`, `Launcher`,
  `LauncherPrefixes` and `ExecContext`. `prefixes(launcher)` holds three
  prefixes per manager — `exec`, `dlx` and the script runner — with matching
  `apply` / `applyDlx` / `applyScript`.
- `Tool.ts` — `Tool`, the `VersionProbe` union (`VersionFlag` / `VersionJson` /
  `VersionNone`), `ToolSource`, `MismatchPolicy`.
- `ToolDiscovery.ts` — the service + layer, `ResolvedTool`, the three tool
  errors, the evidence cache.
- `internal/capture.ts` — bounded stream capture. Not exported.

`Run`, `Redaction` and `Retry` are static classes with a private constructor,
not `as const` namespace objects — an `as const` object's member types are
inferred in the built `.d.ts` and lose their TSDoc entirely, while a class's
`static readonly` declarations keep it. Call syntax is unaffected
(`Run.collect(...)`); each internal implementation stays a plain function or
const carrying a one-line pointer comment, with the full contract TSDoc on the
static.

## Test layout

Unit suites and an e2e suite live in `__test__/` (`@effect/vitest`, `it.effect`,
`assert.*` — never `expect`).

- Every unit suite stubs the spawner with the **public** `src/ScriptedSpawner.ts`
  double (the former private `__test__/fixtures.ts` was deleted when it went
  public — same shape plus `hang` and the error statics, so the migration was a
  straight rename). It records spawns, including whether `unref` actually ran,
  and every recorder is `Effect.sync`/`suspend`-wrapped so it fires when the
  effect runs, not when it is built. Being load-bearing machinery, the double is
  itself tested directly (`__test__/ScriptedSpawner.test.ts`).
- The spawn log is how the cache tests assert *probe counts* — what makes
  "cached", "concurrent resolves share one probe" and "the guard refuses before
  any spawn" real assertions rather than plausible ones.
- e2e (`__test__/e2e/`) runs real `node` through `NodeServices.layer`, and is
  the only place the backpressure, detach-ordering and ENOENT-mapping claims can
  be proven.
