---
id: "0009"
title: KeyValueStore implementations must provide keys
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["KeyValueStore\\.(make|makeStringOnly)\\("]
---

A store built with `KeyValueStore.make` or `makeStringOnly` must now provide `keys`. This comes from the Effect changelog and was not probed by the kit: confirm against the installed `effect/dist/persistence/KeyValueStore.d.ts`.

How it shows itself: the compiler rejects a store without it. `@effected/mcp`'s `ToolReplay` store is one such case.
