# @effected/env

Teaching skill: `effect-v4-cli` (the `presentation.md` reference).

Detects who is running a program and what its terminal can do: an agent, a CI job or a person; colour level, hyperlink support and width per stream. Boundary tier with `effect` as its only peer: no `node:` import, no platform package, nothing read at import time, and **every environment variable read through `Config`**, so a test swaps a `ConfigProvider` instead of mutating `process.env`. It is its own package so an MCP server, an engine or a test reporter can detect the audience without depending on `@effected/cli`; `@effected/cli` peers on it and builds every service here through `CliEnv`.

## Import

```ts
import { Audience, CurrentRuntimeEnv, EnvOverride, RuntimeEnv, ShellExports, ShellExportsError, TerminalEnv } from "@effected/env";
import type { AudienceKind, CiName, CiRun, ColorLevel, StreamEnv, TerminalSession, TermProgram } from "@effected/env";
```

Single entrypoint.

## Core API

- **`RuntimeEnv`** — a `Schema.Class` snapshot: `agent: Option<string>`, `ci: Option<CiName>`, `terminal: Option<{ name, version: Option<string> }>`, `session: Option<TerminalSession>`, `ciRun: Option<CiRun>`, `termProgram: TermProgram`. `agent` is the agent *family* (`claude` for Claude Code), folded from known `AI_AGENT`-style values. `session` is the pane identity that survives a re-attach: `{ source, variable, id, multiplexer }`, the first of `TMUX_PANE`, `STY` (screen), `WT_SESSION`, `WEZTERM_PANE`, `KITTY_WINDOW_ID`, `TERM_SESSION_ID`, with `multiplexer` carrying raw `TMUX` or `STY` whichever source won. `ciRun` is `Some` exactly when `ci` is: `runId`, `attempt`, `jobId`, `sha`, `refName`, `runner: Option<{ os, arch }>`, each read raw (strings, as the provider wrote them) from that provider's documented variables, `None` where it documents none and always for `generic`; GitLab's job id is `jobId` (`CI_JOB_ID`). `termProgram` is `TERM_PROGRAM` and `TERM_PROGRAM_VERSION` verbatim, each an `Option`, kept even for a program `terminal` does not recognise (`tmux`, `zed`). Every `Option` field persists as plain JSON with `null` for absent (`Schema.fromJsonString(RuntimeEnv)` round-trips), every field decodes when its key is absent, and `session`, `ciRun` and `termProgram` default in `make` too, so an older snapshot or constructor call still works. `RuntimeEnv.fromRecord(env)` is the same detection as a pure function of a record (an empty value reads as unset).
- **`CiName`** — a literal union a consumer can match exhaustively: std-env's provider set (lower-cased, `_` as `-`; `github-actions`, `gitlab`, `jenkins` with `JENKINS_URL` as std-env detects it, `circleci`, `azure-pipelines`, `buildkite`, …) minus the rows std-env itself does not call CI and minus the **runtime hosts** (Cloud Run, Render, Railway, Deno Deploy and the like, whose variable is set in the serving process too, so a production server would read as CI), plus `generic` for a bare `CI` or `CONTINUOUS_INTEGRATION`. GitHub Actions is checked first; a provider's own marker wins over `CI=false`. **A deliberate departure from std-env**: a detection variable — `CI`, `CONTINUOUS_INTEGRATION` or a provider marker — set to `false`, `0`, `off` or `no` (any case) reads as unset, so `CI=false` is NOT CI and gives a user interactive output back. A `Record<CiName, …>` map breaks whenever the union widens.
- **`CurrentRuntimeEnv`** — the service carrying one `RuntimeEnv`. `layer` reads the ambient `ConfigProvider` once when built and needs nothing. Core's default provider snapshots `process.env` once per process and a layer memoizes by reference, so a long-lived host uses `layerFrom(source)` (a record or a `ConfigProvider`; a fresh layer per call). `layerTest({ agent?, ci?, terminal?, session?, ciRun?, termProgram? })` takes `Option`s (`termProgram` the plain pair) and never touches `Config`; `ci` and `ciRun` are independent there, so set both for a consistent snapshot.
- **`TerminalEnv`** — `stdinIsTerminal`; `stdout` and `stderr`, each a `StreamEnv` `{ isTerminal, color: ColorLevel, hyperlinks, columns: Option<number> }`; and `width(fallback?)` (stdout columns, then `COLUMNS`, then the fallback). A snapshot, not live. `layer({ stderrIsTerminal? })` (an override of `Stdio.stderrIsTerminal`, read by default) needs `Stdio | Terminal`; `layerStdio(options?)` needs only `Stdio` (columns `None`), for a long-lived host that must not build a terminal; `layerTest({ stdinIsTerminal?, stdout?, stderr? })` needs nothing; `TerminalEnv.colorLevel("stdout")` is the colour level alone, from `Stdio` and `Config`. `ColorLevel` is `"none" | "basic" | "256" | "truecolor"`.
- **`Audience`** — `{ kind: "human" | "agent" | "ci", source: "override" | "detected" | "flag" }`. Precedence: a valid value in the override variable you name, then agent, then CI, then human — **an agent inside a CI job is an agent**. `layer({ envVar? })` needs `CurrentRuntimeEnv`; `layerTest(kind, source?)`; `Audience.detect(runtimeEnv)` is the pure rule.
- **`EnvOverride`** — a variable that picks a mode **within** an audience, with per-audience accepted literals. `readResult({ envVar, accepts, source? })` returns `{ audience, accepted, rejected }` and never logs, so the host owns the wording and the stream; `read({ envVar, accepts })` is the convenience that logs one warning for a rejected value and yields `Option`. Matching is case-insensitive and yields the declared literal.

- **`ShellExports`** — read and write shell export files (Claude Code's `session-env` files, `printf 'export %s=%q\n'` output) in **one strict dialect**: blank lines, `#` comment lines and `export NAME=WORD` statements, one assignment each, where WORD is bare characters, `\x` escapes, `'…'`, `"…"` without `$` or a backtick, and `$'…'`. It **never interprets**: a text inside the dialect means exactly what bash sourcing it would export, and anything outside it rejects the **whole** text (once one statement is not understood, no earlier variable can be trusted). `parseResult(text)` → `Result<Record<string, string>, ShellExportsError>` is the primary form; `parse(text)` is its `Effect` with a span; `parseBytesResult(bytes)` reads raw file bytes — use it for output from macOS's `/bin/bash` 3.2, whose `printf %q` mixes raw bytes and octal escapes inside one `$'…'` that a string decode turns into U+FFFD. `ShellExportsError` carries `{ line, column, reason }` (1-based; `column` in UTF-16 code units), with `reason` one of `unsupported-statement`, `expansion`, `special-variable`, `unterminated-quote`, `invalid-encoding`, `invalid-name`. `special-variable` is a denylist of names bash does not leave plain (`UID`, `PPID`, `RANDOM`, `SECONDS`, `IFS`, `PWD`, `SHLVL`, `POSIXLY_CORRECT`, `COMP_WORDBREAKS`, … and **every `BASH_`-prefixed name**). `format(vars)` writes only the dialect (bare, `'…'` or `$'…'` per value; every line ends `\n`) and **throws `RangeError`** for an invalid or special name, or a value holding NUL or a lone surrogate — a caller's mistake, not input. A later export of the same name wins, as in bash; the record has a null prototype. Pure and synchronous. Core's `ConfigProvider.fromDotEnvContents` is not a substitute: its grammar is lenient and skips what it does not understand.

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
- **A `ShellExports` failure means "do not trust the file"** — never fall back to reading part of it. A CRLF or hand-edited file is rejected whole (`\r` is a raw control character). The no-interpretation claim assumes the sourcing shell has no `export` function or alias and no read-only variable the text names.
- **`stderr.columns` is stdout's width**; stderr's terminal check is its own, read from `Stdio.stderrIsTerminal`, and `stderrIsTerminal` only overrides it for a `Stdio` that cannot say.
