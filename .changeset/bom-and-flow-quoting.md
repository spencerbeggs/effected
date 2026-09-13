---
"@effected/yaml": patch
---

## Bug Fixes

- A leading byte-order mark no longer drops the first node of a document. The lexer counted the BOM as a column, so the first line lexed one column deeper than every line after it and the composer opened a second collection at that indent: `Yaml.parse("﻿a: 'x'\nb: 1\n")` returned `{ b: 1 }`, a BOM-prefixed sequence returned only its last item, and a BOM followed by a comment failed with `UnexpectedToken`. The BOM now occupies no column; node offsets stay indices into the original text, so `YamlFormat.modify` finds the first key and splices it in place with the BOM preserved. Closes effected#694.
- A plain scalar rendered inside a flow collection is now quoted whenever it contains a flow indicator (`,`, `[`, `]`, `{`, `}`), per the flow-plain rules of YAML 1.2 §7.3.3. Previously `requiresQuoting` applied block-context rules everywhere, so `Yaml.stringify` with `defaultCollectionStyle: "flow"`, `YamlDocument.stringify` on a flow-styled node, and `YamlFormat.modify` into a flow collection could all emit `[p, q, y]` for the value `"p, q"` (three items on re-parse) or `{b: p}, c: y}` (unparseable). Block context is unchanged. The region-confined modify fast path renders and round-trip-probes under the target's own context, so it stays regional for flow parents. Closes effected#695.
