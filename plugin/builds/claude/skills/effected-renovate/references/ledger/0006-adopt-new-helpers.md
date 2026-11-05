---
id: "0006"
title: "New helpers replace common local code: CliExit.report, McpToolkit.provideLifetime, EditDistance, AtomicFile.write"
kind: adopt
shows: none
applies:
  "@effected/cli-kit": ">=0.27.0"
  "@effected/mcp-kit": ">=0.14.0"
  "@effected/source": ">=0.4.0"
  "@effected/store": ">=0.24.0"
---

Offer these to the user; never apply them unasked. Each replaces a shape that consumers wrote by hand.

- **`CliExit.report` and `CliExit.reportCause`** (`@effected/cli-kit`). A local wrapper that writes an exit line to stderr and sets the exit code can use them. They do not stop the program, and `reportCause` writes nothing for an interrupt-only cause.
- **`McpToolkit.provideLifetime`** (`@effected/mcp-kit`). A hand-rolled middleware that keeps a service alive for a tool server's lifetime can use it.
- **`EditDistance`** (`@effected/source`). A local Levenshtein for "did you mean" suggestions can use it.
- **`AtomicFile.write`** (`@effected/files`, added through the same dependency as the moved `AtomicDirectory`). A temp-file-then-rename write can use it.

Read the installed `.d.ts` for each signature before proposing a change.
