# @effected/env

Teaching skill: `effect-v4-cli` (the `presentation.md` reference).

Detects who is running a program and what its terminal can do: an agent, a CI job or a person; colour level, hyperlink support and width per stream. Boundary tier with `effect` as its only peer: no `node:` import, no platform package, nothing read at import time, and **every environment variable read through `Config`**, so a test swaps a `ConfigProvider` instead of mutating `process.env`. It is its own package so an MCP server, an engine or a test reporter can detect the audience without depending on `@effected/cli`; `@effected/cli` peers on it and builds every service here through `CliEnv`.

## Import

```ts
import { Audience, CurrentRuntimeEnv, EnvOverride, RuntimeEnv, TerminalEnv } from "@effected/env";
import type { AudienceKind, ColorLevel, StreamEnv } from "@effected/env";
```

Single entrypoint.

## Core API

- **`RuntimeEnv`** — a `Schema.Class` snapshot: `{ agent: Option<string>, ci: Option<"github-actions" | "generic">, terminal: Option<{ name, version: Option<string> }> }`. `agent` is the agent *family* (`claude` for Claude Code), folded from known `AI_AGENT`-style values. Every `Option` field persists as plain JSON with `null` for absent (`Schema.fromJsonString(RuntimeEnv)` round-trips). `RuntimeEnv.fromRecord(env)` is the same detection as a pure function of a record (an empty value reads as unset).
- **`CurrentRuntimeEnv`** — the service carrying one `RuntimeEnv`. `layer` reads the ambient `ConfigProvider` once when built and needs nothing. Core's default provider snapshots `process.env` once per process and a layer memoizes by reference, so a long-lived host uses `layerFrom(source)` (a record or a `ConfigProvider`; a fresh layer per call). `layerTest({ agent?, ci?, terminal? })` takes `Option`s and never touches `Config`.
- **`TerminalEnv`** — `stdinIsTerminal`; `stdout` and `stderr`, each a `StreamEnv` `{ isTerminal, color: ColorLevel, hyperlinks, columns: Option<number> }`; and `width(fallback?)` (stdout columns, then `COLUMNS`, then the fallback). A snapshot, not live. `layer({ stderrIsTerminal? })` needs `Stdio | Terminal`; `layerStdio(options?)` needs only `Stdio` (columns `None`), for a long-lived host that must not build a terminal; `layerTest({ stdinIsTerminal?, stdout?, stderr? })` needs nothing; `TerminalEnv.colorLevel("stdout")` is the colour level alone, from `Stdio` and `Config`. `ColorLevel` is `"none" | "basic" | "256" | "truecolor"`.
- **`Audience`** — `{ kind: "human" | "agent" | "ci", source: "override" | "detected" | "flag" }`. Precedence: a valid value in the override variable you name, then agent, then CI, then human — **an agent inside a CI job is an agent**. `layer({ envVar? })` needs `CurrentRuntimeEnv`; `layerTest(kind, source?)`; `Audience.detect(runtimeEnv)` is the pure rule.
- **`EnvOverride`** — a variable that picks a mode **within** an audience, with per-audience accepted literals. `readResult({ envVar, accepts, source? })` returns `{ audience, accepted, rejected }` and never logs, so the host owns the wording and the stream; `read({ envVar, accepts })` is the convenience that logs one warning for a rejected value and yields `Option`. Matching is case-insensitive and yields the declared literal.

Colour follows Node's `getColorDepth`: `FORCE_COLOR`, when set, decides alone and beats `NO_COLOR`; otherwise a non-terminal stream has none; otherwise `NO_COLOR`/`NODE_DISABLE_COLORS`/`TERM=dumb` turn it off and the terminal table (`TERM`, `COLORTERM`, `TERM_PROGRAM`, CI) sets the depth. Hyperlink detection is terminal capability only; turning links off for an agent audience is `@effected/cli`'s job, where the audience is known.

## Usage

```ts
import { Audience, CurrentRuntimeEnv, EnvOverride, TerminalEnv } from "@effected/env";
import { ConfigProvider, Effect, Layer, Option } from "effect";

const accepts = { human: ["fancy", "plain"], agent: ["json"], ci: ["github", "plain"] } as const;

const reporter = Effect.gen(function* () {
  const audience = yield* Audience;
  const terminal = yield* TerminalEnv;
  const { accepted, rejected } = yield* EnvOverride.readResult({ envVar: "MYTOOL_REPORTER", accepts });
  if (Option.isSome(rejected)) yield* Effect.logWarning(`ignoring MYTOOL_REPORTER=${rejected.value.value}`);
  return Option.getOrElse(accepted, () => (audience.kind === "human" && terminal.stdout.color !== "none" ? "fancy" : "plain"));
});

// In a test: fix every fact, and the variable through the provider.
const answer = reporter.pipe(
  Effect.provide(Layer.mergeAll(Audience.layerTest("agent"), TerminalEnv.layerTest())),
  Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ MYTOOL_REPORTER: "JSON" })),
);

// In production: detection over the real environment (a CLI gets these from CliEnv instead).
export const live = Audience.layer({ envVar: "MYTOOL_AUDIENCE" }).pipe(Layer.provide(CurrentRuntimeEnv.layer));
export { answer };
```

## Testing machinery

`CurrentRuntimeEnv.layerTest`, `TerminalEnv.layerTest` and `Audience.layerTest` fix the answer and need nothing; to exercise the real detection instead, provide `ConfigProvider.fromUnknown({ ... })` as the `ConfigProvider` service around the real layers.

## Gotchas

- **`Audience.layer` and `EnvOverride.read` warn through `Effect.logWarning`**, and Effect's default logger writes to **stdout**. A stdio-sensitive host (an MCP server, anything whose stdout is a wire) routes logs to stderr — `@effected/cli`'s `CliLogger`, `@effected/mcp`'s stdio layer, or `References.LogToStderr`.
- **`CurrentRuntimeEnv.layer` sees the environment as it was when the process's default provider first snapshotted it.** A watch-mode host that must see changes uses `layerFrom(process.env)` per rebuild, or `EnvOverride.readResult`'s `source`.
- **`stderr.columns` is stdout's width**, and `layer`'s stderr terminal check mirrors stdout unless the host passes `stderrIsTerminal`: core's `Stdio` reports only stdout.
