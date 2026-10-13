---
type: Decision
title: Provenance lives in the engine state, and is never hardcoded
description: The release index carries a live/cache source marker set by whichever strategy actually populated it, so a stale snapshot is never reported as fresh.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7fcbe154fcac79c8
---

# Provenance lives in the engine state, and is never hardcoded

## Context

`@effected/runtimes`' auto strategy can serve either a live fetch or a
bundled offline snapshot, depending on whether the fetch succeeded. A
consumer reading a resolved version needs to know honestly which one it
got, because a snapshot silently reported as live data is a correctness
problem the consumer cannot detect on their own.

## Decision

The release index holds a `Ref` of releases plus a source marker;
whichever strategy populates the index sets that marker at load time —
live for a fetch, cache for the bundled snapshot, including on the auto
strategy's fallback path. Resolvers read the marker, and the auto
strategy additionally logs a warning on fallback, so serving a stale
snapshot is never silent.

## Alternatives rejected

**A hardcoded or constant provenance field.** Rejected explicitly: an
advertised provenance field hardcoded to `"live"` makes a stale answer
indistinguishable from a fresh one, which defeats the entire purpose of
exposing provenance to a consumer in the first place.

## Consequences

Do not let the source marker become a constant under any refactor —
whichever code path populates the index is responsible for setting it
accurately, and a resolver that ever ships a hand-rolled fetcher bypassing
the shared engine state must still set the marker itself.
