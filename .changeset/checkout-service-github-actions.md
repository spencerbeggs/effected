---
"@effected/github-actions": minor
---

## Breaking Changes

### The step log replaces withBuffer, withStep and heading

`ActionLogger.withBuffer`, `withStep` and `heading` are deleted, with no compatibility layer; the compiler finds every call site. `ActionLogger.phase` and `ActionLogger.step` replace them.

* `phase(name, effect)` is a bold heading that is never folded.
* `step(name, effect, options)` holds its detail quietly for a window, then writes one outcome-titled line. Success folds the detail, and failures are never folded.
* Past the window a step streams live output, and concurrent live steps are prefixed with `[name]`.
* `ActionLogger.command` runs a child process inside a step and logs its command line, output and exit code as the step's detail. Use it instead of `stdout: "inherit"`, which bypasses the fold. It stops reading 10 seconds after the child exits, as `@actions/exec` does, so a grandchild holding the pipes cannot hang it.
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
* Credential lifetime is `"job"`, `"action"` or `"none"`. Under `"job"` and `"action"` both the token and an SSH key's `core.sshCommand` are persisted, so later git authenticates the same way over either; `"action"` removes them when its scope closes
* `Checkout.fromInputs` reads every boolean input as `actions/checkout` does: true only for a case-insensitive `true`, and an empty value takes the stock in-code default, so an empty `persist-credentials` persists nothing
* A failure after the default branch is resolved names that branch: `CheckoutRefNotFoundError` and `CheckoutCommitMismatchError` carry `ref` as `refs/heads/<name>`, and the red fetch step names it too
* Each failure reason is its own `CheckoutError` class, so callers can match on it. `CheckoutUnqualifiedRefPinError` refuses a `Ref` pinned to a commit without a full `refs/` name, `CheckoutStateKeyInUseError` refuses a second `"job"` checkout of another path under a `stateKey` already in use, and `CheckoutServerUrlError` refuses a GitHub server URL that is not an absolute `http` or `https` URL
* The server URL (`serverUrl`, the `github-server-url` input or the runner's `GITHUB_SERVER_URL`) is checked once, before any git runs. A host with no scheme, such as `ghe.example.com`, fails `CheckoutServerUrlError` with a message saying to include `https://`, as `actions/checkout` refuses it, instead of a defect. An empty `serverUrl` falls back to `GITHUB_SERVER_URL`, then `https://github.com`

## Dependencies

| Dependency    | Type       | Action | From | To          |
| :------------ | :--------- | :----- | :--- | :---------- |
| @effected/git | dependency | added  | —    | workspace:^ |
