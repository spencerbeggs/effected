---
status: current
module: effected
category: architecture
created: 2026-08-13
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../package-setup.md
  - ../consumers/reposets.md
  - config-file.md
  - app.md
---

# @effected/cli design

## Overview

`@effected/cli` is the **boundary layer** of a command-line program built on `effect/unstable/cli`: how output reaches a human, how a failure is reported and how a schema issue is rendered into a sentence a user can act on.

It is emphatically **not** a CLI framework. `effect/unstable/cli` owns argument parsing, flags, the command tree and the help system, and this package must never grow a second one — see [Non-goals](#non-goals), which is the most load-bearing section here.

The distinguishing property of everything in scope: **a consumer only discovers the need by shipping bad output to a person.** None of it fails a type-check, a test or a review of the code in isolation. That is what makes it a package rather than a snippet — the default behaviour is wrong in a way the author cannot see from the call site.

## Motivation: three defaults that are wrong at a terminal

Each of the three is found by running a binary, never by reading the code.

**1. Effect's default logger is a service log line, not CLI output.** It emits `[00:33:56.619] INFO (#2): message`. That is correct for a long-running service being scraped, and wrong for a tool a person is watching: it made a formatted permissions table unreadable. Every `unstable/cli` program needs a logger that renders the message plainly, which means every such program writes this or ships timestamps to users. A CLI can ship without one while its own docs claim otherwise — the failure is invisible from inside the code.

**2. An unhandled failure reports through the default logger, on stdout.** `NodeRuntime.runMain` reports an unhandled failure using Effect's *default* logger, which sits **outside** the layers the program was provided. So a program that carefully installs a CLI logger still prints its failures in the structured format that logger exists to replace — and prints them on **stdout**, the one stream errors must not use, because `mytool run > log.txt` must still show failures on the terminal.

**3. A `SchemaIssue` tree is not a sentence.** A config validation failure arrives as a structured tree; a user needs `unknown key at groups.g.cleanup.rulesetz`. Core *does* ship formatters — `SchemaIssue.makeFormatterStandardSchemaV1` — and they are near-undiscoverable: they live in `SchemaIssue` rather than `SchemaError` or `Schema`, are named `makeFormatter*` rather than anything containing "render", and `SchemaError.message` does not use them, so the obvious probe — print the error — hints at nothing. A named export ends that search for everyone.

## Kit positioning

**Tier: boundary.** It performs IO — writing to a terminal is IO — but discharges it through core contracts required in `R`, takes no external runtime dependency, and must not import a platform package. This is the same posture as [`config-file`](config-file.md), and deliberately *not* `github-actions`', which is the one package carrying `@effect/platform-node` as a required peer.

**Nothing in the kit may depend on it except an application**, the same rule [`app`](app.md) carries. A library that reaches for CLI output has made a decision that belongs to the program at the top.

`app` and `cli` are siblings, not layers: `app` is the control plane (directories, state, cache, config), `cli` is the presentation boundary. Neither imports the other. An application composes both.

## Public surface

Four exports, each a static class with a private constructor — never an `as const` namespace object, which loses its members' TSDoc in the built `.d.ts`.

| Export | What it is |
| :--- | :--- |
| `CliLogger` | A `Logger` rendering messages plainly, routing `Error`/`Fatal` to stderr and everything else to stdout |
| `CliRuntime` | The failure-reporting wrapper: report through the program's own logger, set the exit code |
| `SchemaIssueRenderer` | `SchemaIssue` tree → actionable lines, over core's formatter |
| `ConfigIssueRenderer` | The same for `@effected/config-file`'s `ConfigValidationError` |

### CliLogger, and why it does not need `Stdio`

The obvious design — write through `Stdio`'s `stdout()` / `stderr()` sinks — **does not fit**. `Logger.make(log)` takes a **synchronous** callback (core's `Logger.ts`). A `Sink` write is an `Effect`. A logger cannot `yield*`.

The sanctioned path is the one core's own `defaultLogger` takes: read the **`Console` reference off the fiber, synchronously**.

```ts
Logger.make(({ message, logLevel, fiber }) => {
  const console = fiber.getRef(Console.Console)   // public Context.Reference
  const write = LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom) ? console.error : console.log
  write(render(message))
})
```

**Compare levels ordinally, never by string equality.** A `logLevel === "Error" || logLevel === "Fatal"` test hard-codes two names and silently misses any level above `Fatal`, including one added upstream. `stderrFrom` defaults to `"Error"` and the threshold is the option.

`Console.Console` is a **public** `Context.Reference<Console>` (core's `Console.ts`, the same binding its internals call `ConsoleRef`) with `globalThis.console` as its default value. Three consequences, all good:

- **No platform package, and no `Stdio` in `R`.** A `Context.Reference` carries a default, so nothing is imposed on the consumer's layer stack.
- **Stream routing is expressible** — `console.error` versus `console.log` is exactly the stderr/stdout split requirement 2 above demands.
- **It is testable by construction.** Swapping the `Console` reference is how `TestConsole` already works, so a suite asserts on captured output without stubbing globals. Note the known trap: `TestConsole` and `Effect.log*` share the same reference, so a test asserting on one sees the other.

`References.LogToStderr` exists as a public reference too, and is how core's default logger decides its stream. `CliLogger` **honours it as a force-all-to-stderr override** and never as a per-level one — see [Decisions](#decisions).

### CliRuntime — wrap the reporting, not the runtime

The failure in motivation 2 is *where the report happens*, not that `runMain` exists. The fix is to catch inside the effect, render through the program's own logger, and set the exit code — all of which happen **before** any `runMain` is called.

So this package provides a **combinator applied inside the program**, and the consumer still calls their platform's `runMain` themselves:

```ts
NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures, Effect.provide(MainLive)))
```

This is what keeps the package free of `@effect/platform-node`. Wrapping `runMain` itself would drag a platform choice into a library that has no business making one — and would make the package unusable from Bun or Deno for no gain.

The exit code and the duplicate-report suppression both ride on the re-failed error via `Runtime.errorExitCode` and `Runtime.errorReported`; see [Decisions](#decisions), including the inverted polarity of the second.

### The renderers

`SchemaIssueRenderer` wraps `SchemaIssue.makeFormatterStandardSchemaV1` rather than reimplementing it. Its job is discoverability, **deduplication** and one override.

Deduplication is not cosmetic: a three-member union prints the same unknown-key line three times, once per member, which buries the lines that say which shapes *were* allowed under repetitions of the one saying what was not. The override: core's `UnexpectedKey` phrasing is `"Expected no excess property"`, which describes **the schema's rule** rather than **the user's mistake**. `unknown key "rulesetz"` is what a person needs, and it is one string away.

`ConfigIssueRenderer` is the same treatment for `ConfigValidationError`, whose `issue` tree is the same shape. It is the reason this package peers on `@effected/config-file` rather than the other way around: rendering is presentation and belongs at the boundary.

**`@effected/config-file` is an `optional` peer**, mirroring `@effected/markdown`'s arrangement with `jsonc` / `toml` / `yaml` (`peerDependenciesMeta.optional: true`). The manifest is the easy half; the load-bearing half is that **`ConfigIssueRenderer` is its own module that nothing but the entrypoint imports**, with shared rendering in `src/internal/format.ts`. An optional peer reached from a shared module is not optional, it is a runtime crash for every consumer who believed the manifest. Verified by build rather than by reading: every runtime `import` in every emitted chunk is `effect` or relative, and the package's only references to `@effected/config-file` are comments and one **type-only** import in the `.d.ts`.

One consequence to state rather than discover: because that type appears in a public signature, a consumer who has *not* installed the optional peer sees the type fail to resolve in that one module — harmless at runtime, and invisible under the common `skipLibCheck: true`, but real. `@effected/markdown` ships the identical pattern, so this is the kit's established trade rather than a new one: an optional peer buys install-time freedom and costs type resolution in the module that names it.

## Decisions

Three decisions settled against core's source rather than by argument, recorded with their reasoning because that is what a future reader needs.

**1. The exit code is settable platform-free — no `process.exitCode`, no compromise.** Core exposes two markers read off the *squashed* failure by `defaultTeardown` / `makeRunMain`:

- `Runtime.errorExitCode` — a readonly property on an error class giving the process exit code for that failure. **`Runtime.getErrorExitCode` already returns `1` for an unmarked error**, so `getErrorExitCode(e) ?? 1` is dead code — and reading it alone cannot tell an error deliberately marked `1` from an unmarked one, which matters the moment an `exitCode` option exists to override the second but not the first. Test for the marker (`Runtime.errorExitCode in error`), then read it.
- `Runtime.errorReported` — controls whether the runtime logs the failure itself.

So `CliRuntime.reportFailures` renders through the program's own logger and re-fails with an error carrying both markers: the exit code it wants, and reporting suppressed so the default logger does not print the same failure a second time in the format `CliLogger` exists to replace. That is a complete answer to motivation 2: the consumer never has to set the code itself.

> **The `errorReported` polarity is inverted from its name.** Setting it to **`false`** *suppresses* the runtime log ("already reported"); omitted or non-boolean is treated as `true` and the failure is logged. A reader who assumes `errorReported: true` means "I reported it, stay quiet" gets exactly the double-report this package exists to prevent. Worth a comment at the call site, not just here.

**2. `CliLogger` honours `References.LogToStderr`, but only in one direction.** When set, everything goes to stderr; when unset, level decides the stream. It is a force-all override, never a per-level one — a consumer who sets it meant "this whole program's output is diagnostic", and letting it move `Info` *back* to stdout would give two mechanisms for one decision.

**3. The `Command` handler-accessor gap is filed upstream, not shimmed.** Shimming an unstable internal buys a testing convenience and owes maintenance against a moving target, and this package's whole claim is that it owns the *boundary* rather than patching the framework.

## Open questions

**Colour.** `Stdio.stdoutIsTerminal` exists, so a TTY-aware palette is expressible — but colour in a logger and colour in rendered output are different problems and only the second is clearly in scope. Deferred until a consumer asks, per the kit's habit of not building the second thing.

## Errors

**No new error classes.** Everything here is presentation: it renders errors other packages raise and must not wrap them. A renderer that fails has a defect, not a domain error — a `SchemaIssue` tree that cannot be rendered is a bug in the renderer.

## Observability

**No spans.** Rendering a string and writing a line are not operations an operator traces, and a span around a logger write would appear in every log line's own trace. The package stays telemetry-agnostic, like every library in the kit.

## Testing

The `Console` reference makes the whole surface testable without stubbing globals: provide a capturing `Console`, run the program, assert on what was written **and on which stream**. The stderr/stdout split is the property most worth pinning, because it is the one that silently regresses and the one `mytool run > log.txt` depends on.

The discriminating mutant for `CliLogger`: route everything to stdout. A suite that still passes is asserting on content and not on stream, which is half a test.

**Drive levels with `References.MinimumLogLevel`**, provided as a service. `Logger.withMinimumLogLevel` **does not exist on the v4 line** and is the obvious first reach — verified absent from `Logger.ts` rather than assumed.

## Non-goals

- **Not a CLI framework.** No argument parsing, no flags, no command tree, no help rendering. `effect/unstable/cli` owns all of it. If a change here starts to look like parsing, it belongs upstream or nowhere.
- **No platform package**, required or optional. The moment `@effect/platform-node` appears here, the package has stopped being usable from Bun and Deno for no benefit.
- **No prompts, spinners or progress bars.** Interactive terminal UI is a genuinely separate concern with a genuinely separate dependency profile; `Prompt` already exists in core's CLI namespace.
- **Nothing may depend on this but an application.**

## Build

Standard package setup per [package-setup.md](../package-setup.md). Expected to need no API Extractor suppression: no class factories, so no synthesized `_base` symbol. Gate on a cold `pnpm build --filter @effected/cli`, never the raw script.
