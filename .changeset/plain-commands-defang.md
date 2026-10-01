---
"@effected/github-commands": minor
---

## Features

First release. `@effected/github-commands` is the GitHub Actions workflow-command grammar as pure functions: render a command with the runner's escaping, and neutralize text so the runner cannot read it as one. Strings in, strings out, with no service, no layer, no `effect` and no dependency at all.

- `WorkflowCommand` — `render(name, properties, message)` and the `debug`, `notice`, `warning`, `error`, `group`, `endGroup` and `addMask` helpers. Annotation properties use readable names (`startLine`, `startColumn`) and go out as the wire's (`line`, `col`). Message and property escaping follow the runner's protocol, with `%` escaped first so nothing is escaped twice. This is the module `@effected/github-actions` shipped; it moved here, and `@effected/github-actions` re-exports it.
- `CommandNeutralizer` — `lines(text)` and `text(text)` defang text you did not mean as a command, such as an error message or a file name. It models both runner parsers: `::` after leading whitespace, and the legacy parser's `##[` anywhere in a line. A bare `##` is left alone, so a markdown heading is unharmed. It splits lines at CR, LF and CRLF as the runner does, and it is idempotent.

```ts
import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";

WorkflowCommand.error("build failed", { file: "src/main.ts", startLine: 12 });
// "::error file=src/main.ts,line=12::build failed"

CommandNeutralizer.text("prefix ##[add-mask]secret\n::error::x");
// a zero-width space inside the ##[ and before the ::, so neither parser reads a command
```
