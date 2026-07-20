---
"@effected/app": minor
---

## Features

### effected plugin: Result-parity is taught as the ratified kit rule

The observability and testing skills described the sync-primitive convention as an emerging pattern observed in `@effected/jsonc`. It has since been ratified kit-wide, and the skills now teach it as policy with a scope test rather than an observation.

The observability skill states the rule outright: a public boundary returning `Effect` with nothing in `R`, no async step and no IO must expose the sync form as the primitive, spelled `*Result` — never `*Sync`, which the kit reserves for genuinely-blocking-IO facades — with the `Effect` variant defined in terms of it behind its named span. Interface and adapter seams are called out as out of scope, and an in-scope boundary with no `*Result` twin is now named as a review finding alongside the existing span-discipline findings.

The testing skill's narrowing guidance no longer cites `Jsonc.parseResult` as the lone example: the `Result.isSuccess`/`Result.isFailure` trap now lists the full settled surface — `parseResult`/`stringifyResult` across the format packages, `parseTreeResult`, glob's `compileResult` and semver's `parseResult`/`intersectResult`.
