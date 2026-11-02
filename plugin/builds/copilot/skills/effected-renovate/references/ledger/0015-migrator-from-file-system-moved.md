---
id: "0015"
title: Migrator fromFileSystem moved to its own module
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["fromFileSystem"]
---

`fromFileSystem` moved from `effect/sql/Migrator` to `effect/sql/MigratorFileSystem`. Change the import. From the Effect changelog: check the installed `effect/dist/sql/MigratorFileSystem.d.ts`.

How it shows itself: the old import stops compiling.
