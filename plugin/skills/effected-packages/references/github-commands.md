# @effected/github-commands

Teaching skill: `actions-reporting`.

The GitHub Actions **workflow-command grammar** as pure functions: strings in, strings out. No service, no layer, no `R`, no `node:` import and no `effect` import at all — pure tier with zero dependencies and no peer, so any package at any tier may depend on it. Two modules, the same protocol seen from its two ends: `WorkflowCommand` writes a command the runner will execute, and `CommandNeutralizer` makes arbitrary text safe to write so the runner executes nothing.

`@effected/github-actions` re-exports `WorkflowCommand` at its own entrypoint, so an action keeps importing it from there. `@effected/cli` depends on this package so its renderers, `CliMessage`, the failure report and its loggers neutralize text under GitHub Actions.

## Import

```ts
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import type { AnnotationProperties } from "@effected/github-commands";
```

## Core API

- **`WorkflowCommand`** — `render(name, properties, message)` for any command (`::name key=value::message`) with the runner's escaping: `%`, CR and LF in a message, and `:` and `,` too in a property. Shorthands `debug`, `notice`, `warning`, `error` (the last three take `AnnotationProperties`: `title`, `file`, `startLine`, `endLine`, `startColumn`, `endColumn`, mapped onto GitHub's abbreviated wire names), `group`, `endGroup` and `addMask`. **The runner does not nest groups** — a second `::group::` implicitly ends the first — and `group` renders the command with no knowledge of what is open; for nesting-aware grouping use `@effected/github-actions`' `ActionLogger.group`. The constant **`groupDepthKey`** (`"@effected/github-commands/GroupDepth"`) is the key of the fiber-local that counts the groups open around the current fiber: this package holds the **key, never the reference** (it imports no `effect`), and each writer builds its own `Context.Reference<number>` from it with a default of `0` — Effect looks a reference up by its key, so every reference built from it reads and writes one slot. `ActionLogger.group` provides `depth + 1` around a group's body and writes the command only at `0`; `@effected/cli`'s `Render.context` reads it into `RenderContext.groupDepth`, so `Render.githubLog` renders a collapsible as a group only when none is open. A wrapper of your own joins the same way: read the depth, write the command only at `0`, provide `depth + 1` around the body.
- **`CommandNeutralizer`** — `lines(text)` splits at CR, LF and CRLF, as the runner splits a stream, and returns each line neutralized; `text(text)` joins them back. The runner reads a command through **two parsers**: one trims whitespace and looks for a leading `::`, the legacy one finds `##[` **anywhere** in the line. Both match culture-sensitively under ICU, which skips zero-width and other default-ignorable characters, so a zero-width space hides nothing. The neutralizer matches with those skipped and puts U+2800 BRAILLE PATTERN BLANK (one blank cell, kept by Ink) before such a `::` and inside every `##[`; a bare `##` (a markdown heading) is left alone. It is **idempotent**, so text neutralized twice is unchanged.

## Usage

```ts
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";

const annotation = WorkflowCommand.error("value must be a string", { file: "config.json", startLine: 3, title: "invalid" });

// Untrusted text (an error message, a file's contents) written to an Actions log:
const untrusted = "parse failed\n::add-mask::secret\nsee ##[group]";
const safe = CommandNeutralizer.text(untrusted);

console.log(annotation);
console.log(safe === CommandNeutralizer.text(safe)); // true: idempotent
```

## Gotchas

- **Neutralize every line of text you did not write yourself before it reaches an Actions log.** An error message or file content carrying a newline and `::add-mask::`, `::stop-commands::` or `##[group]` is otherwise read by the runner as a command — a command-injection vector, not a cosmetic glitch.
- **There is deliberately no `isCommand` detector.** Test neutralization against an oracle written independently from the runner's parsing rules, never against the implementation's own opinion.
