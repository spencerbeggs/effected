---
type: Decision
title: The release index is Ref-backed with a single atomic load
description: An index inconsistency between the release set and its lookup map is treated as a programmer error and stays a defect, never a typed failure.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: bb6ceb5588205d48
---

# The release index is Ref-backed with a single atomic load

## Context

`@effected/runtimes`' release index is populated once (by a live fetch or
the bundled snapshot) and then read concurrently by every resolve call
against that resolver's layer. The population and the lookup structures
built from it must not be observed in an inconsistent state by a
concurrent reader.

## Decision

The release index is `Ref`-backed, and its load is a single atomic `set`
of the whole populated state — never a sequence of separate writes a
concurrent reader could observe half-completed. An index inconsistency —
a version present in the index but absent from its lookup map — is
treated as a programmer error and stays a defect rather than a typed
failure a caller is expected to handle, because no legitimate input can
produce that state; only a bug in the population code can.

## Alternatives rejected

**A typed error for lookup-map inconsistency.** Rejected because there is
no scenario in which correctly-written population code produces this
state from valid input — modeling it as a recoverable failure would ask
every caller to handle a case that can only mean the library itself is
broken, which the [error-channel audit](../modules/sbom.md#assembly-is-total-only-io-can-fail)
applied elsewhere in the kit argues against.

## Consequences

A future change to the population pipeline that writes the release set
and its lookup map as two separate `Ref` updates would reintroduce a
window where a concurrent reader can observe one without the other;
population must stay a single atomic `set` of the fully-built state.
