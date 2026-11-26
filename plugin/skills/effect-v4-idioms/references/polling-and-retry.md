# Polling and retry — `Effect.repeat` and `Effect.retry` options

A poll loop written as `const go = Effect.gen(function*() { ...; yield* Effect.sleep(d); return yield* go })`
re-derives a schedule by hand and hides the stop condition in control flow.
This page holds the option shape and the three facts a hand-rolled loop gets
wrong.

## The options object

`Effect.repeat` (`Effect.ts:8313`) takes either a `Schedule` or an **options
object** — `{ schedule?, times?, while?, until? }` — that
`internal/schedule.ts:210` (`buildFromOptions`) folds into one schedule; `while`
and `until` may return a `boolean` or an `Effect<boolean>`, and they see the
effect's **result**.

`Effect.retry` takes the same option shape keyed on the failure instead, and it
retries **only a plain typed failure**: a cause that also carries a defect or an
interruption (a `Cause.combine` of a `fail` and a `die`, say) is propagated on
the first attempt, never retried.

```ts
const status = yield* Effect.repeat(pollOnce, {
  schedule: Schedule.spaced("2 seconds"),
  until: (s): s is "done" => s === "done",   // a refinement NARROWS the result type
  times: 30,
})
```

## Three facts, each a trap for a hand-rolled loop

- **The effect runs once before the schedule is consulted**, so `times: 2`
  produces **three** runs (the doc's own gotcha, confirmed: a counter read 3);
  `times` counts repetitions, not executions.
- **The value is the last result**, and an `until` written as a type guard
  narrows it — `Repeat.Return` (`Effect.ts:8158`) picks the refined type, so the
  example above types as `"done"`, not `"pending" | "done"`. `while` with a
  refinement narrows to the *excluded* branch.
- **`until` alone with no `schedule` spins with no delay** (`passthroughForever`
  is the default schedule) — a poll against a remote must always pass
  `schedule: Schedule.spaced(...)` or it is a busy loop.
