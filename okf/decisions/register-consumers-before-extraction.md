---
type: Decision
title: "D4: okfit and vitest-agent are registered as consumers before extraction"
description: Consumer concepts are written and linked before any engine/cli/mcp primitive is extracted from their repos, so every extraction is justified against a recorded survey rather than memory.
status: draft
tags: [architecture, docs]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 84635f8e7ed9548281b311f8cdfd1825a79401f79545185ede9bbe27237f3848
---

# D4: okfit and vitest-agent are registered as consumers before extraction

## Context

This design's own evidence — two research passes over okfit's and
vitest-agent's source — is what identified every primitive candidate in
`@effected/engine`, `@effected/cli`'s growth, and the phase-2
`@effected/mcp`. Writing the Module and Decision concepts that extract
those primitives without first recording what was actually surveyed would
leave the justification for each extraction living only in a scratchpad
research file nobody re-reads, and future package additions would have no
recorded precedent for "what does this consumer actually exercise, and
what does it deliberately keep for itself."

## Decision

`okf/consumers/okfit.md` and `okf/consumers/vitest-agent.md` are written
and linked from the new Module concepts (`engine.md`, `mcp.md`, and the
updated `cli.md`) as the first step of this branch, before any of the ten
Decisions or the Module bodies that depend on them. Each Consumer names
the repository, the kit surfaces it already exercises with links to the
Modules and Interfaces involved, what it deliberately keeps for itself,
and the open questions it holds the kit to — the exact register shape
`okf/consumers/reposets.md` and `okf/consumers/systems.md` already use.

## Alternatives rejected

**Justifying the extractions without registering the consumers.** Rejected
— a Module or Decision concept that says "three consumers hand-roll this"
without a Consumer concept a reader can open makes the claim
unfalsifiable: nobody reading `engine.md` six months from now can check
which repo actually exercises `Distribution` without re-running the
research pass this branch already did once. Registering the consumers
first means every later Decision can link a concrete, dated survey
instead of restating evidence inline.

## Consequences

Every Decision and Module concept in this branch that cites okfit or
vitest-agent behaviour links to `consumers/okfit.md` or
`consumers/vitest-agent.md` rather than repeating the file:line evidence
inline — `okf-authoring` rule 19 already rules out embedding that kind of
historical delta directly in a Decision's body. `systems.md`, already
registered, gains the MCP and CLI surfaces this design's evidence found
there as a follow-up edit outside this task's scope. Adoption itself stays
out of scope for this branch: the Consumer concepts are read-only surveys,
never a work plan, per the type's own guidance.
