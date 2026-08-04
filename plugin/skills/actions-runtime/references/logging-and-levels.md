# Wiring `isDebug` into `MinimumLogLevel`

`ActionEnvironment.isDebug` (`Effect.Effect<boolean>`, reading
`RUNNER_DEBUG === "1"`) only answers *whether* step debugging is on — it
does not, by itself, make `Effect.logDebug` calls visible. Core's
`References.MinimumLogLevel` defaults to `"Info"`, so a `Debug`-level log is
filtered before `ActionLogger.logger` ever gets a chance to render it as
`::debug::` — the level split `actions-reporting` documents only fires for
entries that survive this filter first.

Wiring the two together is a few lines every action otherwise reinvents:

```ts
import { ActionEnvironment } from "@effected/github-actions";
import { Effect, References } from "effect";

const withDebugLevel = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const debug = yield* ActionEnvironment.isDebug;
    return yield* Effect.provideService(program, References.MinimumLogLevel, debug ? "Debug" : "Info");
  });
```

Compose this once, at the top of `program.ts`, rather than per step — the
minimum level is a run-wide setting, not a per-step decision, and wiring it
once keeps every step's `Effect.logDebug` calls consistently gated by the
same answer to "is step debugging on."
