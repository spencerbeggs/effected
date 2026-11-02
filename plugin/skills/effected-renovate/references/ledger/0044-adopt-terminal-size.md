---
id: "0044"
title: Adopt Terminal.size for terminal dimensions and resizes
kind: adopt
shows: none
applies:
  effect: ">=4.1.0"
detect: ["on\\(\"resize\"", "stdout\\.(columns|rows)"]
---

Core's `Terminal.size` is a scoped queue of terminal dimensions: the current size, then every resize.

Where to look: `process.stdout.on("resize")` listeners and direct reads of `process.stdout.columns` or `rows`. In tests, `@effected/cli/testing`'s test terminal implements it (entry 0046).
