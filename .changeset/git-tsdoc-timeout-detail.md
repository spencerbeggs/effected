---
"@effected/git": patch
---

## Documentation

- `Git`'s class-level TSDoc now names the 30 s timeout ceiling (`GIT_TIMEOUT`) and the `GitCommandError` it surfaces as, and states that the ceiling is per run rather than per member call — so the seven network-touching members, which resolve their ssh command first, are bounded at 60 s and `fetchAny` at 120 s.
- `GitCommandError`'s TSDoc now states the `message`/`detail` contract plainly: `message` is the rendering, `detail` is the datum, and a consumer routes on `detail !== undefined` rather than on whether git started. Forwarding `detail ?? message` nests one rendered message inside another.
