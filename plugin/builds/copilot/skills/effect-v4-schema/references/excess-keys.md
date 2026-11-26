# Excess keys — what a decode drops, and the only strict path

## Decoding tolerates excess keys silently, and a typo is the common case

`Schema.Struct` **drops unknown keys without complaint** on decode under
`onExcessProperty`'s default of `"ignore"`. The only other value is `"error"`,
which rejects them; there is no `"preserve"`, and a struct keeps unknown keys
only when it declares them with `Schema.StructWithRest`. A struct of
all-`optionalKey` fields decodes `{ mxa: 100 }` to `{}` and reports success, so a
typo'd key and a correct-but-absent one are indistinguishable.

| Do this | Not this |
| --- | --- |
| `Schema.decodeUnknownEffect(S)(input, { onExcessProperty: "error", errors: "all" })` for anything a **human typed** | a bare decode of user-authored config, where a typo is silently discarded |
| let it default to `"ignore"` for a **machine-produced** payload you do not own | `"error"` on a third-party API response, which breaks the moment they add a field |

What a bare decode of user-authored config costs:

- A typo'd option key passes validation, and the code runs on defaults while the
  design promised that a typo fails loudly naming the field.
- A loader cannot report a typo'd section **nor a field the schema deliberately
  removed**, so a user migrating an older file keeps a dead credential and is
  told nothing. `onExcessProperty` is the fix; a hand-rolled filter per removed
  field is not needed.

Pair it with **`errors: "all"`**. The default reports the first issue only, so a
file with three typos surfaces one per run — fix, re-run, discover the next. The
extra work only happens on a document that is already failing.

**A rest does not make a struct stricter — it switches excess checking off.**
This is the opposite of what the shape suggests, and it is worth probing rather
than reasoning about:

| Spelling | `{ a: "x", b: 1 }` under `onExcessProperty: "error"` |
| --- | --- |
| `Schema.Struct({ a })` | **rejected** — the strict path |
| `Schema.StructWithRest(Struct({ a }), [Record(String, Unknown)])` | **accepted**, and `b` is *preserved* |
| `Schema.Struct({ a }, { rest: Never })` | accepted, `b` dropped — v4's `Struct` takes only `fields`, so a `rest` option is an ignored extra argument |
| `Schema.StructWithRest(Struct({ a }), [Record(String, Never)])` | rejected — but so is the valid `{ a: "x" }`, because the index signature covers `a` too |

`SchemaAST.ts` runs the excess pass only when the struct has no index signature,
so **owning a rest disables it for that struct entirely**, not merely for the
keys the rest covers. A schema that deliberately admits a pass-through section
therefore keeps working under `"error"` — but it is permissive about *every*
key at that level, and siblings without a rest stay strict independently.

So a rest cannot express "these keys and no others" in either direction, and
`onExcessProperty: "error"` is the only strict path.
