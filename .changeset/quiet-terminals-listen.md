---
"@effected/env": minor
---

## Features

First release. `@effected/env` answers three questions for any front end of an Effect v4 tool: **who is running it** (an AI agent, a CI job, or neither), **what the terminal can do** (colour level, OSC 8 hyperlinks and width, per stream), and **who the output is for** (a human, an agent or CI). Every answer is read once through `Config`, never from `process`, and every service has a `layerTest`, so a test fixes the environment without touching a global. `effect` is the only peer: there are no runtime dependencies, no platform import and no `@effected/*` edge.

### Runtime snapshot

- `RuntimeEnv` — a schema-class snapshot of the agent, the CI provider and the terminal program, persistable as plain JSON. `RuntimeEnv.fromRecord(env)` builds one as a pure function.
- `CurrentRuntimeEnv` — the snapshot as a service. `layer` reads the ambient `ConfigProvider` once; `layerFrom(source)` reads a record or provider of your own, fresh on every use, for a long-lived host; `layerTest(overrides)` fixes it.
- Agent detection follows std-env's table and reports the agent family (`AI_AGENT=claude-code_…` gives `"claude"`). `ci` is `"github-actions"` (a truthy `GITHUB_ACTIONS`, even with `CI=false`) or `"generic"` (`CI` or `CONTINUOUS_INTEGRATION`, unless `false` or `0`). An empty variable always counts as unset.

### Terminal capabilities

- `TerminalEnv` — per-stream `isTerminal`, colour level (`none`, `basic`, `256`, `truecolor`), `hyperlinks` and `columns`, plus `width(fallback)`. `layer()` needs core's `Stdio` and `Terminal`; `layerStdio()` needs only `Stdio`; `colorLevel("stdout")` decides colour alone.
- Colour follows Node's `getColorDepth` precedence: `FORCE_COLOR` first (so it beats `NO_COLOR`), then a non-empty `NO_COLOR` or `NODE_DISABLE_COLORS` and `TERM=dumb`, then the TTY check, then Windows (`OS=Windows_NT`, truecolor, as Node gives on Windows 10 build 14931 and later), then Node's terminal table.
- Hyperlink support uses std-osc8's detector: `FORCE_HYPERLINK` and `NO_HYPERLINK`, the terminal and version table, and tmux or screen as unsupported.

### Audience

- `Audience` — `human`, `agent` or `ci`, and the `source` that decided it. `layer({ envVar })` decides from `CurrentRuntimeEnv` and an override variable you name: a valid override wins, then an agent, then CI, then a human.
- `EnvOverride` — reads a variable that picks a mode within an audience, accepting only the literals you list per audience. `readResult` reports without logging; `read` logs one warning for a rejected value.

```ts
import { Audience, CurrentRuntimeEnv } from "@effected/env";
import { Effect, Layer } from "effect";

// A valid MYTOOL_AUDIENCE beats detection; then an agent, then CI, then a human.
const AudienceLive = Audience.layer({ envVar: "MYTOOL_AUDIENCE" }).pipe(Layer.provide(CurrentRuntimeEnv.layer));

const program = Effect.gen(function* () {
  const audience = yield* Audience;
  if (audience.kind === "agent") {
    // plain text, no escapes
  }
});
```
