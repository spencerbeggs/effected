---
id: "0012"
title: sql.insert and sql.updateValues require a non-empty array
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["sql\\.(insert|updateValues)\\("]
---

`sql.insert` and `sql.updateValues` require a non-empty array at the type level. Guard empty batches before the call (for example with `Array.isReadonlyArrayNonEmpty`) and skip the statement when there is nothing to write. From the Effect changelog, not probed by the kit: check the installed `effect/dist/sql/Statement.d.ts`.

How it shows itself: a call passing a plain array stops compiling.
