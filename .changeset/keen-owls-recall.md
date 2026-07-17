---
"@effected/app": patch
---

## Documentation

The bundled effected plugin's Effect v4 skills absorb three findings from the systems dogfood rounds: `effect-v4-idioms` and the construct map now document `Effect.catchTag`'s non-empty tag-array form (`Effect.catchTag(["A", "B"], recover)`, verified at beta.98), and `effect-v4-schema`'s make-vs-new rule now explicitly blesses the yieldable `yield* new SomeError({...})` construction for `TaggedErrorClass`, matching the house code across glob, workspaces and walker.
