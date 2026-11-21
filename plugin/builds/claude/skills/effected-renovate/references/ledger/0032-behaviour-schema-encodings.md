---
id: "0032"
title: "effect/schema: NumberFromString encodes -0 as \"-0\", CauseReasonIso's Die variant declares defect, and the string encoders reject unpaired surrogates"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.5"
detect: ["NumberFromString", "FiniteFromString", "toCodecStringTree", "CauseReasonIso", "encodeBase64(Url)?", "encodeHex", "encodeUriComponent"]
---

Several schema encodings now match their declared types or their inputs exactly.

- **`Schema.NumberFromString`, `Schema.FiniteFromString` and numeric encodings derived with `Schema.toCodecStringTree` encode negative zero as `"-0"`** (Effect-TS/effect#10721). A probe on both versions encoded `-0` with `NumberFromString`: the old version wrote `"0"`, the new one `"-0"`. An expected string or a stored encoding that holds `"0"` for a negative zero now differs.
- **The `Die` variant of `Schema.CauseReasonIso` declares `defect`, not `error`** (Effect-TS/effect#10701). The runtime shape already used `defect`, so only types change: code that read `error` from a decoded `Die` reason was reading `undefined`, and now fails to typecheck. Read `defect`.
- **`SchemaGetter.encodeBase64`, `encodeBase64Url`, `encodeHex` and `encodeUriComponent` fail with `SchemaIssue.InvalidValue`** when the string holds an unpaired UTF-16 surrogate, where they used to encode it lossily (Effect-TS/effect#10725).
- **`Schema.TemplateLiteral` and `Schema.TemplateLiteralParser` accept `Schema.Enum` parts**, which used to throw although the types allowed them (Effect-TS/effect#10576).

Run the schema round-trip and snapshot tests; check the installed `Schema` `.d.ts` for the `Die` reason's fields.
