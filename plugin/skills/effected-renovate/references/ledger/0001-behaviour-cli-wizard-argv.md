---
id: "0001"
title: "effect/cli: --wizard drops the inputs already typed for the selected command, and writes -- before positional answers"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.4"
detect: ["[-]-wizard"]
---

This applies only to a program built on `effect/cli`'s `Command.runWith` that still offers core's `--wizard` flag. A program that drops it, as `@effected/cli-kit` does for any run that is not interactive, sees no change on those runs.

Two things changed in the argv the wizard builds and runs (Effect-TS/effect#10529):

- **Typed inputs are replaced, not repeated.** A run such as `demo --name typed typed --wizard` used to keep the typed flag and argument in front of the wizard's answers. The command then failed to parse. The wizard now drops the tokens the selected command would consume, keeps the ones its ancestors consumed (subcommand names and inherited flags, with a short-option cluster split one flag per argument), and prompts for the rest.
- **A `--` now goes before positional answers** on a leaf command, so an answer such as `false` no longer binds to a preceding boolean flag. The argv is `greet --name Alice -- 2` where it was `greet --name Alice 2`, and the completion line the wizard prints shows the same.

Where the search matched a test that drives `--wizard` and asserts the argv, the completion line or the handler's input, update the expectation to match the new answers. Where it matched documentation or a help-text assertion, nothing changes. Verify by running the test that drives the wizard.
