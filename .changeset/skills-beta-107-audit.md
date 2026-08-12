---
"@effected/app": patch
---

## Documentation

Re-verifies the "effected" plugin's Effect v4 skills against `effect@4.0.0-beta.107`. The skills were last verified at beta.94–101, and the audit found claims that would have produced code compiling against nothing.

* **Three APIs the skills taught do not exist** — `Schema.asClass`, `SchemaUtils`, and `References.CurrentConcurrency`. An entire documented section was built on `Schema.asClass`; the current form is to subclass the schema value directly
* **`Differ` was wrongly listed as removed** and is alive; `FiberRef`, `FiberRefs` and `FiberRefsPatch` genuinely are gone
* **`asEffect()` does not exist**, despite Effect's own migration notes documenting it as the `Yieldable` trait method. Neither `Option` nor `Result` is yieldable in `Effect.gen` — both satisfy the generator protocol, so `yield*` compiles clean and then dies as a defect that bypasses every `catch`. The bridges are `Effect.fromOption` and `Effect.fromResult`
* **A prescribed `Data.Class` copy-constructor bypass is retracted.** The constructor now assigns through an internal helper that defines `__proto__` as a data property, so the `Object.assign(Object.create(Proto), props)` reproduction the skills recommended is a prototype-pollution hole. The performance argument for it came from a cost regime already retracted, and re-measured flat
* **A nested `Schema.Class` field behaves differently since beta.101** — foreign and self-recursive fields are now identical: a literal is accepted, deep-validated and promoted, and a real instance passes through by reference
* Roughly a hundred source citations re-anchored, and `Graph`, `Metric` and `SchemaError` added to the module routing map
* A second sweep over the eighteen skills outside the `effect-v4-*` set found **no falsified API claims at all**, and re-stamped two probe-backed passages in the Actions state-and-secrets material to beta.107

The `effect-v4-source-lookup` skill now records the two failures this audit turned on. The migration notes assert claims the source refutes, in both directions, rather than merely staying silent about removals — they settle renames and nothing else. And the vendored `SCHEMA.md`, which ships at the pin, is a strong version-exact oracle that is nonetheless wrong in eight places at beta.107, so it never outranks reading the declaration.
