---
type: Decision
title: app is a composition layer, not an umbrella package
description: app defines no service, schema or error of its own and re-exports nothing from xdg, store or config-file -- a consumer wanting one of them alone takes that package alone.
status: stable
tags:
  - architecture
sources:
  - id: app-claude-md
    resource: ../../packages/app/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 77d2edc458574fd24e9838ba72e3dd1cab516c29efa8202cc5bda74dd27ae5e0
verified:
  - by: human:spencer
    at: 2026-10-09T16:29:07Z
---

# app is a composition layer, not an umbrella package

## Context

`@effected/app` wires together three independently useful packages —
[xdg](../modules/xdg.md), [store](../modules/store.md) and
[config-file](../modules/config-file.md) — into one application control
plane. A package sitting on top of three others is an obvious candidate
to become a convenience umbrella that re-exports everything beneath it,
the way some ecosystems ship a "kitchen sink" package for exactly this
reason.

## Decision

`@effected/app` owns **no domain logic**. It defines no `Context.Service`,
no schema and no error class of its own, and it **re-exports nothing**
from the three packages it composes — the same rule as
[no barrel re-exports](../conventions/no-barrel-re-exports.md), applied
one level up from a single package's `index.ts` to a whole composition
layer. Its entire public surface is layer factories (`App.layer`,
`AppStore.layer`, `AppCache.layer`), one config preset
(`AppConfig.layer`) and one type alias (`AppError`). A consumer who wants
config files alone takes `config-file` alone; nothing about depending on
`app` is required to reach any of the three packages beneath it
individually.

If a future change to this package wants a `Context.Service`, that want
is itself the signal that the change belongs in `xdg`, `store` or
`config-file` instead, not in `app`.

The corollary decision, [nothing may depend on
app](#alternatives-rejected), holds independently: a library taking an
application control plane as a dependency would drag [store's
integrated tier](store-v4-sqlite.md) into that library's own consumers,
the exact tier-3 leak the dependency policy's R2 exists to prevent. This
package sits at the top of the dependency graph by design, never in the
middle of one.

## Alternatives rejected

- **Re-export the three packages' public surfaces from `app`'s
  `index.ts`.** Rejected: it would mean a consumer depending on `app`
  purely for its composition (namespaced directories plus a database)
  also imports the full config-file surface transitively, defeating the
  purpose of the split those three packages already represent.
- **Let another library depend on `app`.** Rejected as a standing rule
  rather than case-by-case: any such dependency would make that
  library's own consumers integrated tier through `app`'s inherited
  tier-3 status, without that library ever choosing to take on a SQLite
  dependency itself.

## Consequences

A pull request adding a re-export to `app`'s entrypoint, or adding a
service/schema/error class to any of its four modules, should be
reviewed as a decision to relocate that capability into `xdg`, `store` or
`config-file` — not accepted as an `app`-owned feature.
