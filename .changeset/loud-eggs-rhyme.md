---
"@effected/glob": minor
---

## Features

### Synchronous compilation: `GlobPattern.compileResult` and `GlobSet.compileResult`

```ts
import { Result } from "effect";
import { GlobPattern } from "@effected/glob";

const compiled = GlobPattern.compileResult("packages/*");
if (Result.isSuccess(compiled)) compiled.success.matches("packages/a");
```

Both new statics return `Result<_, GlobPatternError>` instead of an `Effect`. Compiling a pattern or a pattern set is pure string→predicate work with no IO and no async step, so the sync form is now the primitive: `GlobPattern.compile` and `GlobSet.compile` are thin derivations of their sync counterparts, adding only the tracing span. Both `compile` signatures are unchanged.

This removes the `Effect.runSync(Effect.result(...))` escape hatch that synchronous call sites — a lint-staged handler, a config predicate — were forced through for work that never actually needed an Effect runtime.
