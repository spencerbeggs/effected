---
id: "0058"
title: "Runtime.InterruptExitCode lets an interrupt choose its own exit code under the default teardown"
kind: adopt
shows: none
applies:
  effect: ">=4.1.3"
detect: ["hasInterruptsOnly"]
---

This applies to a program with a hand-written `Runtime.Teardown` that maps an interrupt-only exit to a code other than 130, usually 0 for a clean shutdown. Effect now ships `Runtime.InterruptExitCode`, a service you annotate onto an interruption: `Fiber.interruptAs(fiber, undefined, Context.make(Runtime.InterruptExitCode, 0))`. When every reason in the cause carries the annotation, `Runtime.defaultTeardown` exits with the largest one; any unannotated interrupt still exits 130.

- Where your own code ends the program, for example at the end of an input stream, annotate the interrupt and drop that branch of your custom teardown.
- Keep a custom teardown where `runMain` raises the interrupt, on SIGINT or SIGTERM: that interrupt carries no annotation, so the default still reports it as 130.

Check the installed `effect/Runtime` `.d.ts` for `InterruptExitCode`. Verify with a test that runs your program to its clean end under `Runtime.defaultTeardown` and asserts exit 0.
