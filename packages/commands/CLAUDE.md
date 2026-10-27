# @effected/commands

Structured command running and CLI tool discovery over core's
`ChildProcessSpawner`: **run a command and get a typed result** (`Run`), and
**find out whether a tool is here and which copy to use** (`ToolDiscovery`).
Boundary tier; `effect` is the only peer.

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

## Kit-ports modules (not yet in okf — the branch-end pass folds them in)

- **`LocalExec.parse(argv)`** — the inverse of `LocalExec.prefixes`, derived
  from the same `PREFIXES` table plus a private recognition-only `ALIASES`
  table (`npm exec`, `npx -y`, `pnpx`, `bunx`, …); longest prefix wins, a
  binary starting with `-` is refused. Implicit forms (`pnpm vitest`) are
  deliberately `Option.none()`. Never let `prefixes` emit an alias.
- **`PrebuiltBinary.resolveSync(spec, host)`** (`src/PrebuiltBinary.ts`, root) —
  the optionalDependencies fan-out resolver, pure over a caller host. Only
  `MODULE_NOT_FOUND` is `"notInstalled"`; anything else is `"unresolvable"`.
  The Node host is `nodePrebuiltHost(anchor)` in `./node-sync`; the anchor must
  be the declaring package's `import.meta.url`.
- **`RunOnce`** (`src/RunOnce.ts`, root) — `runSync`, `commandSync`, and the
  `Effect` `run`. The protocol is ONE generator, `src/internal/runOnceMachine.ts`;
  both drivers only answer its IO requests. Never put a rule in a driver.
  Invariants: trust is nonce-observed (a done marker counts only from an
  owner this caller saw in ANY read of the lock; `trustSequentialMs` is the
  opt-in); the lock is read before the done marker; same-host owners are
  pid-probed every poll; breakers are per-contender TICKETS
  (`<key>.lock.break.<nonce>`): create your own, list, proceed only if no
  other live ticket exists, else withdraw and back off — abandoned tickets
  are removed by their unique name, and nothing about a breaker is ever
  renamed or put back (a put-back of a single shared breaker file is what let
  a third caller in; do not reintroduce one); lock removal is rename-to-tomb
  compare-and-delete judged on the tomb, tombs named with their rename time
  and GC'd by it (a rename keeps mtime); release is owner-only and retried;
  failure and unserialized runs write no marker. The `Effect` driver is
  uninterruptible while holding the lock (restore only around `Sleep` and the
  work).
- **The protocol is model-checked.** `__test__/runOnceModel.ts` is a bounded
  stateless model checker (inode-modelled files, non-atomic writes,
  preemption bound, crashes); `__test__/RunOnce.model.test.ts` runs the
  in-suite bounds. Any change to `runOnceMachine.ts` must stay clean there AND
  at the review's full bounds (scenarios a–h and g0), run offline in a
  subprocess under a hard timeout. A rule the model cannot reach (it treats a
  finished process as dead) gets a scripted test in `RunOnce.sync.test.ts`.
- **`ProcessLiveness`** — the kit-declared liveness contract (core has none),
  provided as `ProcessLiveness.layerFrom(nodeProcessLiveness)`: the Node
  object lives in `./node-sync` as a plain sync value, never a layer, and
  there is no `./node` subpath (lead ruling 2026-10-26).
- **`ModuleResolution`** (`src/ModuleResolution.ts`, `./node-sync` only) —
  anchored resolve (ESM-first via the CALLER's `import.meta.resolve`, then
  `createRequire`), `isStale`, `load` with an importer seam. cli's Ink loader
  is its in-kit consumer. `src/internal/anchor.ts` is the one `createRequire`
  call, shared with `nodePrebuiltHost`.
- **`./node-sync`** now also carries `nodeRunSync` (file-backed capture: no
  pipe, so no `ENOBUFS` — keep it that way), `nodeRunOnceFileSystem`,
  `nodeRunOnceHost` and `nodeProcessLiveness`. A type re-exported from both
  entries must not `{@link}` a symbol that only `.` exports — that is an
  `ae-unresolved-link` on the node-sync report; spell it in backticks.

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
