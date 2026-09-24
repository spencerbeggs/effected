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

Wiring it into a program, using a command framework's own parsed positionals:

```ts
import { CurrentDistribution, LaunchContext } from "@effected/engine";
import { Effect, Option } from "effect";

// A CLI's main.ts: `positionals` is the command's own parsed positional
// arguments, not raw process.argv.
declare const positionals: ReadonlyArray<string>;

const projectDir = LaunchContext.projectDir({
 argv: positionals,
 env: process.env,
 keys: ["OKFIT_PROJECT_DIR", "CLAUDE_PROJECT_DIR"],
 cwd: process.cwd(),
});

const program = Effect.gen(function* () {
 const distribution = yield* CurrentDistribution;
 // ... use projectDir and distribution
});

Effect.runPromise(
 program.pipe(Effect.provideService(CurrentDistribution, Option.none())),
);
```

## Gotchas

- `LaunchContext.projectDir` never returns an empty string when `cwd` is
  non-empty (a property test pins this) — an env value that decodes to `""`
  or whitespace-only is treated as absent, not as "found but empty".
- `CurrentDistribution` is a reference, not a service: `yield* CurrentDistribution`
  works with nothing provided (`Option.none()` default) — do not reach for
  `Layer.succeed` to give it a value; use `Effect.provideService`.
- Purity is pinned by `__test__/purity.test.ts` over `SourceBoundary.scan` from
  `@effected/workspaces/testing` (a devDependency; engine takes no runtime kit
  edge).
