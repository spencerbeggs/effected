---
"@effected/commands": patch
---

## Documentation

- Documents `Run.collect` as the kit's one spawn-and-collect implementation: the public, maintained, bounded-memory alternative to hand-rolling a triple-collect (stdout, stderr, exit code) for a subprocess. `@effected/git`'s README now points consumers here for a git command `Git` itself does not expose, rather than at `@effected/git`'s own private `internal/run.ts`, which stays a deliberately parallel, unexported implementation (#628).
