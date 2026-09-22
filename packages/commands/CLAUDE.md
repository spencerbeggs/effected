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
- Requiring core services in `R` rather than owning a backend →
  `okf/conventions/require-in-r-default.md`.

## Working here

Tests live in `__test__/` (unit plus `e2e/`): `@effect/vitest`, `it.effect`,
`assert.*` — never `expect`. Unit suites stub the spawner with the public
`src/ScriptedSpawner.ts` double and assert on its spawn log; e2e runs real
`node` through `@effect/platform-node`, which is a **devDependency for e2e
only** — never a dependency or peer.

```bash
pnpm vitest run packages/commands/__test__   # from the repo root, always
pnpm build --filter @effected/commands       # never `node savvy.build.ts`
```

A positional filter from *inside* the package matches nothing and prints
`Tests: 0/0 passed`; use `--project @effected/commands`, which works from
any directory.

`savvy.build.ts` carries the narrow `_base` suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the
synthesized class-factory bases; a clean prod `issues.json` has 0 warnings,
0 errors. **Never widen it** — a genuine `ae-unresolved-link` is fixed by
spelling schema-declared fields and shape-interface members in backticks,
not suppressed.
