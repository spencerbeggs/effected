---
status: archived
module: effected
category: feedback
created: 2026-07-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 100
related:
  - README.md
  - ../github-action-canon.md
  - ../packages/github.md
  - ../packages/github-actions.md
---

# Fluency audit (archived)

## Overview

**This document is archived. It records a completed acceptance gate, and nothing in it is current guidance.**

The audit took five known-bad call sites from the consumer repositories and rewrote them against the then-newly-shipped kit, scoring each against one bar — *shorter, clearer and cast-free*. All five passed. Its explicit limit was that no consumer had actually been migrated: every "after" was written against verified signatures rather than compiled inside a consumer.

That limit no longer applies, which is what retires the document. Every consumer in the [register](README.md) now runs on the kit, and each of the five rewrites exists as shipped consumer source rather than as a proposal.

## Where its findings live now

The audit's conclusions were absorbed into the owning packages' design docs, in current tense and in more depth:

| Case | Now recorded in |
| --- | --- |
| Octokit typing — the route-keyed REST surface replacing consumer cast interfaces | [github.md](../packages/github.md) |
| Branch upsert — one call and an `alreadyExists` discriminant in place of a TOCTOU dance | [github.md](../packages/github.md) |
| Layer wiring — `Action.run`'s layer option is not self-contained | [github-actions.md](../packages/github-actions.md), where the case is discharged in full |
| Error construction — `GitHubError`'s statics and partial test layers | [github.md](../packages/github.md) |
| Env-scoped effects — fiber-local `withEnv`, which never mutates `process.env` | [github-actions.md](../packages/github-actions.md) |
| Sync primitives paying off across a package boundary | [formatter-convention.md](../formatter-convention.md) |

For what these applications prove a **new** action should look like, [github-action-canon.md](../github-action-canon.md) supersedes this document outright: it was derived construct by construct from three actions' shipped source, which is stronger evidence than rewrites that had never been compiled.

Only the register's archive note links here. The file is kept as the record that the gate ran and what bar it was scored against — not because anything depends on it.
