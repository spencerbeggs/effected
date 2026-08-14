---
"@effected/config-file": patch
---

## Documentation

Corrects what a `Schema.StructWithRest` rest does to excess checking. The previous wording — "keys covered by a rest are not excess" — described the outcome but implied the wrong mechanism, and the shape suggests the reverse of the truth.

Measured against `effect@4.0.0-beta.107`: a rest **switches the excess-property check off for that struct entirely**, not merely for the keys the rest covers. A struct owning an index signature skips the pass, so `{ a, b }` is accepted *and* `b` is preserved even under `onExcessProperty: "error"`. Structs without a rest stay strict independently, which makes strictness a per-level decision rather than a per-key one.

The practical consequence is unchanged for a schema with a deliberate pass-through section — it still works under `"error"` — but a reader who added a rest to a *top-level* schema expecting to keep strictness elsewhere in it would have lost the check without a signal.
