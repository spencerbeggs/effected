---
"@effected/changesets": minor
---

## Features

### Breaking-floor detection

`ReleasePlan.breakingFloors(plan, { packages })` reports each release that stays on its own caret line while a peer range it publishes stops admitting a dependency's version on the old line, as `BreakingFloor` values with their `FloorCause`s and the smallest bump that leaves the line. Changesets bumps such a dependent `patch`, so a consumer on the old line of both resolved a release it could not run.
