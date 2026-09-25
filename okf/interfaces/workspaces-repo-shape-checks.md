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
  - id: node-console
    resource: https://nodejs.org/api/console.html
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
  at: 2026-09-25T20:48:19Z
  body_sha256: 3faa83bee52377bacb7752bf166e5df44bab7e0a4bafa04a60b5c9c7b7d08b35
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
in either one is an offset in the file. The `process`, `stdout-write`,
`console` and `console-stdout` rules read `code`. The import rules read `literals`, but only
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
| a string, template text, a regex body or a comment | `globalThis.process`, `global.process`, `window.process` and `self.process` |
| a member of another object: `child.process` | a spread: `...process` |
| a longer identifier: `ChildProcess` | `typeof process` |
| a private field: `#process` | computed access: `process["env"]` |
| an object-literal key or type member: `{ process: 1 }` | a template substitution: `${process.cwd()}` |

The exact token `process.env.__PACKAGE_VERSION__` is exempt, because the
bundler substitutes it at build time. `ignoreTokens` adds more exact tokens,
each starting at the reference. An exemption never applies through a member
access, so `globalThis.process.env.__PACKAGE_VERSION__` is still flagged.

### Confining a token: `forbidTokens`

The exemption holds everywhere, but a carrier's house rule is usually "the
version define appears only in `version.ts`". `{ forbidTokens }` forbids
each entry's exact text in code; paired with an `allowRules` waiver under the
`"forbidTokens"` key, it confines the token to the named files:

```ts
SourceBoundary.scan({
  root,
  rules: ["process", { forbidTokens: ["process.env.__PACKAGE_VERSION__"] }],
  allowRules: { forbidTokens: ["version.ts"] },
});
```

A use anywhere else is an offence. Each use inside `version.ts` is reported
in `waived`, so asserting `waived` names `version.ts` proves the confinement
is live rather than vacuous. The glob matches the root-relative path, as
every `allow` and `allowRules` glob does, so `version.ts` names only the
file at the root and `**/version.ts` names one at any depth. We chose the
generic forbid-plus-waiver shape over a dedicated `{ token, onlyIn }` rule
because the waiver already reports what it exempts; a separate `onlyIn` list
would need its own non-vacuity handle. The cost is that one `"forbidTokens"`
key covers every `{ forbidTokens }` rule in a scan: two tokens with different
homes need two scans.[^source-boundary-ts]

A token matches as whole text in the `code` view. A token that starts with
an identifier character does not match inside a longer identifier, and one
that ends with one does not run into the next. Whitespace must match byte
for byte, and a token containing a string literal never matches, since
strings are blanked. A member access still matches:
`globalThis.process.env.__PACKAGE_VERSION__` contains the token.

The known misses:

- `globalThis["process"]`, because the key is a string, and
  `const { process: p } = globalThis`.
- A regex literal directly after a block-closing `}`. It reads as a division,
  so a quote or `/*` inside it can hide the code after it.
- JSX text, which reads as code. `.tsx` and `.jsx` are not among the default
  extensions for this reason.
- A bare built-in under `forbidImports: ["node:*"]`: the entry matches only
  the `node:` spelling, so `import { readFile } from "fs"` passes. A test
  that means "no Node built-ins" spreads Node's own list,
  `["node:*", ...builtinModules]` from `node:module`, which also forbids npm
  packages named like a built-in (`events`, `buffer`). The subpath ships no
  built-in list of its own, because one would drift with Node releases.

### The console rules

`"console"` flags every reference to the global `console`.
`"console-stdout"` flags the same references except a member access to one
of the methods Node's console writes to stderr: `error`, `warn`, `trace` and
`assert`.[^source-boundary-ts] It suits a stdio server that keeps stdout for
its protocol but may log to stderr. A bare or aliased reference
(`const c = console`, `f(console)`, `console[m]`) is still flagged, because it
can reach `log`. So is `console["error"]`, since the lexer blanks the string
key. Neither rule flags core's `Console` service: `Console.Console` is a
different identifier.

The stderr list comes from Node's console documentation, which has `error`
and `trace` print to stderr, `warn` as an alias of `error`, and `log` and
`info` print to stdout. It names no stream for `assert`.[^node-console] A
probe on Node 26 settled the rest: a
`Console` built over two capturing streams sent `error`, `warn`, `trace` and a
failing `assert` to stderr. It sent `log`, `info`, `debug`, `dir`, `dirxml`,
`table`, `count`, `group`, `groupCollapsed` and `time` to stdout.

### No scope analysis

The scanner cannot tell a local binding from the global. `cli`'s logger binds
a local `console` to core's `Console` service
(`CliLogger.ts:104`),[^cli-logger-ts] and `console` flags it. The fix is an
`allowRules` waiver of `console` for that one file. `cli`'s own boundary test
proves the waiver is both needed and the only one: its scan reports no
violations, and `waived` names `CliLogger.ts` under `console` and nothing
else. The file is still held to every other rule. The same holds for every local binding
named `process`: a parameter (`(process: Handle) => process.kill()`), a
variable, a label, and an unannotated class field
(`class A { process = 1 }`) are all flagged. An annotated class field
(`process: string`) reads as a type member and is not. Code that handles
child-process objects commonly names a parameter `process`. Renaming it is
the better remedy; failing that, waive the one rule with `allowRules` rather
than exempting the file from every rule with `allow`.

### `scan` and its non-vacuity handles

`scan` walks the root with an explicit stack and visits each real directory
once, through `FileSystem.realPath`. A symlink loop therefore terminates, and
a linked directory is not read twice. `node_modules` is never entered, and
declaration files are skipped. Every path comes back relative to the root and
`/`-separated, whatever the platform's separator, and `allow` globs match
against that same form. A missing root fails the scan; it never scans
nothing.[^source-boundary-ts]

Two kinds of exemption exist. An `allow` glob exempts a file from every rule.
An `allowRules` glob, keyed by an `OffenceRule`, exempts a file from that one
rule and leaves it checked against every other; the `"forbidImports"` key
covers every `{ forbidImports }` rule. Both compile through the same
`GlobSet` and match the same relative path, and an uncompilable glob of
either kind fails the scan with `GlobPatternError`. A file `allow` matches is
never checked, so nothing in it is waived.[^source-boundary-ts]

A `SourceScan` carries `files` (every file read), `allowed` (the files an
`allow` glob exempted), `offences`, and `waived` (every offence an
`allowRules` glob waived, sorted like `offences`). A waived offence is
reported, never dropped. `violations` is `[]` when clean. The handles exist
so a mistyped root, or a stale or over-broad exemption, cannot read as clean:

- assert `files` names a real file, or at least is non-empty;
- assert `allowed` is exactly the files you meant to exempt;
- assert `waived` is exactly what you meant to waive. A waiver that no
  longer waives anything, or waives more than intended, shows up here.

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

### Strict decoding

`LayerPolicy.decode` and `load` reject every key the policy does not model,
and the `decode` error's message names each one.[^layer-policy-ts] A typo on
an optional key would otherwise be dropped in silence: `requiredEdge`
(singular) would remove the non-vacuity guard and leave the report green,
and `feilds` would widen the check to all four fields. `$schema` is always
accepted. A policy file that carries keys of its own, such as systems'
`harness`, names them in `allowKeys`
(`LayerPolicy.load(path, { allowKeys: ["harness"] })`), and those keys are
dropped before decoding.

### What a policy cannot express

Layers forbid only upward and same-layer edges. A policy cannot forbid one
particular downward edge. In this repository `cli` sits above `engine`, so a
manifest edge `cli -> engine` passes layering even though the front-end
design keeps `cli` off `engine`.[^layers-json] Only `cli`'s own source scan
guards that edge, through its `forbidImports`, and only for an import under
`src/`. A `forbiddenEdges` key would close the gap and does not exist yet.

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

Every policy entry matches a package's `name`, never its
`relativePath`.[^workspace-layering-ts] `layers` and `tooling` list exact names,
and `unconstrained` globs match names. A private root named `okfit` at
`relativePath` `"."` is classified by `"okfit"`, and an entry of `"."` or
`"packages/*"` classifies nothing. `__test__/WorkspaceLayering.test.ts` pins
both halves.

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
| pnpm 12 only **warns** on a mismatched `packageManager` pin; it neither refuses nor switches | `PackedInstall` does not check this. To prove no switch happened, assert in your own test that `<pm> --version` run inside the consumer equals `consumer.managerVersion` | this package's e2e, which makes that assertion[^packed-install-e2e] |
| npm fails `EOVERRIDE` when a direct dependency's spec differs from its override | a `consumerDependencies` entry naming a packed package is written as the same `file:` spec the override uses | this package's final review (npm 11.19.1), pinned by the e2e's S1 case under every manager |

User-level configuration is inherited by design. `HOME` stays, so each
manager still reads the user's registry, auth and proxy settings, as a real
install on that machine would.

### Closure, pack source and requirements

`closure: "auto"` is the carrier's transitive **runtime** workspace
dependencies: `dependencies`, `optionalDependencies` and `peerDependencies`,
never `devDependencies`.[^packed-install-plan-ts]

`packFrom` defaults to `{ directory: "dist/prod/npm/pkg" }`, which `npm pack`s
the effected bundler's prod output: the same file list a release
publishes. `"source"` runs `pnpm pack` in the package directory instead. That
packs whatever `publishConfig.directory` names, which under the effected
bundler is the **dev** build, and it needs a workspace that has been
`pnpm install`ed, or the pack fails `PackFailed` naming the missing
install.[^packed-install-ts] A packed manifest whose runtime maps still carry a
`workspace:`, `catalog:`, `link:` or relative `file:` specifier fails
`UnresolvedProtocol` before any install, naming each one; no consumer
outside the workspace could resolve them.[^packed-install-plan-ts] Why the default is the prod directory is
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

An entry naming a packed package, the carrier or a closure member, is
written as that package's `file:` tarball whatever spec the caller passes,
so any range will do. The tarball always wins, for two reasons. npm fails an
install whose direct spec differs from its override with `EOVERRIDE`, and
accepts an identical one. And a caller's range must never silently replace
the tarball the run exists to prove.[^packed-install-plan-ts]

An install that outlives `installTimeout` (four minutes by default) fails
`InstallFailed` with a message naming the manager and the ceiling, distinct
from a manager that could not spawn at all. The installs run one after
another, so a test's outer `Effect.timeout` must cover the number of
managers times `installTimeout`, plus the pack and whatever the test runs
afterwards. A tighter guard fires first, as a `TimeoutError` that names no
manager. `PackedInstall.timeoutBudget({ managers, installTimeout, packages,
perConsumer })` returns that sum as a `Duration`. It adds each manager's probe
(30 seconds), install and `perConsumer`, each package's pack (`packTimeout`,
two minutes by default; a pack past it fails `PackFailed` naming the package
and the ceiling) and manifest read (30 seconds), 30 seconds for the untimed
steps, and one minute for cleanup: removing the scratch root when the scope
closes, and killing a child after its ceiling interrupts it. It reads the
same constants the run does, so the two cannot drift. `packages` is a count
or the names `PackedInstall.closure(carrier, options?)` returns: the packages
the run will pack, in order, computed without packing by the same planner the
run calls, so they equal `Object.keys(result.tarballs)`. It takes the run's
own options object, and fails as the run would before packing.[^packed-install-ts]

### Overrides: packages from outside the workspace

A closure member can depend on a package version the registry does not have
yet, typically a sibling checkout's unreleased build that the workspace itself
links through a dogfood `pnpm-workspace.yaml` override. The scratch consumers
would resolve it from the registry and miss the new surface. `overrides` maps
a package name to a publish-ready package directory, which is `npm pack`ed,
or to a `.tgz`, which is used as it is; a relative path resolves against the
workspace root. `workspaceOverrides: true` also takes every bare-name
`"<name>": "file:<path>"` entry of the root `pnpm-workspace.yaml`'s
`overrides:`, and an explicit `overrides` entry wins over one read there.
Each supplied package joins `result.tarballs` after the closure, sorted by
name, and every consumer steers it to its tarball through the same override
field as the closure, so the closure's transitive references install it
whatever range they ask for. An override naming the carrier or a closure
member (the workspace copy is what the run proves), a path that is neither a
package directory nor a `.tgz`, a tarball whose manifest carries another name,
or an unreadable or non-YAML `pnpm-workspace.yaml` fails `InvalidOverride`.
The e2e proves it under every available manager against a package no
registry has, with a control that fails the same install without the
override.[^packed-install-e2e]

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
does. Run each bin from the test, inside the same scope.
`InstalledConsumer.runBin(name, args, options?)` spawns it from the consumer
directory with stdin ignored and returns `{ stdout, stderr, exitCode }`; a
non-zero exit is a result. A spawn failure, an expired ceiling (one minute by
default) or flooded output fails `BinFailed`. The environment is the one the
install ran under, which the consumer carries as a redacted `env` field so
printing it never prints a token. `options.env` is layered over it after the
scrub, with an `undefined` value removing a variable, so a caller's explicit
entry wins: `CI: "true"` runs a bin as if under CI. A
consumer's test therefore needs no direct `@effected/commands` dependency to
run a bin.[^packed-install-ts]

`PackedInstallResult.scratch` is the realpath'd scratch root, so per-run
state such as `XDG_DATA_HOME` can live inside it and be removed with it
rather than in a second temporary directory.

For an MCP bin, `McpProbe.initialize` from `@effected/mcp/testing` is the
proof. `InstalledConsumer.command(name, args?, options?)` returns the
`ChildProcess` command `runBin` builds, with the same environment layering and
scrub, and leaves stdin as the spawner's default pipe so the probe can write
to it; `runBin` spawns that command with stdin ignored. There is no runtime
edge between `workspaces` and `mcp`: the consumer's test passes one to the
other. The scratch directory is removed when the scope closes.

Only the carrier may declare its bins
([the carrier-only bins decision](../decisions/carrier-only-declares-bins.md)).
Under a flat npm, Yarn or bun layout, a hoisted bin of the same name from
another package can take the carrier's `.bin` slot, and running it cannot tell
which one ran. The run therefore fails `BinConflict`, before any install, when
a packed package other than the carrier (a closure member or an override)
declares one of the carrier's bin names, read from the packed manifests it
already inspects: a `bin` object's keys, or for a `bin` string the unscoped
package name. It compares packed packages only: `directories.bin` is not
read, and a dependency installed from the registry that declares the same
bin name goes undetected. `allowSharedBins: true` skips the check for a tool
whose front ends still declare the carrier's bin names mid-migration; the
expected bins are still verified present and executable, but a flat layout
may have linked a front end's, so such a test asserts `binProvenance` until
the migration lands. `InstalledConsumer.binProvenance(name)` answers that for the
managers that write `.bin` entries as symlinks: npm, bun, and Yarn under the
`node-modules` linker the run configures. It reads the link, realpaths the
target, and walks up to the nearest `package.json` with a string `name`,
staying inside the consumer directory; a nameless nested manifest such as a
`dist/package.json` carrying only `type` is passed over. It returns
`{ package, target }`.[^packed-install-ts]

pnpm writes `.bin` entries as shell shims, and `binProvenance` returns
`undefined` for them rather than parsing a script. We declined shim parsing:
pnpm's isolated layout links only the consumer's direct dependencies at the
top level, so the shadowing it would detect needs a direct dependency there.
`undefined` means only that: the entry exists and is not a symlink. Node
reports "not a link" from `readLink` as `EINVAL`, which its platform layer tags
`Unknown` with the errno on the cause, and `@effected/memfs` raises the same
shape. Only that means a shim; any other `readLink` failure, such as
`EACCES`, `BadResource` or an `Unknown` with another errno, fails `Io`. An entry that does not exist, or a link whose target
does not, fails `MissingBin`, consistent with the run's own bin check. A
link into no named package inside the consumer fails `UnownedBin` naming the
target, and the walk's bound is the consumer directory realpath'd first, so a
`/var` alias of `/private/var` or a trailing slash cannot move it. A manifest
that is valid JSON but not an object is passed over like a nameless one. The e2e asserts the carrier
under npm and bun, and `undefined` under pnpm, against real installs.[^packed-install-e2e]

[^testing-ts]: `packages/workspaces/src/testing.ts` — the entry point and its
    `@packageDocumentation` block.
[^source-boundary-ts]: `packages/workspaces/src/SourceBoundary.ts` — the
    rules, the exemption, the documented misses and `scan`.
[^source-text-ts]: `packages/workspaces/src/internal/sourceText.ts` —
    `LexedSource` and `lex`.
[^cli-logger-ts]: `packages/cli/src/CliLogger.ts:104` — the local `console`
    binding.
[^node-console]: <https://nodejs.org/api/console.html> — the global
    console's methods and the streams they write to.
[^layer-policy-ts]: `packages/workspaces/src/LayerPolicy.ts` — the policy
    schema and its field semantics.
[^workspace-layering-ts]: `packages/workspaces/src/WorkspaceLayering.ts` —
    the offence rule, `edgesOf` and `check`.
[^dependency-graph-ts]: `packages/workspaces/src/DependencyGraph.ts:114-120`
    — the merged adjacency.
[^layers-json]: `lib/configs/layers.json` — this repository's layer policy.
[^packed-install-plan-ts]: `packages/workspaces/src/internal/packedInstallPlan.ts`
    — `scrubEnv`, `closureOf`, `consumerFiles`, `installArgs`,
    `readPackedManifest`, `binConflict` and `fileOverridesOf`.
[^packed-install-ts]: `packages/workspaces/src/PackedInstall.ts` — `PackSource`,
    `run`, `closure` and the shared planner behind both.
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
