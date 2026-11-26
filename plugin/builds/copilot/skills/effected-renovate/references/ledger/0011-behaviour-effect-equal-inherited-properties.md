---
id: "0011"
title: "effect: Equal.equals and Hash.hash now include inherited properties of objects built with Object.create"
kind: behaviour
shows: behavioural
applies:
  "effect": ">=4.1.6"
detect: ["Object\\.create\\("]
---

For an object whose prototype is not `Object.prototype` but whose `constructor` is still `Object` (what `Object.create({ ... })` gives), `Equal.equals` and `Hash.hash` now include inherited enumerable properties. Two such objects that differ only in an inherited property used to compare equal with equal hashes, and now compare unequal with different hashes (probed both ways). One-off structural comparisons of plain objects and arrays also no longer compute and cache a hash, so they are faster. A custom `Hash` and the cached-hash checks behave as before.

Search for `Object.create(` in code whose results reach `Equal.equals`, `HashMap`/`HashSet` keys, `Data` comparisons or schema equivalence. Rerun the tests that cover them. A newly unequal pair, or a key that no longer collapses, is this entry, not a regression.
