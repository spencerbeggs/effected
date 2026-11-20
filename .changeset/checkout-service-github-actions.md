---
"@effected/github-actions": minor
---

## Breaking Changes

### The step log replaces withBuffer, withStep and heading

`ActionLogger.withBuffer`, `withStep` and `heading` are deleted, with no compatibility layer; the compiler finds every call site. `ActionLogger.phase` and `ActionLogger.step` replace them.

* `phase(name, effect)` is a bold heading that is never folded.
* `step(name, effect, options)` holds its detail quietly for a window, then writes one outcome-titled line. Success folds the detail, and failures are never folded.
* Past the window a step streams live output, and concurrent live steps are prefixed with `[name]`.
* `ActionLogger.command` runs a child process inside a step and logs its command line, output and exit code as the step's detail. Use it instead of `stdout: "inherit"`, which bypasses the fold.
* `ActionLogger.recording()` returns a test layer and the captured `StepLogEntry` values, for asserting on the log without rendering text.

Migration:

```ts
// before
yield* logger.heading("Release", body);
yield* logger.withStep("build", build, { summary: "built" });

// after
yield* logger.phase("Release", body);
yield* logger.step("build", build, { summary: () => "built" });
```

`summary` is now a function of the step result. Where `withBuffer` wrapped work that should stay visible live, pass `window: "0 seconds"` to `step`.

## Features

### Checkout service

`Checkout` reproduces `actions/checkout` v7 as an Effect service, so an action can check out a repository itself instead of relying on a separate workflow step.

* `Checkout.checkout` fetches and checks out a ref with the options in `CheckoutOptions` and resolves with a `CheckoutResult`
* `Checkout.cleanup` removes what `checkout` left behind, for use from a `post` entry
* `Checkout.fromInputs`, `Checkout.inputs` and `Checkout.writeOutputs` read the action's inputs and write its outputs the way `actions/checkout` does
* `CheckoutRef` and `CheckoutAuth` model the ref to fetch and the credentials to use
* Credential lifetime is `"job"`, `"action"` or `"none"`
* Each failure reason is its own `CheckoutError` class, so callers can match on it

## Dependencies

| Dependency    | Type       | Action | From | To          |
| :------------ | :--------- | :----- | :--- | :---------- |
| @effected/git | dependency | added  | —    | workspace:^ |
