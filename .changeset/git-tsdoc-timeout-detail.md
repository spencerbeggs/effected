---
"@effected/git": patch
---

## Documentation

- `Git`'s class-level TSDoc now names the per-call 30 s timeout ceiling (`GIT_TIMEOUT`) and the `GitCommandError` it surfaces as, so consumers can decide whether to layer their own timeout without reading the implementation.
- `GitCommandError`'s TSDoc now states the `message`/`detail` contract plainly: `message` is the rendering, `detail` is the datum (set only when git never ran); forwarding `detail ?? message` nests one rendered message inside another. Closes effected#652.
