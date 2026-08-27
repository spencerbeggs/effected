# `ToolDiscovery` and `LocalExec`

Load when: resolving whether a CLI tool is installed and which copy to run,
wiring a project-local launcher for `npx`/`pnpm exec`/`yarn exec`/`bun x`,
or debugging a stale/missing tool-presence answer.

## `ToolDiscovery` — absence is a spawn failure, never an exit code

A tool whose `--version` exits 1 still **exists**. `ToolDiscovery` decides
presence by whether the process **ran**, so there is no `command -v`
probe — interpolating a tool name into a shell string is an injection
hazard and breaks on Windows. Presence is read off whether a version-flag
spawn succeeds at all, never off its exit code.

```ts
import { Tool, ToolDiscovery } from "@effected/commands";

const biome = Tool.named("biome");                              // --version, source: "any", preferLocal
const localOnly = Tool.named("biome", { source: "local" });
const strict = Tool.named("deno", { version: VersionJson.make({ flag: "info --json", path: "deno.version" }) });

const discovery = yield* ToolDiscovery;
const resolved = yield* discovery.resolve(biome);                // ToolNotFoundError | ToolVersionMismatchError | ToolRefusedError | LocalExecError
yield* Run.text(resolved.command("check", "."));                 // ResolvedTool.command returns a core Command
```

`VersionProbe` is a union of three tagged classes:

| Variant | Asks | Fields |
| --- | --- | --- |
| `VersionFlag` | Run a flag, regex the version out of stdout | `flag` (default `--version`), optional `pattern` (first capture group; a default pattern covers common `Version: 2.3.1 (build …)`/`v22.1.0` shapes with no config) |
| `VersionJson` | Run a flag, read a dotted path from parsed JSON | `flag`, `path` (e.g. `"deno.version"`) |
| `VersionNone` | Presence only, no version | — |

`ToolSource` is `"any" | "global" | "local" | "both"` (default `"any"`,
preferring local when both are found); `MismatchPolicy` is `"preferLocal" |
"preferGlobal" | "fail"` (default `"preferLocal"`) — the policy for when
global and project-local copies disagree on version, surfaced regardless of
policy via `ResolvedTool.mismatch`.

Three resolution errors are structural, never a `reason: string`:
`ToolNotFoundError { tool, searched }` (nothing satisfying `source`),
`ToolVersionMismatchError { tool, globalVersion, localVersion }`
(`onMismatch: "fail"` and they disagree), `ToolRefusedError { tool }` (an
empty name, or one starting with `-` — refused **pre-spawn**, because argv
position zero is not a place to accept a flag).

### The evidence cache caches probe evidence, not resolved answers

The cache key is `(name, version probe)`, not the tool name alone — its
structural equality is what the cache uses, so the key carries the probe
itself with no side table. `source` and `onMismatch` are applied **per
call** against the cached evidence, so a second `Tool` with different
policy on the same name gets the right answer with no second probe.

Two TTL traps live in one place:

1. A plain cache memoizes a **failed** lookup for the entry's TTL by
   default — one transient probe failure would stick for the process
   lifetime.
2. "Not found" is a **successful** lookup carrying negative evidence —
   memoized, a tool installed mid-process (an action that provisions a
   runtime, then uses it) would stay absent forever.

So only a result with either copy found gets an infinite TTL; everything
else gets a zero TTL. A tool that exists does not stop existing; a tool
that does not exist very often starts to. This does **not** share the
interrupt-poisoning some Effect caching primitives have — an interrupted
lookup is discarded and re-run rather than memoized as a failure.

## `LocalExec` — the contract inversion

`@effected/commands` **declares** `LocalExec`; `@effected/workspaces`
**implements** it. The decisive argument is topological, not stylistic: a
direct `@effected/workspaces` edge would pull `commands` up a dependency
tier, and drag everything that depends on `commands` up with it.
`LocalExec` wants only "an argv prefix and a directory to run it in" — not a
workspace root, a package-manager name, or a manifest:

```ts
export interface LocalExecShape {
  readonly context: Effect.Effect<Option.Option<ExecContext>, LocalExecError>;
}
```

`ExecContext` carries `label` (reporting only — nothing branches on it),
`prefix`, `dlxPrefix`, `scriptPrefix`, optional `directory`; `.apply(command)`
/ `.applyDlx(command)` / `.applyScript(command)` prefix a core command and
apply `directory` — all return **new** command values, never mutating the
caller's. For `applyScript` the command's `command` field is the **script
name** and its `args` are the script's arguments.

`LocalExec.prefixes(launcher)` returns a `LauncherPrefixes` record and is
the one place the four package managers'
argv lives: `npx --no --` / `pnpm exec` / `yarn exec` / `bun x
--no-install`, plus each `dlxPrefix`, plus each `run` form as
`scriptPrefix` — npm's `--no` and bun's `--no-install` both refuse to
silently install a missing binary. **npm's `scriptPrefix` is `["npm",
"run", "--"]`, trailing `--` included** — a bare `npm run <script> --flag`
silently claims `--flag` for npm itself and delivers nothing to the script;
the other three managers forward post-script arguments without needing it.

A single-package consumer never installs `@effected/workspaces`:

```ts
const AppLayer = ToolDiscovery.layer.pipe(
  Layer.provide(LocalExec.layerFor("npm")),  // or LocalExec.layerNone for global-only
  Layer.provide(NodeServices.layer),
);
```

**`Option.none()` is a real answer, never an error.** "No project-local way
to run tools here" is `Option.none()` from `context`; `LocalExecError` is
reserved for a genuine mechanism failure (an unreadable manifest). This is
the same none-is-success convention `@effected/npm`'s resolver contracts
use.

`LocalExec.makeTest` is the recorded exception to the die-loudly test-double
rule — its one member defaults to `Option.none()` rather than dying,
because "no project-local context" *is* the honest global-only answer, not
a fabrication. `ToolDiscovery.makeTest` keeps the loud default: none of its
members has an honest default, since a fabricated resolved tool would leak
into consumer logic as fact. The test for admissibility is "would a real
implementation legitimately answer this?", not "is it convenient" — see
`testing-actions` for the fuller doctrine.
