---
"@effected/github": minor
---

## Breaking Changes

### Unstubbed test-double members die when run

In every `makeTest` double, an unstubbed member now returns `Effect.die(...)` evaluated when the effect runs, rather than throwing synchronously when the member is called. `GitHubClient.makeTest().paginateStream` returns `Stream.fromEffect` of the die. Code that relied on a synchronous throw (for example `assert.throws`) must run the effect and assert on the defect.

The defect message now names the member and the override to pass, for example "`GitHubRepository.makeTest`: `get()` was called but not stubbed — pass a `get` override." Value members read "was read but not stubbed" in the same form.

### `ActionsOidc` and `GitHubFixtures` are static classes

Both were typed const objects and are now classes with static members (`ActionsOidc` has a private constructor). Members are unchanged: `ActionsOidc.issuer`, `verify`, `testClaims`, and `GitHubFixtures.failure`. `typeof ActionsOidc` and `typeof GitHubFixtures` change, and the API model kind moves from Variable to Class.
