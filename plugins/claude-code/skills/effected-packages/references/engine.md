# @effected/engine

Pattern: `design-patterns`.

Platform-free primitives shared by every front end of an Effect v4 tool: carrier
distribution identity, a remediation shape, and launch-context resolution. Pure
tier: `effect` is the only peer, and the only dependency of any kind — no
`process`, no `node:` import, no platform package, not even as a devDependency
edge into `src/`. There is no IO here and nothing to provide at the edge.

**Nothing in the kit may depend on this package except `@effected/mcp`.**
`@effected/cli` must never depend on it — the two sit at the same
layer, both consumed by a front end, never by each other.

## Import

```ts
import { CurrentDistribution, Distribution, DistributionField, LaunchContext, Remediation, distributionSuffix } from "@effected/engine";
```

Single entrypoint; `src/index.ts` is the only re-exporting module.

## Core API

- **`Distribution`** — `Schema.Struct({ name, version })` + its decoded type: the
  carrier package (`@scope/plugin`) a tool's bins were installed through. A plain
  struct, not a `Schema.Class`, because it travels in JSON envelopes as a plain
  object and is compared structurally.
- **`DistributionField`** — `Schema.NullOr(Distribution)`: the `distribution`
  field of a machine-readable envelope, `null` when the front end was installed
  directly rather than through a carrier.
- **`CurrentDistribution`** — a `Context.Reference<Option.Option<Distribution>>`,
  not a `Context.Service`: it carries its own default (`Option.none()`), so a
  direct install needs no provision at all and reading it adds nothing to `R`. A
  front end's `main` provides it once, at the top of the program, with
  `Effect.provideService(CurrentDistribution, Option.fromNullishOr(options.distribution))`.
- **`distributionSuffix(distribution)`** — the `via <name> <version>` suffix
  (with a leading space) a `--version` line or a startup log line appends;
  `""` for a direct install (`Option.none()`).
- **`Remediation`** — `Schema.Struct({ hint, suggestedTool?, suggestedArgs? })` +
  its decoded type: what a caller — usually an agent — should do after a
  failure. The superset of two shapes consumers built independently: a
  folded-message shape and a structured-data shape. Both optional keys are
  `optionalKey`, so an explicit `undefined` is rejected rather than silently
  encoded.
- **`LaunchContext`** — a static-only class resolving where a tool launched by
  an agent host should treat as its project:
  - `LaunchContext.projectDir(input: ProjectDirInput): string` — the first
    usable `argv` value, then the first usable `env` value in `keys` order, then
    `cwd`. "Usable" means non-empty after trimming and free of a literal
    `${VAR}` placeholder — Claude Code passes `${CLAUDE_PROJECT_DIR}` through
    unsubstituted in some launch paths, and a path containing one is never what
    was meant.
  - `LaunchContext.isUnsubstituted(value: string): boolean` — whether a value
    still carries a literal `${VAR}` placeholder.
  - `ProjectDirInput` — `{ argv?, env, keys, cwd }`, all caller-supplied.
    Nothing inside `LaunchContext` reads `process`; `argv`/`env`/`cwd` come from
    the front end's own `main.ts`, which keeps the resolution rule shared and
    testable while the `process` read stays at the one place allowed to make
    it.

## Usage

`argv` takes **parsed positional arguments only, never raw `process.argv.slice(2)`** —
every non-empty value counts as a candidate, so a leading `--flag` would become
the project directory:

```ts
import { LaunchContext } from "@effected/engine";

// WRONG — raw argv, unfiltered: a leading flag is a non-empty candidate and wins.
const rawArgv = ["--verbose", "/expected/project"];
console.log(
  "wrong (raw argv):",
  LaunchContext.projectDir({ argv: rawArgv, env: {}, keys: [], cwd: "/fallback" }),
);

// RIGHT — only the command's own parsed positionals reach projectDir.
const positionals = ["/expected/project"];
console.log(
  "right (positionals):",
  LaunchContext.projectDir({ argv: positionals, env: {}, keys: [], cwd: "/fallback" }),
);
```

```text
wrong (raw argv): --verbose
right (positionals): /expected/project
```

Where the positionals exist decides where `projectDir` is called:

- **An MCP server** has no command parser, so it resolves once in `main.ts`,
  from `process.argv.slice(2)` with every flag filtered out, or from an env
  var alone with `argv: []` — `effect-v4-mcp`'s `server-wiring.md`, "Project
  directory", has the runnable shape.
- **A CLI on `effect/unstable/cli`** has no parsed positionals in `main.ts`:
  `Command.run` reads the raw arguments from the platform `Stdio` and parses
  them after `main.ts` has already handed the program to the runner, so the
  command's own `Argument` values exist only inside its handler. Call
  `projectDir` there. `main.ts`, the one file allowed to read `process`,
  passes `env` and `cwd` down to the command as plain values:

```ts
import { CliRuntime } from "@effected/cli";
import { LaunchContext } from "@effected/engine";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Option } from "effect";
import { Argument, Command } from "effect/unstable/cli";

// index.ts: the command tree. It reads no `process`; the launch facts it
// needs arrive as plain values.
interface LaunchFacts {
 readonly env: Readonly<Record<string, string | undefined>>;
 readonly cwd: string;
}

export const makeCommand = (launch: LaunchFacts) =>
 Command.make(
  "mytool",
  // Argument.String, not Argument.Path: a literal "${CLAUDE_PROJECT_DIR}"
  // must reach projectDir untouched so it can be recognised and skipped.
  { project: Argument.String("project").pipe(Argument.optional) },
  ({ project }) =>
   Effect.gen(function* () {
    // The parsed positional exists here, inside the handler, and nowhere earlier.
    const projectDir = LaunchContext.projectDir({
     argv: Option.toArray(project),
     env: launch.env,
     keys: ["MY_TOOL_PROJECT_DIR", "CLAUDE_PROJECT_DIR"],
     cwd: launch.cwd,
    });
    yield* Console.log(`project: ${projectDir}`);
   }),
 );

// main.ts: the one file that reads process.
const command = makeCommand({ env: process.env, cwd: process.cwd() });
NodeRuntime.runMain(CliRuntime.main(Command.run(command, { version: "1.0.0" }), { platform: NodeServices.layer }));
```

Run as `mytool /work/project` it prints `project: /work/project`; as
`mytool --verbose` — an unknown flag — the parser rejects it as a usage
error (exit `64` under `CliRuntime.main`) and the handler never runs; with
no argument, or with a literal `${CLAUDE_PROJECT_DIR}` the host left
unexpanded, it falls through to `MY_TOOL_PROJECT_DIR`, then
`CLAUDE_PROJECT_DIR`, then the working directory.

## Gotchas

- `LaunchContext.projectDir` never returns an empty string when `cwd` is
  non-empty (a property test pins this) — an env value that decodes to `""`
  or whitespace-only is treated as absent, not as "found but empty".
- `CurrentDistribution` is a reference, not a service: `yield* CurrentDistribution`
  works with nothing provided (`Option.none()` default) — do not reach for
  `Layer.succeed` to give it a value; use `Effect.provideService`.
- Purity is pinned by the package's own source-boundary test over
  `SourceBoundary.scan` from `@effected/workspaces/testing` (a devDependency;
  engine takes no runtime kit edge).
