# The program and its steps

## `program.ts` is pure composition

The main-phase program holds exactly one job: read inputs, run steps in order, fold their results into outputs, and report. No I/O of its own beyond what those four things require, no formatting, no step logic — every line either calls something defined elsewhere or joins two of those calls together.

```ts
// program.ts
export const program: Effect.Effect<void, InputError | /* … */, ActionLogger | ActionOutputs | /* … */> =
 Effect.gen(function* () {
  // The all-disabled baseline goes out FIRST. Every declared output now
  // exists for a consuming workflow, whatever happens next, and nothing
  // later can blank a value that describes work that actually happened.
  yield* emitOutputs(initialOutputs);

  const inputs = yield* readInputs;

  // Run-context block: what this run was asked to do, before any work.
  for (const line of runContextLines(inputs)) yield* Effect.logInfo(line);

  const outputs = yield* pipeline(inputs);
  yield* emitOutputs(outputs);

  // Closing result block: the last thing the log says.
  for (const line of resultLines(outputs)) yield* Effect.logInfo(line);
 });
```

Do **not** emit the baseline from an `Effect.onError` handler. That form
looks equivalent and is not: a step that opened a pull request and then a
later step that failed would have the handler overwrite `pr-number` with the
baseline's empty value — a false statement about work that happened, not a
conservative default. Emitting up front satisfies "every output on every
exit path" without a handler that can lie. Each exit path that knows more
than the baseline — a partial success, a no-changes early return — writes
the full set again with what it knows.

An *unexpected* failure between steps is the remaining gap: the final
`emitOutputs(outputs)` never runs, and a consumer reads the baseline for
work that did happen. Close it at the step, not with a handler — a step whose
result a consumer must see even if a later step fails (a created pull
request, a published tag) emits its own output the moment it lands, through
the same `ActionOutputs.set`. Later writes only ever add to what an earlier
write said; nothing re-publishes the baseline over it.

Failure still fails the effect — the job's verdict comes from the error channel the runtime renders, never from a manual "mark failed" call followed by a plain return. See `designing-an-action`'s checkpoints reference for the full failure-posture discipline this pattern depends on.

The logging shape above — a run-context block, a closing result block, and (inside each step) a line for anything skipped — is a contract worth testing directly: assert on the captured log stream rather than trusting that the shape survives a refactor. `actions-reporting`'s logging-contract reference owns this in full.

## A step is an orchestration unit

One module per pipeline step. Each exports a result type, a tagged error *only if the step can actually fail*, and an explicitly annotated requirement channel:

```ts
// steps/my-step.ts
export interface MyStepResult {
 readonly didSomething: boolean;
}

export class MyStepError extends Data.TaggedError("MyStepError")<{
 readonly reason: "some-real-failure-mode";
 readonly message: string;
}> {}

export const myStep = (inputs: Inputs): Effect.Effect<MyStepResult, MyStepError, SomeRequiredService> =>
 Effect.gen(function* () {
  // …
 });
```

**An error class exists only if this module constructs it.** A step whose inputs are already validated before it runs, and which cannot otherwise fail, declares no error type at all — the mirror of "no error class without a constructor site" is "no error channel without a real failure mode behind it." Reason literals accrete speculatively far more often than they get pruned; resist adding one for a case that hasn't happened.

**Decide the failure posture at the point the step is written, and say so in the module's own documentation:**

- *Fail-the-job* — let the tagged error propagate, uncaught, out of the step.
- *Degrade-to-warning* — catch the step's own error inside the step (or immediately at its call site), log it, and return an honest result reflecting what didn't happen. The step's exported signature is then `never` in its error channel, truthfully — it degrades internally rather than failing.
- *Double-netted* — the `post.ts` shape; see [entries-and-layers.md](entries-and-layers.md).

Write the posture into the module's own doc comment, beside the error channel, in those words: `Failure posture: degrade-to-warning`. Annotate a `never` that means "degrades internally" explicitly on the exported signature rather than letting inference supply it, so a dependency upgrade that widens a member's error channel becomes a compile error at that line instead of a job that starts failing. A step may also declare an error it does not raise today when the module says why — keeping a contract open for a genuinely unexpected case without making current tolerance a lie — which is different from a class nothing constructs.

See `designing-an-action`'s checkpoints reference for why this has to be a design-time decision, not a wiring-time discovery.

## The output fold starts from all-disabled defaults

```ts
// schema/outputs.ts
export const initialOutputs: OutputsModel = {
 didSomething: false,
 // … every declared output, at its "nothing happened" value
};
```

The pipeline folds each step's contribution over this baseline, so a step that didn't run — skipped by an input, short-circuited by a rehearsal guard — reports its default rather than being silently absent from the output set. The up-front write of exactly this baseline is what makes "every output emitted on every exit path" true rather than aspirational; every later write — an explicit exit path, or a step publishing its own result as it lands — only adds state the baseline did not know.

## Deriving a step's requirement channel

When a step's shape is settled before its logic is filled in — the walking-skeleton discipline `designing-an-action` teaches — derive the declared requirement channel from what a reference implementation's code path actually touches, never from a guess at what "should" be needed. See `designing-an-action`'s walking-skeleton reference for the full reasoning and the asymmetry between declaring a channel too narrow versus too wide.
