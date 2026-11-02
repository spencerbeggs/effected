---
id: "0013"
title: Schema.TaggedUnion match no longer takes output type arguments
kind: breaking
shows: typed
applies:
  effect: ">=4.1.0"
detect: ["\\.match(OrElse)?<"]
---

`Schema.TaggedUnion`'s `match` and `matchOrElse` no longer take explicit output type arguments; the output is inferred from the handlers. Drop the type arguments, and annotate a handler's return type where inference needs help. From the Effect changelog, not probed by the kit: check the installed `effect/dist/Schema.d.ts`.

How it shows itself: a call with type arguments stops compiling.
