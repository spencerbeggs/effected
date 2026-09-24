# Carrier verification: use the kit

Three checks keep the carrier pattern honest as the package graph evolves.
Each answers a different question, none substitutes for the others, and
`@effected/workspaces/testing` ships all three — a multi-package tool no
longer hand-rolls any of them.

## 1. Manifest DAG test: `LayerPolicy` + `WorkspaceLayering`

A committed `layers.json`, decoded with `LayerPolicy.load` (or, for a fixture
with no file on disk, `LayerPolicy.decode`), checked against the live
workspace with `WorkspaceLayering.checkWorkspace` — or, for a hand-built
graph, the pure `WorkspaceLayering.check(graph, policy)`. Assert **both**
`report.violations` empty and `report.edgeCount > 0`: the second half is the
non-vacuity guard, since a discovery bug that silently finds zero edges
would otherwise report a spotless graph for the wrong reason.

```ts
import { LayerEdge, LayerPolicy, WorkspaceLayering } from "@effected/workspaces/testing"
import { Effect } from "effect"

// A hand-built graph, top layer first (an edge may only point to a
// strictly LOWER index — this is what `LayerPolicy`'s own doc comment
// means by "top-down").
const graph = {
  names: ["@scope/carrier", "@scope/cli", "@scope/mcp", "@scope/core"],
  edges: [
    LayerEdge.make({ from: "@scope/cli", to: "@scope/core", field: "dependencies" }),
    LayerEdge.make({ from: "@scope/mcp", to: "@scope/core", field: "dependencies" }),
    LayerEdge.make({ from: "@scope/carrier", to: "@scope/cli", field: "dependencies" }),
    LayerEdge.make({ from: "@scope/carrier", to: "@scope/mcp", field: "dependencies" }),
  ],
}

const program = Effect.gen(function* () {
  const policy = yield* LayerPolicy.decode({
    layers: [["@scope/carrier"], ["@scope/cli", "@scope/mcp"], ["@scope/core"]],
    tooling: [],
    unconstrained: [],
  })
  const report = WorkspaceLayering.check(graph, policy)
  return { violations: report.violations, edgeCount: report.edgeCount }
})

console.log(await Effect.runPromise(program))
```

Prints `{ violations: [], edgeCount: 4 }` — a clean graph, and the
non-vacuity guard confirms the check actually looked at something.

`LayeringReport.offenders` names **five** offence reasons: `upward` (an edge
into a strictly higher layer), `sameLayer` (a front end depending on
another front end), `toolingReachesLayer` (a tooling package reaching into a
real layer, the wrong direction), `intoUnconstrained` and `intoUnclassified`
(an edge into a package the policy does not classify at all — see below).
`LayeringReport.cycle` reports a genuine dependency cycle separately from
any of the five reasons.

**A devDependency-only cycle is invisible to a policy whose `fields` are
runtime-only.** `WorkspaceLayering.edgesOf` draws one edge per declaring
field, and `check` reads only the policy's own `effectiveFields` (`fields`,
or all four by default). Either include `devDependencies` in the policy's
`fields`, or run a second, separate all-field acyclicity check —
`DependencyGraph.make({ packages }).hasCycle` — alongside the layering
policy rather than folding both concerns into one check.

**The root package must be classified.** Workspace discovery always
returns it (its `relativePath` is `"."`); a policy that forgets it reports
the root in `unclassified`. Usually an `unconstrained` glob covers it.

**Every policy entry matches a package's `name`, never its `relativePath`.**
`layers` and `tooling` list exact names, and `unconstrained` globs match
names too. A private root named `okfit` at `relativePath` `"."` is classified
by `"okfit"`; an entry of `"."` or `"packages/*"` classifies nothing, and the
packages it meant come back in `unclassified`.

Remove any hand-rolled `LAYER_RANKS` lookup table and its own from-scratch
edge-direction assertions — `WorkspaceLayering.check` already is that table,
plus the five-reason classification and the non-vacuity guard, over a
policy format every kit-based tool shares.

## 2. Source boundary tests: `SourceBoundary`

Scan a package's `src/` tree for the things its layer promises not to do —
`process` reads, a platform import leaking into core, front ends importing
each other — with `SourceBoundary.scan({ root, rules, allow, allowRules })`, and prove
the scanner itself can fail before trusting a clean result:

```ts
import { resolve } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { SourceBoundary } from "@effected/workspaces/testing"
import { Cause, Effect, Exit } from "effect"

const ROOT = resolve(process.cwd(), "..")

const happy = await Effect.runPromise(
  Effect.gen(function* () {
    const fixtureFailures = SourceBoundary.verifyFixtures()
    const scan = yield* SourceBoundary.scan({
      root: resolve(ROOT, "packages", "engine", "src"),
      rules: ["process", { forbidImports: ["node:*", "@effect/platform*"] }],
    })
    return { fixtureFailures, files: scan.files.length, violations: scan.violations }
  }).pipe(Effect.provide(NodeServices.layer)),
)
console.log(happy)

// Malformed input: a root that does not exist must fail typed, never die.
const badExit = await Effect.runPromiseExit(
  SourceBoundary.scan({ root: resolve(ROOT, "does-not-exist"), rules: ["process"] }).pipe(
    Effect.provide(NodeServices.layer),
  ),
)
console.log(Exit.isFailure(badExit) && Cause.hasDies(badExit.cause) ? "Die" : "Fail")
```

Prints `{ fixtureFailures: [], files: 4, violations: [] }` then `Fail` — the
bad root fails as a typed `PlatformError`, never a defect. `verifyFixtures()`
is the shipped **positive control**: it runs the scanner against fixtures it
already knows must and must not trigger, and returns the mismatches — `[]`
means the scanner itself is still discriminating, not merely silent.
Asserting `scan.files` non-empty is the same non-vacuity discipline as the
DAG test's `edgeCount > 0`: an empty `root` glob or a typo'd path would
otherwise report a spotless boundary because nothing was scanned at all.

An engine's own allowlist can be **truly empty** — no per-file exception —
because `process.env.__PACKAGE_VERSION__` in a build-time version constant
is a bundler `define`, not a runtime environment read, and `SourceBoundary`
does not flag it.

Three documented misses to design a scan around, not "fix" by widening a
rule: **any local binding named `process` or `console`** — a parameter, a
variable, an unannotated class field — is flagged exactly like the global,
with no scope analysis (`globalThis["process"]` is a known miss in the
other direction); **`forbidImports: ["node:*"]` misses a bare built-in**
such as `"fs"` — spread `builtinModules` from `node:module` in the test file
to actually mean "no Node built-ins." For a local binding you cannot rename,
waive that one rule for the file with `allowRules` and assert `scan.waived`.

Exempt a file from **one** rule with `allowRules`, keyed by the rule
(`"forbidImports"` covers every `{ forbidImports }` rule), not from all of
them with `allow`. The file stays checked against every other rule, and each
offence a per-rule glob waives lands in `scan.waived` instead of vanishing.
Assert `waived` is exactly what you meant to waive, so a stale or over-broad
waiver fails. A stdio front end whose `main.ts` hands `process.stdout` to a
transport waives `process` there and keeps `stdout-write`:

```ts
const scan = yield* SourceBoundary.scan({
  root: resolve(ROOT, "packages", "lsp", "src"),
  rules: ["process", "stdout-write"],
  allowRules: { process: ["main.ts"] },
})
// scan.violations: [] — yet a `process.stdout.write(...)` in main.ts is still flagged.
// scan.waived: main.ts's `process` reads only.
```

`"stdout-write"` flags `stdout.write` and `stdout.end(chunk)`, matching the
name `stdout`. A renamed receiver (`const { stdout: o } = process; o.write(x)`)
is not seen; elsewhere the `process` rule catches the read, but in a file
where `process` is waived nothing does. Keep that file's stdout use to the
bare hand-off.

Two console rules exist. `"console"` flags every reference to the global
`console`. `"console-stdout"` spares a member access to a method Node writes
to stderr (`error`, `warn`, `trace`, `assert`), so it fits a stdio server that
keeps stdout for its protocol but may log to stderr. A bare or aliased
`console` is still flagged, since it can reach `log`. Neither flags core's
`Console` service.

Remove any hand-rolled `stripComments` + regex scanner — `SourceBoundary`
already tokenizes correctly enough to spare a comment or a string literal
that merely mentions `process`, and ships the fixtures that prove it.

## 3. Packed-install e2e: `PackedInstall`

Neither of the first two tests proves a consumer *outside* the monorepo
actually gets working bins — only a real pack-and-install does.
`PackedInstall.run` packs the carrier and its dependency closure, installs
into a scratch project per available package manager, and returns which
bins are where; the test still has to run those bins itself, **inside the
same scope** the install used, since the scratch directory is removed when
the scope closes.

```ts
import { NodeServices } from "@effect/platform-node"
import { McpProbe } from "@effected/mcp/testing"
import { PackedInstall } from "@effected/workspaces/testing"
import { Effect } from "effect"
import { ChildProcess } from "effect/unstable/process"

const program = Effect.gen(function* () {
  const result = yield* PackedInstall.run({
    carrier: "my-tool",
    closure: "auto",
    managers: ["npm", "pnpm", "yarn", "bun"],
    bins: ["my-tool-mcp"],
    env: process.env,
    // CI provisions every manager, so a missing one fails there; locally it is skipped.
    require: process.env.CI ? "all" : "any",
    installTimeout: "2 minutes",
  })
  const env = PackedInstall.scrubEnv(process.env)
  for (const consumer of result.consumers) {
    const bin = ChildProcess.make(consumer.binPath("my-tool-mcp"), [], {
      cwd: consumer.directory,
      env,
      extendEnv: false,
    })
    const { response, stderr, exitCode } = yield* McpProbe.initialize(bin).pipe(Effect.timeout("30 seconds"))
    yield* Effect.log(`${consumer.manager}: initialize error=${response.error !== undefined}, stderr="${stderr}", exit=${exitCode}`)
  }
  // Four managers x installTimeout, plus pack and probes.
}).pipe(Effect.timeout("12 minutes"), Effect.provide(NodeServices.layer))

void program
```

Typecheck-only: this packs and installs into scratch directories under real
package managers, which this reference cannot run as a doc example. Every
other rule here still applies to a real suite built on it:

- The MCP half of the proof is `McpProbe.initialize`, not a hand-rolled
  spawn-and-write-JSON-RPC harness — see `effect-v4-mcp`'s
  [`testing.md#packed-install-proof`](../../effect-v4-mcp/references/testing.md#packed-install-proof)
  for the full assertion shape (`response.error` undefined, empty `stderr`,
  exit `0`).
- `PackedInstall` probes every requested manager with `--version` itself,
  so a test never gates a per-manager block on `PATH`. Under the default
  `require: "any"` a manager that does not answer lands in
  `result.unavailable` and the run carries on with the rest (it fails
  `NoManagerAvailable` only when none answers); `require: "all"` fails
  `ManagerUnavailable` on the first one missing. Use `"all"` wherever every
  listed manager is provisioned — CI — so a missing manager is a failure
  there, and `"any"` on a developer machine, where it is a skip; log
  `result.unavailable` so the skip is visible.
- `PackedInstall` is **POSIX-only** and fails `UnsupportedPlatform`
  elsewhere.
- The installs run one after another, so an outer `Effect.timeout` has to
  be at least the number of managers times `installTimeout`, plus the pack
  and the probes — a tighter guard fires first as a `TimeoutError` naming no
  manager, which reads like a hang rather than a configuration mistake.
- Pass `process.env` in explicitly: nothing under `./testing` reads
  `process` itself. Declare every package the consumer's own code imports
  besides the carrier in `consumerDependencies` — pnpm links only declared
  dependencies at a project's top level.

Gate the whole suite on the carrier's production build existing (skip, not
fail, when it doesn't — this is an e2e proof layered on a build artifact,
not a substitute for the build). Manager availability needs no gate of its
own: `require` above is that policy.
