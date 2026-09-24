---
type: Interface
title: "@effected/workspaces/testing: the repo-shape checks"
description: SourceBoundary, WorkspaceLayering and PackedInstall, the three checks a monorepo runs in its own test suite to keep source boundaries, the package graph and the packed install honest.
status: draft
kind: api
resource: ../../packages/workspaces/src/testing.ts
tags:
  - architecture
sources:
  - id: testing-ts
    resource: ../../packages/workspaces/src/testing.ts
  - id: source-boundary-ts
    resource: ../../packages/workspaces/src/SourceBoundary.ts
  - id: source-text-ts
    resource: ../../packages/workspaces/src/internal/sourceText.ts
  - id: workspace-layering-ts
    resource: ../../packages/workspaces/src/WorkspaceLayering.ts
  - id: layer-policy-ts
    resource: ../../packages/workspaces/src/LayerPolicy.ts
  - id: dependency-graph-ts
    resource: ../../packages/workspaces/src/DependencyGraph.ts
  - id: packed-install-ts
    resource: ../../packages/workspaces/src/PackedInstall.ts
  - id: packed-install-plan-ts
    resource: ../../packages/workspaces/src/internal/packedInstallPlan.ts
  - id: package-publish-ts
    resource: ../../packages/npm/src/PackagePublish.ts
  - id: package-tarball-ts
    resource: ../../packages/npm/src/PackageTarball.ts
  - id: cli-logger-ts
    resource: ../../packages/cli/src/CliLogger.ts
  - id: layers-json
    resource: ../../lib/configs/layers.json
  - id: vitest-agent-packed-install
    resource: https://github.com/spencerbeggs/vitest-agent/blob/main/packages/plugin/__test__/bins-packed-install.e2e.test.ts
  - id: systems-packed-install
    resource: https://github.com/savvy-web/systems/blob/main/e2e/silk/__test__/e2e/packed-install.e2e.test.ts
  - id: systems-helpers
    resource: https://github.com/savvy-web/systems/blob/main/e2e/silk/__test__/e2e/helpers.ts
  - id: packed-install-e2e
    resource: ../../packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T01:41:28Z
  body_sha256: 52f027ceeaff5220d76044284f794dfc162354ebde471f509577d4a842c5290b
---

# @effected/workspaces/testing: the repo-shape checks

`@effected/workspaces/testing` is the package's third entry point. It holds
three checks a monorepo runs against itself, inside its own test suite:
`SourceBoundary` keeps `process`, `node:` imports and console writes out of
modules meant to be free of them; `WorkspaceLayering` holds the package graph
to a committed `LayerPolicy`; and `PackedInstall` proves a carrier's bins
install from packed tarballs under every available package
manager.[^testing-ts] `src/index.ts` never re-exports it. Why these live here
rather than in a package of their own is
[D5](../decisions/repo-shape-checks-live-in-workspaces-testing.md).

Every check refuses to pass vacuously. A scan reports the files it read, a
layering report counts the edges it checked, and a packed install reports
which managers it skipped. The assertion a consumer writes pairs "nothing
wrong" with "something was checked".

## SourceBoundary

### The lexer's three views

Every rule runs over one lexer pass that splits a file three
ways:[^source-text-ts]

- `withoutComments`: comments blanked to spaces, everything else kept;
- `code`: comments, strings, template text and regex bodies blanked, so only
  code is left;
- `literals`: every string, and every template with no substitution, with its
  offset.

Both text views keep the input's exact length and line breaks, so an offset
in either one is an offset in the file. The `process`, `stdout-write` and
`console-write` rules read `code`. The import rules read `literals`, but only
the ones in specifier position: after `from` or `import`, or the whole first
argument of `import(` or `require(`. A commented-out import is never a
specifier.

A `/` after an operand divides. An operand is an identifier, `)`, `]`, a
postfix `++` or `--`, or a non-null `!`. A `/` after an operator, after a
keyword, or after the `)` of an `if`, `while`, `for` or `with` condition opens
a regex. Getting this wrong in either direction hides code: a regex holding a
quote, or a division read as a regex, would swallow the rest of the line.

### The `process` rule

`"process"` forbids a read of the global `process`.[^source-boundary-ts]

| Never counted | Always counted |
| --- | --- |
| a string, template text, a regex body or a comment | `globalThis.process` and `global.process` |
| a member of another object: `child.process` | a spread: `...process` |
| a longer identifier: `ChildProcess` | `typeof process` |
| a private field: `#process` | computed access: `process["env"]` |
| an object-literal key or type member: `{ process: 1 }` | a template substitution: `${process.cwd()}` |

The exact token `process.env.__PACKAGE_VERSION__` is exempt, because the
bundler substitutes it at build time. `ignoreTokens` adds more exact tokens,
each starting at the reference. An exemption never applies through a member
access, so `globalThis.process.env.__PACKAGE_VERSION__` is still flagged.

The known misses:

- `globalThis["process"]`, because the key is a string, and
  `const { process: p } = globalThis`.
- A regex literal directly after a block-closing `}`. It reads as a division,
  so a quote or `/*` inside it can hide the code after it.
- JSX text, which reads as code. `.tsx` and `.jsx` are not among the default
  extensions for this reason.

### No scope analysis

The scanner cannot tell a local binding from the global. `cli`'s logger binds
a local `console` to core's `Console` service
(`CliLogger.ts:104`),[^cli-logger-ts] and `console-write` flags it. The fix is
an `allow` glob for that one file. `cli`'s own boundary test proves the
allowance is both needed and the only one: an unallowed scan finds offences
in `CliLogger.ts` and nowhere else. A class field named `process` is flagged
for the same reason.

### `scan` and its non-vacuity handles

`scan` walks the root with an explicit stack and visits each real directory
once, through `FileSystem.realPath`. A symlink loop therefore terminates, and
a linked directory is not read twice. `node_modules` is never entered, and
declaration files are skipped. Every path comes back relative to the root and
`/`-separated, whatever the platform's separator, and `allow` globs match
against that same form. A missing root fails the scan; it never scans
nothing.[^source-boundary-ts]

A `SourceScan` carries `files` (every file read), `allowed` (the files an
`allow` glob exempted) and `offences`. `violations` is `[]` when clean. The
handles exist so a mistyped root cannot read as clean:

- assert `files` names a real file, or at least is non-empty;
- assert `allowed` is exactly the files you meant to exempt.

### `verifyFixtures`: the consumer's positive control

`SourceBoundary.fixtures` ships positive and negative controls for every rule
kind, including every lexer ambiguity that once hid a real read.
`verifyFixtures()` returns the names of the ones the scanner now gets wrong.
Assert it is `[]` beside your own scan: it proves the scanner you are trusting
still flags what it must and spares what it must.

```ts
import { SourceBoundary } from "@effected/workspaces/testing";

const offences = SourceBoundary.check("src/a.ts", "const { env } = process;", ["process"]);
console.log(offences.map((offence) => offence.label), SourceBoundary.verifyFixtures());
// => [ 'src/a.ts:1:17 process process' ] []
```

## WorkspaceLayering

### Offence reasons

`layers` is top-down: an edge may point only from a layer to one below it, or
into `tooling`.[^layer-policy-ts] Each offending edge carries one of five
reasons:[^workspace-layering-ts]

| Reason | The edge |
| --- | --- |
| `upward` | points into a higher layer |
| `sameLayer` | stays inside one layer |
| `toolingReachesLayer` | leaves a `tooling` package for a layer |
| `intoUnconstrained` | points into a package an `unconstrained` glob matches |
| `intoUnclassified` | points into a package the policy does not classify |

An edge *from* an unconstrained or unclassified package is skipped, because
that package has no place to check it against. It is never dropped silently,
though: an unclassified package is still reported in `unclassified`, and an
edge *into* either kind is an offender. A policy cannot fence a package off
from its dependents by leaving it out.

`LayeringReport.violations` also reports duplicates, a cycle, a declared name
the workspace lacks, a missing `requiredEdges` entry, and an `edgeCount` of 0
as a vacuous check.

### Edges by name, one per field

`DependencyGraph` merges all four dependency fields into one adjacency
(`DependencyGraph.ts:114-120`),[^dependency-graph-ts] so it cannot answer
"which field declared this edge". `WorkspaceLayering.edgesOf` recomputes one
`LayerEdge` per declaring field, and `check` reads only the policy's `fields`.
That is why `check` takes a `LayeringGraph` of names and edges rather than a
list of packages.

An edge exists wherever a dependency's **name** is a workspace package,
whatever its specifier. Counting only `workspace:` specifiers, as the systems
repo did, misses npm and yarn ranges and pnpm's `linkWorkspacePackages`.

### A devDependency-only cycle and the `fields` choice

A cycle closed only by a devDependency is reported when `devDependencies` is
among the policy's `fields`, and is invisible when it is not. Pick `fields`
for what the layers mean. This repository checks runtime fields only,
because test-only devDependencies may point up
([the runtime-edge decision](../decisions/kit-layering-checks-runtime-edges.md)),
and it pins acyclicity across all four fields with a separate
`DependencyGraph.hasCycle` assertion.

### The root package must be classified

`WorkspaceDiscovery` always returns the root package, with `relativePath`
`"."`. A policy that forgets it reports it in `unclassified`. Classify it,
usually with an `unconstrained` glob.

### The worked example

This repository's own policy is `lib/configs/layers.json`.[^layers-json] It
has five layers, `@effected/pnpm-plugin-effect` as tooling, and the root, the
docs site, the scratchpad and the two plugin tracking packages as
unconstrained. It checks `dependencies`, `peerDependencies` and
`optionalDependencies`, and it requires four edges that must stay present,
such as `@effected/mcp -> @effected/engine`. `cli`, `mcp` and `workspaces`
share one layer, so any runtime edge between them is a `sameLayer` offence.
`__test__/integration/layering.int.test.ts` checks the real workspace against
it.

The pure `check` needs no filesystem, so positive controls are plain values:

```ts
import { LayerEdge, LayerPolicy, WorkspaceLayering } from "@effected/workspaces/testing";

const policy = LayerPolicy.make({ layers: [["app"], ["lib"]], tooling: [], unconstrained: ["root"] });
const report = WorkspaceLayering.check(
  {
    names: ["root", "app", "lib"],
    edges: [
      LayerEdge.make({ from: "app", to: "lib", field: "dependencies" }),
      LayerEdge.make({ from: "lib", to: "app", field: "peerDependencies" }),
    ],
  },
  policy,
);
console.log(report.violations);
// => [ 'upward: lib -> app (peerDependencies)', 'dependency cycle among: app, lib' ]
```

## PackedInstall

### The per-manager traps

`PackedInstall.run` packs the carrier and its closure into a scoped,
realpath'd scratch directory, then installs it into a fresh consumer per
available manager. Each row below is a trap a consumer repository hit by
hand-rolling this check; the pure half lives in
`internal/packedInstallPlan.ts`.[^packed-install-plan-ts]

| Trap | What `PackedInstall` does | Found in |
| --- | --- | --- |
| The parent run's `npm_*`, `CI` and `INIT_CWD` leak into the child manager | `scrubEnv` strips them, plus `pnpm_config_*`, `PNPM_SCRIPT_SRC_DIR`, `PNPM_PACKAGE_NAME` and `YARN_*` | vitest-agent[^vitest-agent-packed-install] (lines 139-147) |
| `NODE_V8_COVERAGE` makes a spawned manager race vitest's coverage files | `scrubEnv` strips it | systems[^systems-helpers] (lines 8-15) |
| pnpm 10+ reads overrides only from `pnpm-workspace.yaml`, and pnpm 11 ignores `package.json#pnpm` | pnpm consumers get a settings-only `pnpm-workspace.yaml` | vitest-agent (lines 221-234), systems[^systems-packed-install] (lines 123-152) |
| Yarn Berry defaults to Plug'n'Play and never writes `node_modules/.bin` | Berry consumers get a `.yarnrc.yml` with `nodeLinker: node-modules` and scripts off | vitest-agent (lines 237-256) |
| macOS `/var` is a symlink to `/private/var`, so `file:` specs and the install cwd disagree | the scratch directory is realpath'd | systems (lines 70-73) |
| Outside the repo, corepack falls back to whatever it cached last | `packageManager` is pinned to the probed `<pm>@<version>` | systems (lines 139-142) |
| pnpm 12 fails an install that ignored a dependency build script | pnpm installs with `--config.ignore-scripts=true` | systems (lines 56-68) |
| A repo's `packageManager` pin makes corepack refuse any other manager inside it | each manager is probed with `--version` from the scratch directory | vitest-agent (lines 119-128) |
| pnpm 12 only **warns** on a mismatched `packageManager` pin; it neither refuses nor switches | the no-switch property is proven by version equality: `<pm> --version` inside the consumer must equal the probed version | this package's e2e[^packed-install-e2e] |

User-level configuration is inherited by design. `HOME` stays, so each
manager still reads the user's registry, auth and proxy settings, as a real
install on that machine would.

### Closure, pack source and requirements

`closure: "auto"` is the carrier's transitive **runtime** workspace
dependencies: `dependencies`, `optionalDependencies` and `peerDependencies`,
never `devDependencies`.[^packed-install-plan-ts]

`packFrom` defaults to `{ directory: "dist/prod/npm/pkg" }`, which `npm pack`s
the effected bundler's prod output: byte-for-byte the artifact a release
publishes. `"source"` runs `pnpm pack` in the package directory instead. That
packs whatever `publishConfig.directory` names, which under the effected
bundler is the **dev** build, and it needs a workspace that has been
`pnpm install`ed, or the pack fails `PackFailed` naming the missing
install.[^packed-install-ts] Why the default is the prod directory is
[the pack-source decision](../decisions/packed-install-pack-source.md).

A requested manager that does not answer `--version` lands in `unavailable`.
Under `require: "any"`, the default, one available manager is enough; under
`require: "all"`, any unavailable one fails `ManagerUnavailable`. No manager
at all fails `NoManagerAvailable`, never an empty success. Assert
`consumers.length > 0` in any case.

Declare every package the consumer's own code imports through
`consumerDependencies`. pnpm's isolated layout links only a project's
declared dependencies at its top level, so a peer reached only through the
carrier resolves inside the carrier but fails `ERR_MODULE_NOT_FOUND` from the
consumer root, while npm and bun hoist it and pass.

An install that outlives `installTimeout` (four minutes by default) fails
`InstallFailed` with a message naming the manager and the ceiling, distinct
from a manager that could not spawn at all.

### POSIX only

`.bin` entries are shell shims or symlinks, and the tarball's manifest is
read with `tar -xzOf`. A `Path` whose separator is not `/` fails
`UnsupportedPlatform` before anything spawns.

### Why neither `PackagePublish.pack` nor `PackageTarball`

`PackagePublish.pack` writes its tarball into the package directory
(`PackagePublish.ts:317`) with no `--pack-destination`, so it would drop a
`.tgz` into `dist/prod/npm/pkg` that a later pack ships inside itself. It
also needs `Crypto` and `LocalExec` in `R` for a SHA-256 this check does not
use.[^package-publish-ts] `PackageTarball.extract` fetches a *published*
version over `HttpClient`, not a local tarball.[^package-tarball-ts]
`PackedInstall` runs `npm pack` or `pnpm pack` through `Run` into an empty
per-package destination and takes the one `.tgz` it finds, which also
sidesteps npm 12's keyed-by-name `--json` shape.

### Composing `McpProbe`

`PackedInstall` asserts that each bin exists and is executable, not what it
does. Run each bin from the test, inside the same scope, through
`InstalledConsumer.binPath`, and with `PackedInstall.scrubEnv(process.env)`
as its environment. For an MCP bin, `McpProbe.initialize` from
`@effected/mcp/testing` is the proof, and the consumer's test composes it:
there is no runtime edge between `workspaces` and `mcp`. The scratch
directory is removed when the scope closes.

[^testing-ts]: `packages/workspaces/src/testing.ts` — the entry point and its
    `@packageDocumentation` block.
[^source-boundary-ts]: `packages/workspaces/src/SourceBoundary.ts` — the
    rules, the exemption, the documented misses and `scan`.
[^source-text-ts]: `packages/workspaces/src/internal/sourceText.ts` —
    `LexedSource` and `lex`.
[^cli-logger-ts]: `packages/cli/src/CliLogger.ts:104` — the local `console`
    binding.
[^layer-policy-ts]: `packages/workspaces/src/LayerPolicy.ts` — the policy
    schema and its field semantics.
[^workspace-layering-ts]: `packages/workspaces/src/WorkspaceLayering.ts` —
    the offence rule, `edgesOf` and `check`.
[^dependency-graph-ts]: `packages/workspaces/src/DependencyGraph.ts:114-120`
    — the merged adjacency.
[^layers-json]: `lib/configs/layers.json` — this repository's layer policy.
[^packed-install-plan-ts]: `packages/workspaces/src/internal/packedInstallPlan.ts`
    — `scrubEnv`, `closureOf`, `consumerFiles` and `installArgs`.
[^packed-install-ts]: `packages/workspaces/src/PackedInstall.ts` — `PackSource`
    and `run`.
[^package-publish-ts]: `packages/npm/src/PackagePublish.ts:317,453-457` — the
    pack destination and the service requirements.
[^package-tarball-ts]: `packages/npm/src/PackageTarball.ts:75,117` — the
    registry fetch.
[^vitest-agent-packed-install]: vitest-agent,
    `packages/plugin/__test__/bins-packed-install.e2e.test.ts`.
[^systems-packed-install]: systems,
    `e2e/silk/__test__/e2e/packed-install.e2e.test.ts`.
[^systems-helpers]: systems, `e2e/silk/__test__/e2e/helpers.ts`.
[^packed-install-e2e]: `packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts`
    — the pnpm pin mutation: a pin of 12.6.0 under a running 12.5.1 installed
    without switching.
