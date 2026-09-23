---
type: Decision
title: "D: strict MCP input default for Claude Code"
description: McpToolkit.layer's DEFAULT_STRICT is "all" — every tool without its own Tool.Strict annotation is served and decoded strict — because probe P2 found Claude Code 2.1.281 never places its own protocol extras inside a tool call's arguments.
status: draft
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T22:22:55Z
  body_sha256: e966e2b28fed6e13bc4b45090448c5f6c7d3b99b6217d0e0333420498701c9cd
---

# D: strict MCP input default for Claude Code

## Context

[D2](mcp-strict-input-upstream-first.md) shipped `ToolInputSchema` and
deferred `McpToolkit`'s default strictness to phase 2, gated on a probe:
would a real agent client ever place its own protocol machinery — a
protocol version, client info, a progress token, a tool-use id — inside a
tool call's `arguments` object rather than the sibling `_meta` field? If
it could, defaulting every unannotated tool to strict input
(`onExcessProperty: "error"`) would reject legitimate calls from that
client, and `McpToolkit`'s default would have to stay lenient
(`"annotated"`) until a consumer opted a tool in by hand.

The suspicion that motivated the probe was a claim, unverified at design
time, that Silk's own tooling had observed Claude Code sending `_meta`-
style extras inside a tool's declared `arguments`. Probe P2's method: run
a probe MCP server that tees its raw stdin to a file, drive it with
`claude -p` twice (once with no protocol-negotiation override, once with
`MCP_PROTOCOL_NEGOTIATION=auto`), and read the captured `tools/call`
frames verbatim rather than trusting either the SDK's parsed shape or any
vendor documentation.

## Decision

**Outcome O1.** Both runs captured against Claude Code 2.1.281 show
`tools/call`'s `params` carrying exactly `name`, `arguments`, `_meta`, and
`arguments` carrying exactly the tool's own declared parameter keys — in
the captured frame, `["note"]` — in every call, in both runs. Every extra
Claude Code attaches to a call (`protocolVersion`, `clientInfo`,
`clientCapabilities`, its own `claudecode/toolUseId`, `progressToken`)
sits under the sibling `params._meta`, never inside `arguments`, whether
or not `MCP_PROTOCOL_NEGOTIATION` is set. Quoting the captured shape
(scratchpad evidence, not committed to the repo):

```text
CALL {"paramKeys":["name","arguments","_meta"],"argumentKeys":["note"],
"meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28", ...,
"claudecode/toolUseId":"toolu_...","progressToken":1}}
```

A second, load-bearing fact fell out of the same capture: **both runs
opened the session with `server/discover`** (protocol `2026-07-28`, the
stateless revision), not `initialize` — including the run with no
negotiation override set. `McpStdio.protocols` already lists the
stateless adapter first for exactly this reason; this probe is the first
direct confirmation against a real, current Claude Code build.

`McpToolkit.layer`'s `DEFAULT_STRICT` is `"all"`: every tool without its
own `Tool.Strict` annotation is served and decoded strict. An explicit
annotation, true or false, always wins over the default in either mode.

## Alternatives rejected

**`DEFAULT_STRICT = "annotated"`** (O2 — the outcome if extras had leaked
into `arguments`). Rejected on the evidence: nothing in either captured
run would have been rejected by an all-strict default, so leaving strict
input opt-in would only cost every consumer an extra annotation on every
tool for no safety this client needs.

**Deferring the default to a third option (O3), tied to protocol revision
rather than a flat default.** Not reached — the same `arguments` shape
held under both the stateless (`server/discover`) and, implicitly, the
stateful opening this probe did not observe Claude Code choosing. Nothing
in the captured evidence motivated splitting the default by revision, and
doing so without evidence would be speculative.

## Consequences

A consumer serving Claude Code needs no configuration to get complete,
path-qualified unknown-key rejection: `McpToolkit.layer(toolkit)` with no
options re-annotates and strictly decodes every tool by default. A
consumer whose tool genuinely needs to accept caller-supplied extra keys
inside `arguments` (not `_meta`) must annotate that tool
`Tool.Strict` false explicitly, or pass `{ strict: "annotated" }` to opt
every tool back to lenient-by-default. This Decision is scoped to the one
client version measured (Claude Code 2.1.281); a future client version or
a materially different client should be re-measured before this default
is treated as universal, which is why this Decision stays `draft` pending
human verification.
