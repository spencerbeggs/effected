---
"@effected/mcp": minor
---

## Features

- `McpToolkit.unionTool` and `McpToolkit.unionHandler` register a tool whose
  `parameters` is a `Schema.Union` of objects — something `Tool.make` cannot
  take, since core dies at registration on a non-object `parameters` root.
  The tool is served as a `Tool.dynamic` with Effect's strict JSON Schema
  document for the union, rewritten to an object root, and gets the same
  treatment as a strict `Tool.make` tool: every unknown key named in one
  `InvalidParams`, then a strict decode, both before the handler runs.

  ```ts
  import { McpToolkit, ToolOutputSchema, ToolRefusal } from "@effected/mcp";
  import { Schema, Tool } from "effect";

  const Note = McpToolkit.unionTool("note", {
    parameters: Schema.Union([AddNote, ListNotes]),
    success: ToolOutputSchema.objectRooted(Schema.Union([Added, Listed])),
    failure: ToolRefusal,
  }).annotate(Tool.Title, "Note");

  const handlers = Kit.toLayer({
    note: McpToolkit.unionHandler(Note, (params) => handleNote(params)),
  });
  ```

- `ToolOutputSchema.objectRooted` adds `type: "object"` beside a union's
  `anyOf` at a schema's JSON Schema root, so a tool's `outputSchema` is one
  every client accepts — MCP requires an object-rooted `outputSchema`, and a
  bare `Schema.Union` at the top emits a bare `anyOf` that the stateful
  revisions drop from `tools/list` and the stateless one serves to a client
  that rejects it.

- `ToolRefusal` is a ready-made declared failure for a tool call refused for
  a reason the caller can fix. Declare it in a tool's `failure` schema and
  fail with `ToolRefusal.refuse`, whose message already folds in the
  remediation:

  ```ts
  return yield* ToolRefusal.refuse(`No run "${ToolFailure.truncate(id)}".`, {
    hint: "List runs first.",
    suggestedTool: "list_runs",
  });
  ```

- A new `@effected/mcp/guard` entrypoint carries `McpGuard.run`: crash guards
  for an MCP server process, installed before the server's module graph
  loads. It registers `uncaughtException` and `unhandledRejection`
  listeners, then loads and launches the server, reporting every stray crash
  on stderr instead of leaving it to escape onto stdout, the JSON-RPC wire.
  A policy chooses whether an uncaught exception or rejection exits the
  process immediately (`"exit"`) or only before the server starts serving
  (`"exitBeforeConnect"`, so a server that dies mid-session does not
  deregister its tools from the client). The entrypoint has no static
  runtime import — only `McpGuardHost`, the slice of `process` it needs, is
  imported as a type — so a throw while `effect` or the server graph itself
  evaluates is still reported. `injectCrash` drives either half of the
  policy end to end from a test, through `McpGuardHost.emit`.

- `McpStdio.launch` takes a new `onReady` option, run once the whole layer
  has built and before the launch waits forever — the signal `McpGuard.run`
  uses to know when a server is "connected".

- `McpHarness.initializeWith(protocolVersion)` sends `initialize` asking for
  an arbitrary `protocolVersion` instead of the harness's own revision, and
  `sentSoFar` returns every frame written to the server's stdin so far, in
  order — both for testing protocol-version negotiation and traffic
  directly.

## Documentation

- Running two stdio servers in one process now documents the full isolation
  rule: wrap each server's **whole bundle** (its toolkit layers together
  with `McpStdio.layer`) in `Layer.fresh`. A `Layer.fresh` boundary placed
  only around `McpStdio.layer`, with the toolkit outside it, builds a second,
  empty tool registry, so that server serves no tools.
