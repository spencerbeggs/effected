---
type: Decision
title: The NTIA minimum-elements report is a report, not a gate
description: NtiaReport is a pure function returning a compliance report; the caller decides whether non-compliance fails a run.
status: stable
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 6ec4277386a1c7b4
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 87f5a906ec860cf7
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# The NTIA minimum-elements report is a report, not a gate

## Context

The NTIA (National Telecommunications and Information Administration)
publishes seven minimum elements an SBOM should carry. `@effected/sbom`
needs to tell a caller whether a generated document satisfies them
(`packages/sbom/src/NtiaReport.ts`), and the shape of that answer —
report versus enforcement — determines what a consumer can build on top
of it.

## Decision

`NtiaReport` is modelled as a pure total function returning a report, not
as something that can fail. Compliance is a question, not an error:
`compliant` is a derived getter on the report, and a caller wanting a hard
gate implements that policy at its own boundary by inspecting the report
and failing there. A caller may legitimately emit a non-compliant SBOM and
only warn.

Each of the seven elements carries a stable literal id, never a display
string. An earlier version carried prose like `"Supplier Name"` and a
consumer matched on that string directly, which is rendering — a
presentation concern — coupled into the compliance model. There are no
suggestion strings on a missing element, because a predecessor's suggested
remediation text named one consumer's own configuration file, which is
precisely the coupling this package exists to remove; a consumer maps its
own missing-element set to its own remediation text.

The dependency-relationship element asks for a **declared subject** — a
root component, with the component count as its value — rather than for
the mere presence of a component list, because a list of components with
nothing saying what they are components *of* relates nothing to anything.
An empty component list still passes that element, since "this package
has no dependencies" is an assertion rather than a gap. The timestamp
element additionally requires the value to parse as a date, since a field
holding an unparseable string records nothing.

## Alternatives rejected

**`NtiaReport` as an `Effect` that fails on non-compliance.** Rejected
because compliance is a question a caller answers, not a condition the
library should have an opinion about; typing it as a failure channel
would force every caller — including ones that only want to warn — to
handle a case that is not actually exceptional. This mirrors the same
audit this package applied elsewhere: [assembly is
total](../modules/sbom.md#assembly-is-total-only-io-can-fail); a channel
that exists only to encode a policy choice the caller should make is
worse than no channel.

**Display strings as element identifiers.** Rejected because a display
string is a rendering decision that belongs at the edge, and coupling a
consumer's matching logic to prose makes any wording change a breaking
change for every consumer that switches on it.

## Consequences

A consumer that wants to treat non-compliance as a release-blocking
failure writes that check itself, against the report's `compliant`
getter or against the per-element ids; a consumer that only wants to
surface a warning reads the same report with no extra ceremony. Neither
posture requires a change to this package. The absence of suggestion
strings means every consumer owns its own remediation copy, which is the
trade this decision makes deliberately: no consumer's phrasing or
configuration file leaks into a shared library again.
