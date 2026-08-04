# The program and its steps

## `program.ts` is pure composition

The main-phase program holds exactly one job: read inputs, run steps in order, fold their results into outputs, and report. No I/O of its own beyond what those four things require, no formatting, no step logic — every line either calls something defined elsewhere or joins two of those calls together.

```ts
// program.ts
export const program: Effect.Effect<void, InputError | /* … */, ActionLogger | ActionOutputs | /* … */> =
 Effect.gen(function* () {
  const inputs = yield* readInputs;

  // Run-context block: what this run was asked to do, before any work.
  for (const line of runContextLines(inputs)) yield* Effect.logInfo(line);

  const outputs = yield* pipeline(inputs);
  yield* emitOutputs(outputs);

  // Closing result block: the last thing the log says.
  for (const line of resultLines(outputs)) yield* Effect.logInfo(line);
 }).pipe(
  // Outputs are emitted on EVERY abort path — a failed run still
  // publishes the all-disabled baseline so a consuming workflow can
  // always read every declared output. The original failure re-raises
  // untouched; only the emission side effect is made infallible.
  Effect.onError(() => emitOutputs(initialOutputs).pipe(Effect.ignore)),
 );
```

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

See `designing-an-action`'s checkpoints reference for why this has to be a design-time decision, not a wiring-time discovery.

## The output fold starts from all-disabled defaults

```ts
// schema/outputs.ts
export const initialOutputs: OutputsModel = {
 didSomething: false,
 // … every declared output, at its "nothing happened" value
};
```

The pipeline folds each step's contribution over this baseline, so a step that didn't run — skipped by an input, short-circuited by a rehearsal guard — reports its default rather than being silently absent from the output set. The failure path in `program.ts` emits exactly this baseline, which is what makes "every output emitted on every exit path" true rather than aspirational.

## Deriving a step's requirement channel

When a step's shape is settled before its logic is filled in — the walking-skeleton discipline `designing-an-action` teaches — derive the declared requirement channel from what a reference implementation's code path actually touches, never from a guess at what "should" be needed. See `designing-an-action`'s walking-skeleton reference for the full reasoning and the asymmetry between declaring a channel too narrow versus too wide.
