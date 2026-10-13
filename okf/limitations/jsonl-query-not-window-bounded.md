---
type: Limitation
title: A cursor-less jsonl query reads the whole file into memory
description: Unlike latest and last-valid-line reads, query and the replay half of a resumed subscription are not window-bounded; a cursor-less query over a large journal pays for the whole file.
status: stable
bounds: ../interfaces/jsonl-slice.md
tags:
  - architecture
  - performance
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: d7880b82e76fc9ca
---

# A cursor-less `jsonl` query reads the whole file into memory

## Condition and symptom

Calling `query` (or resuming `changes` from a cursor) reads its requested
region in one allocation, bounded by the file size rather than by any
window, and buffers matching envelopes before emitting — the stream it
returns is fed from a materialized batch rather than produced
incrementally. Its only bound is the cursor: a consumer resuming from a
persisted offset pays for the remainder, and a cursor-less query over a
large journal pays for the whole file. A consumer who assumes "no
operation ever holds the file in memory" — a reasonable inference from the
package's [token-economy motivation](../modules/jsonl.md#motivation-the-token-economy-as-an-api-contract) —
is wrong specifically for this surface.

## Why this is acceptable

The token-economy contract holds for the surfaces it was actually measured
against: current state (`latest`), the hook path, and any read carrying a
cursor. Only `latest` and the last-valid-line reads use the bounded tail
recipe described in the [read economy](../interfaces/jsonl-slice.md#the-read-economy);
a cursor-less historical read was never claimed to share that property, and
the package's own documentation states the cost plainly rather than
implying it away, so a consumer choosing to run an unsliced `query()` over
a large journal is making an informed trade rather than discovering a
surprise.

## What the fix would take

A paged historical read is the known fix and is not built: emit per window
rather than per call, carrying an unterminated tail across the window
boundary so a line straddling two windows is decoded exactly once. It is
tracked as a package issue rather than designed speculatively, and is
written down here so the gap is a decision rather than a rediscovery.
