---
id: "0046"
title: Adopt TestTerminalHandle.resize to drive a live resize in a test
kind: adopt
shows: none
applies:
  "@effected/cli": ">=0.25.0"
detect: ["TestTerminal"]
---

`@effected/cli/testing`'s `TestTerminalHandle` gains `resize(size)`, and the test terminal implements core's `Terminal.size`: each subscription gets the current size, then every resize, and `columns` and `rows` read live.

Where to look: tests that rebuild a terminal at a new size to simulate a resize, or that cannot test resize handling at all. Check the installed `@effected/cli` testing `.d.ts`.
