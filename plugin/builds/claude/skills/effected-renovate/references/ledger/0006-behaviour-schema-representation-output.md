---
id: "0006"
title: "SchemaRepresentation: toCodeDocument omits unsupported annotation objects, and fromJsonSchemaDocument imports composition differently"
kind: behaviour
shows: behavioural
applies:
  effect: ">=4.1.4"
detect: ["toCodeDocument", "fromJsonSchemaDocument"]
---

Both changes alter generated output, so a snapshot of either fails. Neither changes a type.

- **`toCodeDocument`** (Effect-TS/effect#10532) used to write an annotation holding a `Map`, `Set`, `Date`, typed array or class instance as an empty object literal. It now omits that annotation entirely, and omits an object or array that contains one. A null-prototype object and an object from another realm are written as plain literals. A probe on both versions: `Schema.String.annotate({ kept: { value: 1 }, map: new Map(), date: new Date(0) })` generates `{ "kept": …, "map": {}, "date": {} }` on the old version and only `{ "kept": … }` on the new one.
- **`fromJsonSchemaDocument`** (Effect-TS/effect#10521) fixes how `allOf` composes with `additionalProperties`, enums, unions of discriminated objects and recursive references, and keeps `examples` through such intersections. It also rejects an intersection of unions it cannot prove disjoint, which it used to import. This was not probed here: check that each document you import still imports, and diff the generated schema.

Where the search matched code generation, regenerate and review the diff before re-recording a snapshot. A generated file committed to the repository changes on its next regeneration.

The new experimental `closeObjects` option closes open objects on import. Check the installed `.d.ts` before adopting it.
