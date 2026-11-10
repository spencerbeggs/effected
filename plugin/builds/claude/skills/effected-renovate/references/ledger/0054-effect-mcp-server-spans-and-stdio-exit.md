---
id: "0054"
title: "McpServer spans follow the OpenTelemetry MCP conventions, Toolkit.handle stops recording tool arguments, and a stdio server exits 0 at stdin EOF"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.3"
detect: ["McpServer\\.(layerStdio|layerHttp|layer)", "Toolkit\\.handle", "layerProtocolStdio", "McpProtocol\\.", "(,[[:space:]]*|toBe\\(|toEqual\\()130\\)"]
---

This applies to an MCP server or client built on `effect/ai`, and to any RPC stdio server.

- **Span names and attributes changed** (Effect-TS/effect#10304). `McpServer` request spans are now named `{method} {target}`, for example `tools/call get_weather`. They carry `mcp.*`, `jsonrpc.request.id` and `gen_ai.*` attributes instead of the generic `rpc.*` ones. A tool result with `isError: true` sets `error.type` to `tool_error`. Update dashboards, alerts and tests that match span names or `rpc.*` attributes.
- **`Toolkit.handle` no longer records tool arguments on the current span.** It records `gen_ai.tool.name` and `gen_ai.tool.call.id` instead of `tool` and `parameters`. To record arguments again, provide `Toolkit.RecordToolArguments` as `true`; they land in `gen_ai.tool.call.arguments`.
- **A stdio server now exits 0 after stdin closes and its pending responses drain**, not 130 (Effect-TS/effect#10475), even under `Runtime.defaultTeardown`. Core marks that interrupt with `Runtime.InterruptExitCode` 0. A signal still exits 130 under the default teardown. Probed in this kit: an EOF test asserting 130 under the default teardown passed on 4.1.2 and gets 0 on 4.1.3. Update any test that pins 130 at EOF. A teardown that maps every interrupt to 0, such as `McpStdio.teardown` from `@effected/mcp-kit`, still matters for SIGINT and SIGTERM.
- **The Skills extension is served only on protocol 2026-07-28** (Effect-TS/effect#10342). A client that asks for `extensions: { skills: true }` on an earlier protocol now fails with `UnsupportedError`; select `McpProtocol.v2026_07_28` or read known skill files with `readResource`.
- `resources/read` now carries a registered resource's `mimeType` when the handler returns a string or bytes, and a cursor on a core list that never issues one is answered `InvalidParams`. A test that pinned the old answers must change.

The `130` search finds every assertion on that exit code; keep only the ones that pin a stdio server's exit at stdin EOF. Check the installed `effect/ai` `.d.ts` for `RecordToolArguments`. Verify by running your MCP harness tests and one spawned-process EOF test.
