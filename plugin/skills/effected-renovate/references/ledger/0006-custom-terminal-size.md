---
id: "0006"
title: A custom Terminal must supply size
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["Terminal\\.make\\("]
---

A hand-built `Terminal` passed to `Terminal.make` must now supply `size`: a scoped queue seeded with the current dimensions that then receives each resize.

How it shows itself: the compiler rejects an implementation without it.

A test double is better replaced by `@effected/cli/testing`'s test terminal, which implements `size`. Check the shape against the installed `effect/dist/Terminal.d.ts`.
