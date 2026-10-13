---
type: Limitation
title: jsonl terminal and quiescent semantics are journal-wide, not per-scope
description: A journal partitioned by scope cannot collapse independent per-scope loops into one file today, because terminal/quiescent state and current-state reads are both journal-wide, not sliced.
status: stable
bounds: ../modules/jsonl.md
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: f31adb581c56a323
---

# jsonl terminal and quiescent semantics are journal-wide, not per-scope

## Condition and symptom

`@effected/jsonl` shipped meeting three of its four original acceptance
criteria. The fourth — collapsing a dogfood file fan-out into one journal
partitioned by `scope` — failed on two counts. Terminal and quiescent state
is a property of the journal, not of a scope: the terminal check reads the
unsliced tail, so one scope reaching its terminal event freezes every other
scope's appends (an append after a terminal event fails typed unless the
event is declared `reopen`, and that check does not consider `scope` at
all). And `latest` has no sliced counterpart: per-scope current state is
either a projection fold or a take-last over history, at the `O(history)`
cost this package exists to let a consumer avoid. The symptom a consumer
hits: a set of independent per-scope loops sharing one journal cannot be
collapsed into that journal today, because the first scope to finish
silently blocks every other scope's writes.

## Why this is acceptable

The verified boundary this limitation identifies is precise:
[`Slice`](../interfaces/jsonl-slice.md) is load-bearing for subscription,
query and projection, and is **not** load-bearing for current-state or
lifecycle. That split was not designed speculatively; it was discovered by
building the per-scope collapse and finding exactly where it broke. Building
the fix before a real consumer needed the collapse would have meant
designing per-scope terminal semantics against a use case rather than
against a demonstrated requirement — and a single-journal collapse would
also lose per-loop file deletion, `.gitignore` granularity, and per-loop
mtime as a change signal, trade-offs worth weighing independently rather
than accepting as a side effect of a fix.

## What the fix would take

The future shape is known: `latest(slice)` as a per-scope
`SubscriptionRef`, so a consumer can watch one scope's current state at the
same `O(1)`-relative-to-history cost `latest` already gives the whole
journal; plus per-scope terminal semantics, so a terminal event in one
scope no longer freezes appends to every other scope sharing the file. This
work is deliberately deferred — it is consumer-gated, built when a real
consumer needs the collapse rather than designed ahead of that need.
