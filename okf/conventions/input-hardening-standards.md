---
type: Convention
title: Input-hardening standards
description: Untrusted input and recursive walks fail through the typed error channel, never as a stack-overflow defect; nesting depth and reference-expansion are both capped and bounded.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - security
  - architecture
sources:
  - id: jsonc-limits
    resource: ../../packages/jsonc/src/internal/limits.ts
  - id: yaml-yaml
    resource: ../../packages/yaml/src/Yaml.ts
  - id: yaml-stringifier
    resource: ../../packages/yaml/src/internal/stringifier.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: b28611ec4df704c0
---

# Input-hardening standards

Parsers and any recursive walk over untrusted input must fail through
the typed `E` channel, never as a `Cause.Die` defect. Deeply-nested
hostile input that overflows the call stack is a denial-of-service
vector, and `RangeError: Maximum call stack size exceeded` is an
unhandled defect that violates the invariant "malformed input fails
typed" — this is the Failure-vs-Defect boundary of the
[error handling standards](error-standards.md) applied specifically to
input.

Cap collection-nesting depth at a shared `MAX_NESTING_DEPTH = 256` — the
cross-package parity constant, proven in `@effected/yaml` and
`@effected/jsonc`[^jsonc-limits] — and surface the overflow as that
surface's typed failure mode: a domain parse-error code
(`NestingDepthExceeded`),[^yaml-yaml] an in-band visitor error event, or
a bounded placeholder.

## Apply the guard at every independent recursive surface

Not just the main parse entry point — enumerate every recursive surface
during the port, because the topology differs per engine. `yaml` has a
two-stage CST-parser/composer shape, needing two caps, with the CST cap
set above the composer's so the composer's user-facing diagnostic fires
first. `jsonc` spreads recursion across five independent surfaces —
parser value mode, parser tree mode, the AST value-extractor, the
semantic-equality walker, the SAX visitor and the navigator — each
needing its own guard. Hold the cap in a shared zero-dependency leaf
(`internal/limits.ts`) so every surface imports one constant without
introducing an import cycle.[^jsonc-limits]

## Recursive surfaces on the output side count too, and depth is not the only DoS vector

Two failure modes in `@effected/yaml` make the point:

1. **`stringify` recursion.** Both the plain-value emitter and the
   AST-node emitter overflow the stack on deep acyclic input exactly like
   the parser does, so both are capped at `MAX_NESTING_DEPTH` and surface
   a typed `NestingDepthExceeded` — an internal depth-exceeded throw
   caught at the facade and materialized into the surface's typed
   error.[^yaml-stringifier]
2. **An alias/reference-expansion "billion laughs" bomb.** This stays
   under a per-node count guard even though nesting depth never grows,
   yet it can exhaust the heap during value materialization — an
   amplification vector orthogonal to nesting depth. It is bounded by a
   materialized-node budget derived from the count limit, and it fails
   typed (`AliasCountExceeded`) rather than dying as an out-of-memory
   defect.[^yaml-yaml]

When an engine expands references (aliases, includes, `$ref`) during
materialization, budget the materialization itself, not just the input's
static depth — a document that is shallow on paper can still be
exponential once references are followed.

[^jsonc-limits]: `packages/jsonc/src/internal/limits.ts:22` —
    `MAX_NESTING_DEPTH = 256`, imported by every recursive surface in
    `@effected/jsonc`.
[^yaml-yaml]: `packages/yaml/src/Yaml.ts` — `NestingDepthExceeded` and
    `AliasCountExceeded` diagnostic codes surfaced through
    `YamlParseError`.
[^yaml-stringifier]: `packages/yaml/src/internal/stringifier.ts` — the
    stringify-side `MAX_NESTING_DEPTH` guard and `StringifyDepthExceeded`
    internal throw, caught and re-surfaced as a typed error.
