---
"@effected/mcp": minor
---

## Features

### Stopping and draining the test harness

- `McpHarness.stop` interrupts the server; pending waits fail with `ServerStopped`.
- `McpHarness.close` ends stdin, and the stdio server now answers requests still in flight before it stops, so their responses still arrive. A request that never completes keeps the server running after `close`; use `stop` for it.
- The harness routes every line a stopping server wrote before it signals `ServerStopped`, so a final response is no longer lost.

### Stderr waits

- `McpProcess.stderrUntil(predicate, { timeout })` waits until the stderr written so far satisfies `predicate`, checking on every chunk, and fails with `StreamEnded` or `TimedOut` instead of hanging. Its options type is `McpProcessStderrUntilOptions`.
- `McpTestFailure` gains the `"TimedOut"` reason, which widens its reason union. Exhaustive matches on the reason need a new case.

### Crash-injection parsing

- `McpGuard.parseInjectCrash(value)` parses the `<at>:<kind>` crash-injection grammar for `injectCrash`. It is the same function as `ProcessGuard.parseInjectCrash`, so an MCP launcher need not import `@effected/engine/guard` for it.

## Refactoring

- `McpGuard.run` now runs over `ProcessGuard` from `@effected/engine/guard`. Its public API is unchanged, but `@effected/mcp` now imports `@effected/engine/guard` at runtime, so it needs a release of `@effected/engine` that ships that subpath.

## Documentation

- The `ToolRefusal` TSDoc states that structured data attached to a refusal is deliberately unreachable by the client.
- The `injectCrash` TSDoc states that the `"connected"` report is asynchronous.
- The `McpStdio.layer` TSDoc warns that `Logger.consoleJson`, `consoleLogFmt` and `consoleStructured` write to stdout whatever `LogToStderr` says, so a stdio server must not install them; wrap a format in `Logger.withConsoleError` instead.
