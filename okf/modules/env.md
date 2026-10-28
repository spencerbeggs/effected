---
type: Module
title: "@effected/env"
description: The boundary package that detects who is running a program and in what terminal — agent, CI and its run, session, colour level, hyperlink support and width — through Config, and reads shell export files in one strict dialect, with no node imports and no import-time reads.
status: draft
kind: package
resource: ../../packages/env
layer: boundary
tags: [architecture, bundle, dx]
sources:
  - id: boundary-test
    resource: ../../packages/env/__test__/purity.test.ts
    title: "env purity: no process read, node: import, platform or kit import, or console write in src"
generated:
  by: "okfit/claude-code"
  at: 2026-10-28T14:02:58Z
integrity:
  generated:
    body: 166adc956342a790
---

# @effected/env

`@effected/env` answers two questions for any front end of a tool: *who is
running this* and *what can the terminal do*.[^boundary-test] Beside them it
reads and writes shell export files (`ShellExports`), the form a session
environment is handed between processes in.
It is a [boundary-tier](../glossary/library-tier.md) package with `effect` as
its only peer, no `node:` import, and nothing read at import time. Every
environment variable goes through `Config`, so a test controls it. Each
service is a `Context.Service` class with a static `layer` and `layerTest`;
`layerTest` is the only way a test changes the environment. `RuntimeEnv`
itself is a `Schema.Class` data snapshot, carried by the `CurrentRuntimeEnv`
service.

It is its own package, and a required peer of `@effected/cli`, so that MCP
servers, engines and a Vitest plugin can detect without a CLI dependency; see
[its own package](../decisions/env-is-its-own-package.md).

## Public surface

| Export | Contract |
| --- | --- |
| `RuntimeEnv` and `CurrentRuntimeEnv` | `RuntimeEnv` is the snapshot `Schema.Class`: `{ agent: Option<string>, ci: Option<CiName>, terminal: Option<{ name, version: Option<string> }>, session: Option<TerminalSession>, ciRun: Option<CiRun>, termProgram: TermProgram }`. `agent` is the agent *family* (`claude` for Claude Code, which sets `AI_AGENT=claude-code_2-1-285_agent`): a known family name, or a value starting with one then `-` or `_`, is folded to the family; an unknown `AI_AGENT` value stays as lower-cased. `session` is the terminal or multiplexer session that survives a re-attach: the first set of `TMUX_PANE` (`tmux`), `STY` (`screen`), `WT_SESSION` (`windows-terminal`), `WEZTERM_PANE` (`wezterm`), `KITTY_WINDOW_ID` (`kitty`) and `TERM_SESSION_ID` (`term-session`, iTerm2 and Terminal.app), carrying the matched `variable`, its raw `id`, and a `multiplexer` (`TMUX` before `STY`, raw) whichever source won. `ciRun` is `Some` exactly when `ci` is: `runId`, `attempt`, `jobId`, `sha`, `refName` and `runner: { os, arch }`, each read raw from the matched provider's documented variable and `None` where it documents none (every coordinate of `generic` is `None`); GitHub Actions reads `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GITHUB_JOB`, `GITHUB_SHA`, `GITHUB_REF_NAME`, `RUNNER_OS`/`RUNNER_ARCH`, and GitLab's job id is `CI_JOB_ID`. `termProgram` is the raw `TERM_PROGRAM` / `TERM_PROGRAM_VERSION` pair, independent halves, kept even for programs `terminal` does not recognise (`tmux`, `zed`). Every `Option` field is `Schema.OptionFromNullOr` behind `withDecodingDefaultTypeKey`, so the snapshot persists as plain JSON through `Schema.fromJsonString(RuntimeEnv)`, with `null` for absent (`Schema.Option` does not: its JSON form is a tagged object that decodes back to an error). Fields added after 0.1.0 must decode when absent and default in `make`, so a persisted snapshot keeps decoding and a caller written against `{ agent, ci, terminal }` keeps constructing; three frozen wire literals in the tests pin it (two from 0.1.0, one with every kit-ports field populated), and none is ever regenerated. It is a data class, not a service tag: no kit service is a `Schema.Class`, and this service's whole shape is one immutable value, so `CurrentRuntimeEnv` is the `Context.Service` carrying it. `RuntimeEnv.fromRecord(env)` is the same computation as a pure function of a record (an empty or `undefined` value reads as unset). The layer reads the detector keys first and then only the matched provider's run-coordinate keys. `CurrentRuntimeEnv.layer` needs nothing and reads the ambient `ConfigProvider` once when built, so it is safe inside a stdio MCP server, but core's default provider snapshots `process.env` once per process and the layer is memoized by reference, so a long-lived host uses `CurrentRuntimeEnv.layerFrom(source)` (a record or a `ConfigProvider`), a `Layer.fresh` layer per call that two sources in one graph never share; `layerTest(overrides?)` takes `{ agent?, ci?, terminal?, session?, ciRun?, termProgram? }`, defaults every field to `None`, and never touches `Config` (`ci` and `ciRun` are independent there: set both for a consistent snapshot). |
| `CiName` | The literal union `RuntimeEnv.ci` decodes, 40 names: std-env 4.3.0's provider set, lower-cased with `_` as `-` (except `github-actions` and `circleci`), plus `generic` for a bare `CI` or `CONTINUOUS_INTEGRATION`. **The exclusion rule**: a provider is left out when std-env itself marks it `ci: false` (`VERCEL`, `VERCEL_ENV`, `NETLIFY_LOCAL`, `CODESANDBOX_*`), when it is a runtime host whose variable is set in the serving process as well as the build (Cloud Run, Cloud Run jobs, Render, Railway, Deno Deploy, and StackBlitz), or when no provider document confines its variable to the build (Stormkit, Zeabur, Codesphere, Firebase App Hosting); a left-out host under `CI=true` reads as `generic`. A runtime host would otherwise make a production server read as CI and get CI output. Kept because the provider documents the variable as build-only: `NETLIFY`, `CF_PAGES`, `WORKERS_CI`, `NOW_BUILDER`. GitHub Actions is checked first, then std-env's table order decides between two matching rows; Jenkins detects on `JENKINS_URL`, as std-env does. **A documented departure from std-env**: `false`, `0`, `off` or `no` (any case) on `CI`, `CONTINUOUS_INTEGRATION` or a provider's own marker reads as unset, so `CI=false` turns CI output off; std-env reads any non-empty value as set. A provider marker that is set wins even under `CI=false`. A consumer matches `ci` exhaustively, so widening the union is breaking: a snapshot naming a new provider does not decode under an older reader. |
| `ShellExports` | Reads and writes shell export files in one strict dialect: what `printf 'export %s=%q\n'` and `ShellExports.format` write, and Claude Code's `session-env` files use. The dialect is blank lines, `#` comment lines, and `export NAME=WORD` statements, one assignment each, ending at an unquoted newline or `;`. `NAME` matches `[A-Za-z_][A-Za-z0-9_]*` and is not special to bash; `WORD` concatenates bare characters with no expansion character (a `~` only where bash would not expand it), `\x` escapes, `'…'`, `"…"` without `$` or a backtick, and `$'…'` (bash's escapes, with `\xHH` and `\nnn` bytes decoded as UTF-8; the bytes of one `$'…'` must be UTF-8 as a whole, and `\u`/`\U`, a NUL escape and escapes bash versions disagree on are refused). **It never interprets**: a text inside the dialect means exactly the variables bash sourcing it would export, and anything else rejects the **whole** text as `ShellExportsError { line, column, reason }`, the first place it leaves the dialect, `reason` one of `unsupported-statement`, `expansion`, `special-variable`, `unterminated-quote`, `invalid-encoding` or `invalid-name`. A CRLF or hand-edited file is therefore rejected whole: a failure means "do not trust the file". The special-variable denylist covers read-only, dynamic, array, bash-set and bash-builtin-written names (`COMP_WORDBREAKS` is special; `PIPESTATUS` is plain when the text is sourced before any pipeline runs, and the next pipeline overwrites it; `SRANDOM` turns special at bash 5.1 and `BASH_MONOSECONDS` / `BASH_TRAPSIG` at 5.3, which the denylist rejects on every version) and every `BASH_` name. The claim assumes the sourcing shell has no `export` function or alias and no read-only variable the text names. A leading U+FEFF in a value is kept, as bash keeps it. `parseResult(text)` returns a `Result` (a null-prototype record, later exports winning, linear in the text); `parse` is the same as an `Effect` with a span; `parseBytesResult(bytes)` reads at the byte level, for macOS `/bin/bash` 3.2, whose `printf %q` writes a non-ASCII value as raw bytes mixed with octal escapes inside one `$'…'` (decoding to a string first would turn those into U+FFFD and reject); for the UTF-8 bytes of any text it returns what `parseResult` returns, rejection position included. bash 3.2 also writes a leading `~` bare, which bash expands, so such a text is rejected as an expansion. `format(vars)` writes one `export` line per entry in record order: bare for `A-Za-z0-9_@%+=:,./-`, `$'…'` for a control character or DEL, otherwise `'…'`; it emits only the dialect and throws `RangeError` on an invalid or special name, a NUL, or a lone surrogate. Core's `ConfigProvider.fromDotEnvContents` is not a substitute: its dotenv grammar is lenient and skips what it does not understand. |
| `TerminalEnv` | `stdinIsTerminal`; per-stream `stdout` and `stderr`, each `{ isTerminal, color, hyperlinks, columns }`; `width(fallback)`, which reads stdout columns, then `COLUMNS`, then the fallback; and a standalone `colorLevel(stream)`. A snapshot, not live. `layer(options?: TerminalEnvOptions)` takes `{ stderrIsTerminal?: Effect<boolean> }`, an override of `Stdio.stderrIsTerminal` (every stream's terminal check is read from `Stdio`), and requires `Stdio` and `Terminal`; `layerStdio(options?)` is the same snapshot from `Stdio` and `Config` alone, with no `Terminal` and `columns` `None`, for a long-lived host that must not build `NodeTerminal`; `layerTest(partial?: TerminalEnvTestOptions)` takes `{ stdinIsTerminal?, stdout?, stderr? }`. `colorLevel(stream)` needs `Stdio` and `Config` only, and answers with an ambient `TerminalEnv`'s stdout colour when one is provided. `hyperlinks` is terminal capability only; `stderr.columns` is stdout's width. `colorLevelFrom(env, isTTY)` is the same colour rule as a pure function of an environment record (empty or `undefined` reads as unset, as the layer reads it), for synchronous code with no `Stdio` (issue 1139). `capabilities(terminal, term?)` projects a snapshot into core's `effect/cli` `TerminalCapabilities` value: `canColor` is stdout's colour not `none` (the kit's rule, so `FORCE_COLOR` beats `NO_COLOR` where core lets `NO_COLOR` win), `canAnimate` stdout a terminal, `canPrompt` stdin and stdout terminals, both cleared by `TERM=dumb` as in core. `TERM` is an argument because the snapshot does not carry it. **No layer that installs core's reference lives here, on purpose**: `effect/cli` exports `TerminalCapabilities` only through its barrel, with no deep subpath, so a value import of the reference loads the whole barrel (14 modules, about +15 ms over the roughly 75 ms of the `effect` root, unbundled Node, measured on effect 4.0.7) for every env consumer, the synchronous colour path of issue 1139 included; bundlers tree-shake it, Node does not. The projection's import is type-only, and `entrypoints.test.ts` pins that `.` never loads `effect/cli` at runtime, with a positive control. `@effected/cli`'s `CliEnv.layer` installs the reference instead. |
| `Audience` | `human`, `agent` or `ci`. Precedence: a valid override environment variable, then agent, then CI, then human, so an agent inside a CI job gets agent output. `source` is `override`, `detected` or `flag`. `layer(options?: AudienceOptions)` takes `{ envVar?: string }` and requires `CurrentRuntimeEnv`; `layerTest(kind, source?)` fixes the kind, with `source` defaulting to `override` and accepting `override`, `detected` or `flag`; `Audience.detect(env)` is the pure agent, then CI, then human rule over a `RuntimeEnv`. |
| `EnvOverride` | Reads a variable that picks a mode *within* an audience. `readResult` returns `{ audience, accepted, rejected }` and never logs, so a host owns the wording, the stream and any dedupe; `read` is the logging convenience over it. Without its `source` option `readResult` reads the fiber's `ConfigProvider` on every call, so a reader built once at module level is tested by providing a provider around the read; `source` (a record re-read per call, or a provider) is for a long-lived host, and a host that wants it and testability builds the options inside a function that takes the source (vitest-agent A8). An invalid value logs one warning and yields `None`; it never fails the run. Warnings go through `Effect.logWarning`, which writes to stdout unless `References.LogToStderr` is set, so a stdio-sensitive host routes logs to stderr. The kit never learns a consumer's literals. |

Colour follows Node's `getColorDepth` precedence
([decision](../decisions/force-color-honoured-node-precedence.md)). Node's
win32 branch reads `process.platform`, which this package never touches, so
`OS=Windows_NT` stands in for it at the same place in the order: after the
disable checks and the TTY gate, before `TMUX`, CI and `TERM`, and always
truecolor. That approximates Node on Windows 10 build 14931 and later; an
older build gets more colour than Node would give. Hyperlink
detection is a port of std-osc8's pure core
([decision](../decisions/osc8-ported-not-wrapped.md)); hyperlinks being off
for the agent audience is applied in `cli`, where the audience is known, not
here.

## Bound by

- [`dependency-policy`](../conventions/dependency-policy.md)
- [`peer-dependency-discipline`](../conventions/peer-dependency-discipline.md)
- [`testing-standards`](../conventions/testing-standards.md)

## See also

- [`@effected/cli`](cli.md)
- [`@effected/engine`](engine.md)

[^boundary-test]: `packages/env/__test__/purity.test.ts`, which pins the no-`node:` and no-import-time-read rules; the exports are pinned in `entrypoints.test.ts`
