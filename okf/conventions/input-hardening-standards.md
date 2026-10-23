---
type: Convention
title: Input-hardening standards
description: Untrusted input and recursive walks fail through the typed error channel, never as a stack-overflow defect; nesting depth and reference-expansion are both capped and bounded, and JSON text is decoded through a module-level Schema decoder, never parsed and cast.
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
  - id: effect-schema-json
    resource: ../../.repos/effect/packages/effect/src/Schema.ts
  - id: github-actions-json
    resource: ../../packages/github-actions/src/internal/json.ts
  - id: commands-run
    resource: ../../packages/commands/src/Run.ts
generated:
  by: "okfit/claude-code"
  at: 2026-10-23T21:37:50Z
integrity:
  generated:
    body: 44be07ffc9d76c51
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

## JSON text is decoded through a Schema, never parsed and cast

Text that claims to be JSON is untrusted input like any other. Decode it
with `Schema.fromJsonString(S)`, which parses and checks the shape in one
step and fails typed on either. Never write `JSON.parse(text) as T`, and
never wrap `JSON.parse` in a hand-written try/catch that returns the
untyped result: both give the caller a value whose shape nothing checked.

- **Build the decoder once, at module level, in the package that reads the
  text.** For example, `const decodeJson =
  Schema.decodeUnknownResult(Schema.fromJsonString(S))` at the top of the
  module, then call it. `@effected/github-actions` holds the Effect-form
  instance of the same pattern, built with
  `decodeUnknownEffect`.[^github-actions-json] Use `decodeUnknownOption`
  when the caller only needs to know whether the text decoded, and
  `decodeUnknownResult` (or `decodeUnknownEffect`) when it reports why.
  There is no cross-package helper for this. Each package writes its own
  one-liner, so decoding JSON never adds an in-kit dependency edge.
- **Never use `Schema.UnknownFromJsonString`.** It is marked `@internal`
  in Effect. Spell the untyped case as
  `Schema.fromJsonString(Schema.Unknown)`, which is
  stable.[^effect-schema-json]
- **Decode in two steps only when the caller must tell "not JSON" apart
  from "wrong shape".** First `fromJsonString(Schema.Unknown)`, then the
  shape schema on the result. A one-step decode separates the two failures
  only by the issue's internal tag, and that is fragile to branch on. For
  `package.json` text, use `@effected/package-json`'s
  `PackageJsonFormat.parseObjectResult` (or its `Effect` form
  `parseObject`) to keep this split, rather than re-deriving it. `@effected/config-file` keeps its own one-line
  decoder instead, so it takes no package-json edge.
- **Keep `Result.try` or `Effect.try` around `JSON.parse` where the host
  `SyntaxError` is the evidence the typed error carries.**
  `Schema.fromJsonString` discards the thrown error: its parser reports a
  bare "a valid JSON string" issue with no cause. `@effected/commands`'
  `Run.jsonLine` keeps `Result.try` and `Run.json` keeps `Effect.try` for
  this reason, so the `SyntaxError` reaches the failure's
  `cause`.[^commands-run] Shape-check
  the parsed value with a Schema afterwards, as usual.

[^jsonc-limits]: `packages/jsonc/src/internal/limits.ts:22` —
    `MAX_NESTING_DEPTH = 256`, imported by every recursive surface in
    `@effected/jsonc`.
[^yaml-yaml]: `packages/yaml/src/Yaml.ts` — `NestingDepthExceeded` and
    `AliasCountExceeded` diagnostic codes surfaced through
    `YamlParseError`.
[^yaml-stringifier]: `packages/yaml/src/internal/stringifier.ts` — the
    stringify-side `MAX_NESTING_DEPTH` guard and `StringifyDepthExceeded`
    internal throw, caught and re-surfaced as a typed error.
[^effect-schema-json]: `.repos/effect/packages/effect/src/Schema.ts` —
    `fromJsonString` is `@stability stable`; `UnknownFromJsonString`,
    defined just below it, is `@internal`.
[^commands-run]: `packages/commands/src/Run.ts` — the `Effect.try` in
    `Run.json` and the `Result.try` in `Run.jsonLine`, each around
    `JSON.parse`, with a comment naming the dropped `SyntaxError`; `SchemaGetter.parseJson` in
    `.repos/effect/packages/effect/src/SchemaGetter.ts` is the parser that
    discards it.
[^github-actions-json]: `packages/github-actions/src/internal/json.ts` —
    one module-level `decodeJson` built from
    `Schema.fromJsonString(Schema.Unknown)`, shared by the package's
    untyped reads.
