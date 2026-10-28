---
"@effected/config-file": minor
---

## Breaking Changes

When `saveTarget` is unset, `save` and `update` now write to the discovered file under a `firstMatch` strategy. Under `layeredMerge` and custom strategies the target is still the default path. To keep the old target under `firstMatch`, pin `saveTarget: "default"`.

## Features

* `saveTarget` (`"source"` or `"default"`): `"source"` writes the highest-priority file the resolver chain found, falling back to `defaultPath` (#1113).
* `ConfigMerge.deep` is public: the pure, synchronous merge `layeredMerge` folds with. Arrays are atomic, an own `undefined` wins, prototype keys are dropped, each object pair merges once (so cyclic and shared inputs return, keeping their cycles and sharing), and a depth cap guards the stack (#1122).
* The top-level merge now admits a null-prototype object and a plain object together, as every nested level already did.
