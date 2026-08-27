# Failure rendering: the canonical `describeCause` home

This is the one place `describeCause`/`describeError` is documented across
the suite — every other skill that touches a failure `Action.run` eventually
renders points here rather than restating the code.

## `describeCause`

```ts
export const describeCause = (cause: Cause.Cause<unknown>): string
```

Exported standalone and as `Action.describeCause`. It produces one
`[Tag]: message` line for a typed failure, or a `Cause.pretty` fallback for
an interruption; a defect is prefixed `[defect]` so the two are told apart
at a glance. Reuse it rather than re-deriving a failure-rendering convention
per consumer — the audience is a human scanning a workflow log for the
first red line, not a stack trace.

## What `Action.run` does with it

`Action.run` renders exactly one `::error::` line —
`Action failed: [Tag]: message` via `describeCause` — and puts the full
`Cause.pretty` render behind `::debug::`, shown only when step debugging is
on. Splicing a full stack into the visible error is deliberately avoided: in
a bundled action every stack frame points at one line of the compiled
output, which teaches a reader nothing. The debug-gated full render exists
for the case where that trace is genuinely needed.

`Action.run` also carries a **last-resort catch** around `Effect.runPromise`
itself: if rendering the failure fails for any reason, `process.exitCode = 1`
still gets set. A green step for a crashed action is the worst outcome
available — worse than a red step with a bad error message — so this catch
exists purely to make that outcome unreachable.

## Reusing `describeCause` elsewhere

Any program rendering a `Cause` outside `Action.run`'s own top-level catch —
a `post` script summarizing a caught error in a job-summary line, a step
that logs a recovered failure before continuing — should call
`describeCause` rather than hand-rolling a second rendering convention. A
suite with two different "here's what went wrong" formats is harder to grep
a workflow log against than one with a single, reused convention.
