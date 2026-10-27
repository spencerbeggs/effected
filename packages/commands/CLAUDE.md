# @effected/commands

Structured command running and CLI tool discovery over core's
`ChildProcessSpawner`: **run a command and get a typed result** (`Run`), and
**find out whether a tool is here and which copy to use** (`ToolDiscovery`),
plus `RunOnce`, `PrebuiltBinary`, `LocalExec.parse` and, behind
`./node-sync`, `ModuleResolution`. Boundary tier; `effect` is the only peer.

Durable knowledge about this package lives in the OKF bundle, not here. Start
at `okf/modules/commands.md` and load what the task needs:

- The package as a whole — the one rule (every subprocess concept is core's,
  and no implementation of one is), tier and dependencies, the module map,
  what `Run` decides, errors, redaction and retry, tool discovery, test
  doubles, observability, consumers → `okf/modules/commands.md` — Load when:
  changing or extending any source module, changing a surface's shape, or
  before adding anything that smells like a `Command` type, a spawner, a
  platform layer, a `node:` import or a shell helper.
- Why `LocalExec` is declared here and implemented by `@effected/workspaces`
  → `okf/decisions/commands-workspaces-edge-inverts.md`,
  `okf/decisions/contract-inversion-default.md` — Load when: tempted to add
  an `@effected/*` edge, or touching `LocalExec`, `ExecContext` or the
  package-manager prefix table.
- `Run.text` corrupts fixed-column output; `npm run` eats flags without a
  `--` → `okf/gotchas/run-text-trims-fixed-columns.md`,
  `okf/gotchas/npm-run-eats-flags.md` — Load when: parsing porcelain-style
  output, or editing a script-runner prefix.
- `collect` must drain stdout, stderr and the exit code concurrently, and
  only the e2e backpressure test can prove it →
  `okf/invariants/collect-drains-both-pipes-concurrently.md` — Load when:
  touching `collectRaw` or anything under `__test__/e2e/`.
- What this package deliberately leaves to `@effected/github-actions`
  (signalling a pid, readiness polling, archives) →
  `okf/limitations/commands-no-process-supervision.md` — Load when: asked
  to add process supervision, a poll helper or a `tar` wrapper here.
- The sync facade (`makeToolDiscoverySync`, the `./node-sync` entry) and
  why a global-only tool probes as local through the launcher's `PATH`
  fall-through → `okf/modules/commands.md` (tool discovery),
  `okf/decisions/second-published-entrypoint.md`,
  `okf/limitations/commands-local-probe-fallthrough.md` — Load when:
  touching either discovery surface, the shared resolution core in
  `internal/toolResolution.ts`, or `Tool.prefer`.
- Requiring core services in `R` rather than owning a backend →
  `okf/conventions/require-in-r-default.md`.
- `RunOnce` — the run-once protocol (nonce-observed trust, lock read before
  the done marker, per-contender breaker tickets, rename-to-tomb
  compare-and-delete and its put-back residual, the recycled-pid age rule,
  no heartbeat, a driver removes only a file it created, the model checker)
  → `okf/decisions/run-once-trust.md`; the surface, `ProcessLiveness` and
  the drivers → `okf/modules/commands.md` (run once across processes) —
  Load when: touching `src/RunOnce.ts`, `src/internal/runOnceMachine.ts`,
  `nodeRunOnceFileSystem` / `nodeRunOnceHost`, or any `RunOnce` test.
- `PrebuiltBinary`, `LocalExec.parse` and `ModuleResolution` →
  `okf/modules/commands.md` (prebuilt binaries and launcher argv; anchored
  module resolution) — Load when: touching those modules,
  `src/internal/anchor.ts`, or the `ALIASES` table.
- What the signal-0 liveness probe is and is not →
  `okf/limitations/commands-no-process-supervision.md`.

Rules that bite while editing:

- **Never put a rule in a `RunOnce` driver.** The protocol is ONE generator,
  `src/internal/runOnceMachine.ts`; `runSync` and `run` only answer its IO
  requests. Never reintroduce a single shared breaker file or any put-back
  of a breaker (that is what let a third caller in). The `Effect` driver is
  uninterruptible while holding the lock (restore only around `Sleep` and
  the work).
- **The protocol is model-checked.** Any change to `runOnceMachine.ts` must
  stay clean in `__test__/RunOnce.model.test.ts` AND at the review's full
  bounds (scenarios a–h and g0), run offline in a subprocess under a hard
  timeout. A rule the model cannot reach (it treats a finished process as
  dead) gets a scripted test in `RunOnce.sync.test.ts`.
- **Never let `LocalExec.prefixes` emit an alias**; `parse` recognises the
  aliases, `prefixes` hands out the canonical table only.
- **`nodeRunSync` captures to files, not pipes** (no `ENOBUFS`) — keep it
  that way. `src/internal/anchor.ts` is the one `createRequire` call.
- **A type re-exported from both entries must not `{@link}` a symbol only
  `.` exports** — that is an `ae-unresolved-link` on the node-sync report;
  spell it in backticks.

## Working here

Tests live in `__test__/` (unit plus `e2e/`): `@effect/vitest`, `it.effect`,
`assert.*` — never `expect`. Unit suites stub the spawner with the public
`src/ScriptedSpawner.ts` double and assert on its spawn log; e2e runs real
`node` through `@effect/platform-node`, which is a **devDependency for e2e
only** — never a dependency or peer. `RunOnce`'s `Effect` driver is tested
over `@effected/memfs` (a devDependency) and `TestClock`; its sync driver over
an in-memory host whose `sleep` is where "another process" acts.
`__test__/e2e/RunOnce.e2e.test.ts` races four real `node` processes through
`__test__/e2e/fixtures/run-once-child.mjs`, which imports the **dev build**
(`dist/dev/pkg`) — rebuild before trusting it after a source edit.

```bash
pnpm vitest run packages/commands/__test__   # from the repo root, always
pnpm build --filter @effected/commands       # never `node savvy.build.ts`
```

Run vitest from the repo root. From *inside* the package vitest does not load
the root config, so `--project @effected/commands` fails with
`No projects matched the filter` and a positional filter finds no test files.

`savvy.build.ts` carries the narrow `_base` suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the
synthesized class-factory bases; a clean prod `issues.json` has 0 warnings,
0 errors. **Never widen it** — a genuine `ae-unresolved-link` is fixed by
spelling schema-declared fields and shape-interface members in backticks,
not suppressed.
