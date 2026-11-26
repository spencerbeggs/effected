---
id: "0012"
title: "effect: Match.type handlers receive the input once, and the tag and literal matchers accept Match.fn"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["Match\\.type"]
---

A `Match.type` matcher passed the matched input twice to its `when` and `orElse` handlers, so a handler saw two arguments. It now passes one (probed: a rest-parameter handler counted 2 arguments before and 1 now). A handler written for one argument is unaffected.

Search for `Match.type` and check handlers that read a second parameter or use `...args`: that second argument is now gone. Separately, `Match.tags`, `tagsExhaustive`, `tagStartsWith`, the `discriminator*` matchers and `literals`/`literalsExhaustive` now accept `Match.fn` matchers and pass the selector's arguments on to their handlers. Check the installed `effect/Match` `.d.ts` before relying on that.
