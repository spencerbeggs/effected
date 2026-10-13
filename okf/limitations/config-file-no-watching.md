---
type: Limitation
title: config-file has no file-watching capability
description: The package offers no way to be notified when a loaded config file changes on disk.
status: stable
bounds: ../modules/config-file.md
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5dd67157593d7ef3
---

# config-file has no file-watching capability

## Condition

A consumer wants to be notified when a config file `config-file` has loaded changes on disk — a long-running process wanting to hot-reload configuration, for example.

## Symptom

There is no watch API on `ConfigFile.Service`, `ConfigFile.layer`, or anywhere else in the package. A consumer must poll or build their own filesystem-watching layer entirely outside `config-file` and re-invoke the loader themselves.

## Why this is acceptable

Watching is not a small addition on top of the existing load pipeline — it needs its own design, and bolting it onto this one would produce a worse version of both:

- **Change detection needs its own semantics.** A byte-level or timestamp comparison is the wrong primitive; it should be `Equal`- or schema-derived equivalence, so a file rewritten with the same effective content does not fire a spurious change event.
- **Corruption and deletion are different signals.** A config file that becomes corrupt must be distinguishable from one that was deleted — a typed error versus an absence — and the current pipeline's discovery-aborts-on-corruption behavior is not automatically the right answer for a live watch.
- **Cancellation should be an Effect concept.** Fiber interruption is the natural way to stop watching, replacing an un-Effect-ish abort-signal API a naive port would otherwise introduce.
- **Both watch strategies matter.** A real implementation should offer core's filesystem watch alongside polling, since not every platform or filesystem supports the former reliably.

## What the fix would take

A separate concept — most plausibly its own module or even its own package — designed against these four requirements from the start, likely composing with `ConfigFile.layer`'s existing resolver/strategy seams rather than replacing them. It has not been designed because no named consumer has asked for it yet.
