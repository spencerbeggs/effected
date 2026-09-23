---
type: Decision
title: "D10: McpToolAudit enforces object-rooted outputs by default"
description: McpToolAudit.check's objectRootedOutput policy defaults to true, flagging a tool whose declared output can be a bare scalar or array, because the stateless 2026-07-28 adapter passes a non-object output through verbatim.
status: draft
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 4bf3e2e020c5f552f3e81d43438ffa8c7d02cb5ce009ede97f9cfab48c04a53e
---

# D10: `McpToolAudit` enforces object-rooted outputs by default

## Context

`McpStdio.protocols` serves the stateless `2026_07_28` adapter first, and
that adapter is verified to pass a non-object tool output through as-is,
unlike the later stateful revisions (`v2025_11_25.ts`), which object-root
`outputSchema`/`structuredContent` for a tool declared with a non-object
result. A tool authored against only the stateful revisions in mind — one
whose handler returns a bare string or array — behaves correctly there but
produces a wire shape under the stateless adapter that a strict client
(one that always expects an object at the tool-result root) cannot
consume predictably. `McpToolAudit.check` runs as a pure sweep over
`tools/list`, exactly the kind of static policy check that can catch this
class of tool before it ships, if it is told to look for it.

## Decision

`McpToolAudit.check`'s `objectRootedOutput` policy option defaults to
`true`: a tool whose declared output schema permits a non-object root is a
violation unless the caller explicitly opts out per-audit with
`objectRootedOutput: false`.

## Alternatives rejected

**Accepting any output root, with no default enforcement.** Rejected — a
protocol adapter's own transport-level behaviour (stateless passthrough
versus stateful object-rooting) is exactly the kind of divergence a tool
author cannot see by reading their own handler code; leaving the audit's
default permissive would mean the policy only catches this class of bug
for a consumer who already knew to turn it on, which defeats the purpose
of shipping the check as a default-on audit rather than an opt-in lint.

## Consequences

`okf/modules/mcp.md`'s `McpToolAudit.check` row documents
`objectRootedOutput? = true` as the default, matching this Decision.
A tool intentionally returning a bare scalar or array under the stateless
adapter — a legitimate but rare shape — must opt the audit out explicitly
per call, making the exception visible in the audit invocation itself
rather than silent. The check's own test suite (spec §7) includes
positive-control fixtures proving both the enforced-default and the
opted-out paths behave as this Decision states.
