# @effected/github-commands

The GitHub Actions workflow-command grammar as pure functions: `WorkflowCommand` renders a command with the runner's escaping, and `CommandNeutralizer` makes arbitrary text safe to write to a log. Extracted from `@effected/github-actions` so a boundary-tier package can neutralize without the integrated tier.

**Tier: pure.** No `effect` (it is not even a peer), no `node:` import, no service, no regular dependency, no `@effected/*` edge, `"sideEffects": false`. Never add one: any package at any tier depends on this one, and that only works while it asks for nothing. Its consumers take it as a REGULAR dependency, never a peer: it has no shared-instance contract (static functions, no tag, no `instanceof`), so two copies in a tree are harmless.

**Design doc:** `@./okf/modules/github-commands.md` — Load when: changing either module, or ruling on what the runner reads as a command. The reason it exists is `@./okf/decisions/github-commands-extracted-from-actions.md`.

## The two modules

- **`WorkflowCommand`** (`src/WorkflowCommand.ts`) — `render(name, properties, message)` and the `debug`, `notice`, `warning`, `error`, `group`, `endGroup` and `addMask` helpers, with `AnnotationProperties` mapping readable names (`startLine`) onto the wire's (`line`). The shape is public and frozen: `@effected/github-actions` re-exports it.
- **`CommandNeutralizer`** (`src/CommandNeutralizer.ts`) — `lines(text)` and `text(text)`. The text it is given is not a command; it is DATA that must not become one.

## Rules that are load-bearing

- **The runner has TWO command parsers and a line is a command if either accepts it** (`actions/runner`, `ActionCommand.cs`). V2: `TrimStart()` with .NET whitespace (U+0085 included), then `StartsWith("::")`. Legacy: `IndexOf("##[")`, ANYWHERE in the line. Both compare culture-sensitively under ICU, which skips controls, format characters (U+200B, U+FEFF), most combining marks and other default-ignorables, so `"\u200b::x"` and `":\u200b:x"` ARE commands; a zero-width marker defends nothing. The neutralizer matches with those skipped and puts U+2800 BRAILLE PATTERN BLANK before a V2 line and before the `[` of every `##[`: not .NET whitespace, weighed by ICU, not default-ignorable (Ink 8 drops those from a frame), one blank cell. The skipped set was measured on .NET 8 (`__test__/helpers/runnerCommands.ts` holds it as `ICU_IGNORED`). Neutralizing only a start-of-line `##` was the first version's bug, and its tests shared it. **A bare `##` is not a command: leave it alone** (a markdown heading).
- **Idempotent.** A neutralized line matches neither rule, so applying it again changes nothing; `Render.githubLog` in `@effected/cli` relies on that.
- **Split at CR, LF and CRLF**, as the runner does. A lone CR starts a line.
- **There is no exported detector, deliberately.** A detector beside the neutralizer is the implementation's own opinion of a command, and a test using it pins the output as its own oracle. The oracle is `__test__/helpers/runnerCommands.ts`, written independently from the runner's rules and importing nothing from `src/`. Keep it that way.
- **Escaping order in `render`:** the percent sign first, then CR and LF, and for a property value also `:` and `,`. Reversing it re-escapes the `%` of an escape it just wrote.
- **The marker is written by code point** (`String.fromCodePoint(0x2800)`), never as a literal character in the source.

```bash
pnpm vitest run --project @effected/github-commands
pnpm build --filter @effected/github-commands   # never the raw savvy.build.ts
```
