---
"@effected/changesets": minor
---

## Features

### Breaking-floor detection

`ReleasePlan.breakingFloors(plan, { packages, config })` reports each release that stays on its own caret line while a peer range it publishes stops admitting a dependency's version on the old line, as `BreakingFloor` values with their `FloorCause`s and the smallest bump that leaves the line. Each range is read as `ReleasePlan.edits` would write it, so a held peer range the config rewrites counts as rewritten. It returns a `Result` and fails as `edits` fails. Changesets bumps such a dependent `patch`, so a consumer on the old line of both resolved a release it could not run.
