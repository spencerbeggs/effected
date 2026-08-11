---
"@effected/app": minor
---

## Dependencies

| Dependency | Type            | Action  | From          | To            |
| :--------- | :-------------- | :------ | :------------ | :------------ |
| effect     | peerDependency  | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

## Maintenance

- Advances the `effect` peer to `4.0.0-beta.107`, part of a coordinated kit-wide wave — the whole 27-package release republishes against the new beta together.

## Documentation

- The bundled "effected" plugin's skills fold in the beta.101→107 Schema surface: `Schema.TaggedErrorClass` is `Schema.TaggedError` again (same curried call shape), `SchemaIssue.InvalidValue` takes `(annotations, input, options)` with input retention behind the new `reportInput` parse option, and thrown validation errors split into the generic `"Schema validation failed"` + `error.cause` contract (constructors, `make`, `asserts`) versus `decodeUnknownSync`'s still-formatted `SchemaError` carrying the issue on `.issue`. The construct-map skill gains a dedicated beta.101→107 sweep table for driving downstream upgrades.
- New testing guidance: a virtual `TestClock` desyncs from real filesystem awaits in the effect under test — use a per-test `it.live` escape hatch; and an `Effect.catch` over a `never` error channel is unreachable dead code that reads as coverage — check the callee's declared `E` before writing a handler.
