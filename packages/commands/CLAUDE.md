# @effected/commands

Structured command running and CLI tool discovery over core's
`ChildProcessSpawner`, designed together: **run a command and get a typed
result** (`Run`), and **find out whether a tool is here and which copy to use**
(`ToolDiscovery`).

**Design doc:** `@../../.claude/design/effected/packages/commands.md` — load when
changing a surface's shape or reconsidering the `LocalExec` inversion.

## Child context files

Children carry surfaces and evidence; **every rule is here**.

- Modules → `@./CLAUDE.modules.md` — Load when: changing or extending one of the source modules, or looking for the test layout.
- Rationale → `@./CLAUDE.rationale.md` — Load when: tempted to change a rule below, or working out why a given test exists.

## Tier: boundary

`effect` is the only peer. **Zero runtime dependencies, zero `@effected/*`
edges, zero `node:` imports anywhere in `src/`.** IO arrives through `R`: core's
`ChildProcessSpawner` for every run, core's `Stdio` for `Run.collectTee` only.
`@effect/platform-node` is a **devDependency for `__test__/e2e/` only** — never
a dependency or peer.

The tier is **conditional on the `LocalExec` inversion**: `LocalExec.ts`
declares the narrow contract `@effected/workspaces` implements, and that is what
keeps the edge count at zero. A direct `@effected/workspaces` edge would make
this package integrated and, through the `@effected/npm` → `commands` edge, drag
`npm`, `lockfiles` (pure!) and `package-json` up a tier with it.

## The one rule this package exists to obey

**Every subprocess concept here is core's, and no implementation of one is.**

Importing core's vocabulary faithfully is necessary but **not sufficient** — a
package can speak core's types and still be wrong by implementing them. A
previous `@effected/commands` was deleted for exactly that
([rationale](./CLAUDE.rationale.md)).

Never add: a `Command` type, a service wrapping `ChildProcessSpawner`, a spawner
backend, a platform layer, a `node:child_process` import, or a shell helper.
`Run` is **free functions**, not a service, for exactly this reason.

## The things that will bite you

- **`{ concurrency: "unbounded" }` in `collectRaw` is load-bearing.** Collecting
  stdout, stderr and the exit code sequentially **deadlocks** when either OS
  pipe buffer fills, and a mock spawner cannot reproduce it: **do not delete
  `__test__/e2e/Run.e2e.test.ts`'s backpressure test.**
- **A non-zero exit is a RESULT for `collect`, `exitCode`, `succeeds` and
  `jsonLine`, and a typed `CommandFailedError` for `text`, `lines` and `json`.**
  Deliberate; do not "fix" either half.
- **`Run.text` trims** leading *and* trailing whitespace, which silently
  corrupts fixed-column output (`git status --porcelain`'s leading-space status
  column). Parse that from `Run.collect`'s untrimmed `CommandOutput.stdout`.
- **`Run.jsonLine` is framing, not a lenient `Run.json`.** It scans stdout lines
  from the **end** and takes the first that both JSON-parses and decodes,
  tolerating log noise on either side of the payload — so if two lines decode,
  the **last** wins. A child must not emit two schema-valid lines; discriminate
  your envelope with a required `ok` literal. It parses **regardless of the exit
  code** (a protocol payload discriminates success in-band); for exit-code
  semantics over whole-stdout JSON use `Run.json`. **Never re-hand-roll
  last-line parsing at a call site.**
- **Absence is a spawn failure, never an exit code.** `ToolDiscovery` decides
  presence by whether the process **ran** — a tool whose `--version` exits 1
  exists. There is deliberately no `command -v` probe, and the e2e pins the
  ENOENT → `NotFound` mapping the classification rests on.
- **Cache probe evidence, never resolved answers** — keyed by
  `(name, version probe)`, with policy (`source`, `onMismatch`) applied per
  call. **Only a positive result gets `Duration.infinity`; everything else gets
  zero**: a memoized failure would stick for the process lifetime, and a
  memoized "not found" would outlive a tool installed mid-process.
- **`Run.detach` is spawn → `unref` → pid, and the ordering is the whole
  point.** Reversed, the child dies with the scope. The e2e pins it **both
  ways** — unref'd survives, plain scoped spawn is killed — because the survival
  half alone passes even if nothing ever killed a child.
- **`RunOptions` carries only what a core `Command` cannot**: `timeout` (**no
  default**), `redact`, `maxOutputBytes`. `cwd`, `env`, `extendEnv`, `stdin`,
  `shell` and kill signals are core `CommandOptions` fields; duplicating them is
  the re-declaration that killed the previous package.
- **Use `Run.extendEnv` to add environment variables without losing the parent
  environment.** Core's `setEnv` never sets `extendEnv`, so bare
  `setEnv({ X: y })` spawns a child whose ENTIRE environment is that one
  variable — no `PATH`, silent at the type level. A hermetic env is what bare
  `setEnv` is for; keep the unit CONTROL pinning core's behaviour.
- **`prefixes(launcher)` is the one home of the four managers' argv** (`exec`,
  `dlx`, script runner), and `scriptPrefix` is a **required** `ExecContext`
  field so an implementation cannot forget it. npm's is `["npm", "run", "--"]`
  because bare `npm run <script> --flag` claims the flag for npm.
- **The test doubles do not default the same way, on purpose.**
  `ToolDiscovery.makeTest` dies on every unstubbed member; `LocalExec.makeTest`
  deliberately does not, because `Option.none()` *is* the global-only wiring,
  not a fabrication (recorded exception, 2026-07-25: the test is "would a real
  implementation legitimately answer this?").
- **`collectTee` is a separate combinator, not an option.** Only it requires
  core `Stdio` in `R`, and an option cannot vary the `R` channel.
- **Two Biome rules false-positive on Effect idioms here** —
  `useIterableCallbackReturn` on `Sink.forEach`, `useGetterReturn` on an
  exhaustive `switch` in a getter. Fix each narrowly (a reasoned
  `biome-ignore`; an if-chain with the final variant as tail return), never by
  restructuring the sink or disabling a rule.

## Testing and building

Tests live in `__test__/` (unit plus e2e): `@effect/vitest`, `it.effect`,
`assert.*` — never `expect`. Unit suites stub the spawner with the public
`src/ScriptedSpawner.ts` double and assert on its spawn log; e2e runs real
`node`.

```bash
pnpm vitest run packages/commands/__test__   # from the repo root, always
pnpm build --filter @effected/commands       # never `node savvy.build.ts`
```

A project-filtered run from *inside* the package prints `Tests: 0/0 passed` and
exits 0.

`savvy.build.ts` carries the narrow `_base` suppression
(`{ messageId: "ae-forgotten-export", pattern: "_base" }`) for the synthesized
class-factory bases; a clean prod `issues.json` has 0 warnings, 0 errors.
**Never widen it**: the genuine `ae-unresolved-link` warnings this package hit
were *fixed* (schema-declared fields and shape-interface members cannot be
`{@link}` targets — use backticks), not suppressed.
