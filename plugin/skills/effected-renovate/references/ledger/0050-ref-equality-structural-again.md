---
id: "0050"
title: Two Refs holding equal values compare Equal again
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.2"
detect: ["(Mutable|Subscription)?Ref\\.make(Unsafe)?\\(", "HashSet\\.|HashMap\\."]
---

Effect 4.1.2 reverts the 4.1.1 change that made each `Ref` and `MutableRef` equal only to itself (Effect-TS/effect#10247 reverts #9768). The changelog does not mention it. Two distinct refs whose current values are equal are `Equal.equals` again, hash alike, and collapse to one entry in a `HashSet` or one key in a `HashMap`. Probed on both versions: `Equal.equals(Ref.makeUnsafe({ x: 1 }), Ref.makeUnsafe({ x: 1 }))` is `false` on 4.1.1 and `true` on 4.1.2. A ref holding a different value is still unequal.

Find every place a ref reaches structural equality:

- a `HashSet` member or `HashMap` key;
- a field of a `Data` or `Schema` class instance that is itself compared or hashed;
- a cache, dedupe or memo key.

Where you need identity there, key on something stable you own, such as an id, or wrap the ref in `Equal.byReference` (probed: two wrapped refs holding equal values stay two `HashSet` members). Since the comparison reads the ref's current value, a ref mutated after it was inserted can also stop matching its own entry.

How it shows itself: no compiler error. A test that counts set members or looks up a ref-keyed map sees fewer entries, or another ref's entry. Detect hits are candidates, not confirmed breaks: check each one against how the value is used.
