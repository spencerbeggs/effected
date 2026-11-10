---
id: "0050"
title: "Command.withHandler keeps the command's earlier error types, so a narrower Command annotation stops compiling"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.3"
detect: ["Command\\.withHandler", "Command\\.validate"]
---

This applies to an `effect/cli` program that builds a command with `Command.withHandler`, or validates one with `Command.validate`. `Command.validate` may now fail with your own errors, which `Command.run` reports like a handler failure instead of printing help. To keep those errors in the type, `Command.withHandler` now keeps the command's existing error type, and when it replaces a handler, the replaced handler's errors stay in the type too (Effect-TS/effect#10376).

- **A command annotated with a narrower error type no longer compiles.** Probed: `Command.make("x", {}, () => Effect.fail(new Bad())).pipe(Command.withHandler(() => Effect.void))` assigned to `Command.Command<"x", {}, {}, never, never>` compiles on 4.1.2 and is a type error on 4.1.3, because the result still carries `Bad`. Widen the annotation to the union, or pass the final handler to `Command.make` directly and drop the replacement.
- An error union downstream that matches every case (`Effect.catchTags`, an exhaustive `Match`) may now see an extra member. Handle it or let it reach your failure reporter.
- If you used `Command.validate` to turn a domain check into a usage error, check that `Command.run` still answers the way your tests expect. A failure with your own error now reports like a handler failure, with no help text.

Check the installed `effect/cli` `.d.ts` for `withHandler` and `validate`. Verify with your typecheck, then run the CLI tests that cover validation failures.
