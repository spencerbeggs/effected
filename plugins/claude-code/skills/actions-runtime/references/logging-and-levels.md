# Step debugging and `MinimumLogLevel`

Core's `References.MinimumLogLevel` defaults to `"Info"`, and an entry below
it is filtered before any `Logger` runs — so a `Debug`-level log never reaches
`ActionLogger.logger` to be rendered as `::debug::`. The level split
`actions-reporting` documents only fires for entries that survive this filter
first.

**`Action.run` bridges the two for you.** When the runner sets
`RUNNER_DEBUG=1` (step debugging, or "re-run with debug logging"), it lowers
`MinimumLogLevel` to `"Debug"` for the whole program, so every
`Effect.logDebug` — the action's own and every kit library's — shows up as a
`::debug::` line. Nothing to wire:

```ts
import { Action } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.logDebug("resolved 42 packages"); // visible under RUNNER_DEBUG=1

await Action.run(program);
```

Three properties of the built-in wiring:

- **It only ever lowers.** A level already at `"Debug"` or below — a `Trace`
  set by a layer passed as `Action.run(program, { layer })` — is left alone.
  Clamping to `"Debug"` would silently drop every `Trace` entry the moment
  someone turned step debugging on.
- **It is run-wide.** One decision per process, made before the program
  starts, so every step's `Effect.logDebug` is gated by the same answer.
- **The innermost provision still wins.** A program that provides its own
  `References.MinimumLogLevel` around part of itself overrides the runtime
  there, as with any `Context.Reference`.

Opt out when an action's debug output is too heavy to show even to someone
who asked for it:

```ts
await Action.run(program, { stepDebugLogLevel: false });
```

## Do not hand-wire it

Programs written before the runtime owned this carry a wrapper that reads
step debugging and provides `MinimumLogLevel` itself. Delete it. Beyond
duplicating the runtime, the usual shape — `debug ? "Debug" : "Info"` —
**raises** a lower level back to `"Info"` whenever step debugging is off,
which the built-in never does.

The trap that wrapper usually also carried: `isDebug` is a **member of the
service**, not a static. `yield* ActionEnvironment.isDebug` does not compile
(`TS2339: Property 'isDebug' does not exist on type 'typeof ActionEnvironment'`),
and past a cast or in plain JS the property reads `undefined` — the class
carries no static accessors for its members. Obtain the service first
when a program genuinely needs the flag for something other than its own log
level — say, passing a verbose flag to a tool it spawns:

```ts
import { ActionEnvironment } from "@effected/github-actions";
import { Effect } from "effect";

const installArgs = Effect.gen(function* () {
  const env = yield* ActionEnvironment;
  const stepDebug = yield* env.isDebug;
  return stepDebug ? ["install", "--reporter=ndjson", "--loglevel=debug"] : ["install"];
});
```

`ActionLogger.withBuffer` / `withStep` read the same flag: under step
debugging they skip buffering and write live, because someone asking for
verbose output wants it as it happens.
