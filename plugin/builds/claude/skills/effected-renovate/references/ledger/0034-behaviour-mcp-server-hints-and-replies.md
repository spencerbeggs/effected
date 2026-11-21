---
id: "0034"
title: "effect/ai: McpServer advertises destructiveHint false for read-only tools, uses toModelOutput as the result content, and answers malformed stdio frames with -32700"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.5"
detect: ["Tool\\.Readonly", "destructiveHint", "toModelOutput", "-32700", "registerToolkit", "McpServer\\.toolkit"]
---

Several McpServer outputs changed shape on the wire.

- **A tool annotated `Tool.Readonly` with no `Tool.Destructive` now lists `destructiveHint: false`**; it used to list `true`, the annotation's own default (Effect-TS/effect#10752). An explicit `Tool.Destructive` still wins. Update any test or fixture that asserts the `tools/list` annotations, and drop an explicit `Tool.Destructive` false that existed only to correct the hint.
- **A tool with `toModelOutput` returns those parts as the result `content`**, keeping `structuredContent` and downgrading unsupported blocks on older protocol revisions (Effect-TS/effect#10740). A client or test that read the JSON-encoded output from `content` now sees the model-output parts.
- **`McpServer.toolkit` and `McpServer.registerToolkit` take an optional options argument** that lets selected tools return native MCP content blocks without advertising an output schema (Effect-TS/effect#10733). It is additive.
- **The stdio server replies to a malformed NDJSON line with a JSON-RPC `-32700` parse error and keeps serving** (Effect-TS/effect#10579). It used to drop the line silently. Where a hit is a stdin guard that answers unparseable lines itself, check that the line cannot reach core too, or the client gets two replies; a JSON value that is no JSON-RPC message is still dropped by core without a reply.

Check these against the installed `McpServer` and `Tool` `.d.ts`; the hint default and the stdio reply were read from the source diff, not probed end to end. Verify with the MCP server tests.
