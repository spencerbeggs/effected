---
type: Gotcha
title: A bare-major version key enumerates ahead of every dotted one
description: "A catalog entry's versions map serializes \"2\" before \"1.5\" no matter the insertion order, which reads as a lost sort — JavaScript enumerates integer-like object keys first, and SchemaStore reads the map by key, so nothing is wrong."
status: draft
resource: ../../packages/schemastore/src/SchemaVersioning.ts
stale_after: 2027-03-13T00:00:00Z
tags:
  - compat
sources:
  - id: versioning
    resource: ../../packages/schemastore/src/SchemaVersioning.ts
  - id: catalog-entry
    resource: ../../packages/schemastore/src/CatalogEntry.ts
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: "claude-code/opus-5"
  at: 2026-09-14T04:45:45Z
  body_sha256: 090ba28df190507bea0b7b35a79d3ed652cf06b4f5dc41f49425ea315eae3bc6
---

# A bare-major version key enumerates ahead of every dotted one

## What a reader sees

A catalog entry assembled from schemas versioned `1.5` and `2` — the
widened grammar admits `major`, `major.minor` and `major.minor.patch`
labels[^versioning] — writes its `versions` map with `"2"` first:

```json
{
 "versions": {
  "2": "https://example.com/schemas/2/x-2.json",
  "1.5": "https://example.com/schemas/1.5/x-1.5.json"
 }
}
```

The schemas were declared in ascending order, `CatalogEntry.assemble`
hands them to `SchemaVersioning.catalogUrls`, which sorts them ascending
before building the map,[^catalog-entry][^versioning] and the output
still puts the newer label on top.

## What they wrongly conclude

That insertion order was lost somewhere between the sort and the write,
that the version sort is broken for one-component labels, or that the
JSON writer reorders keys and needs a fix.

## What is actually true

JavaScript enumerates an object's integer-like string keys first, in
numeric order, ahead of every other string key in insertion order — a
language rule, not a library one. `"2"` is integer-like; `"1.5"` and
`"1.5.0"` are not. So any `versions` map holding at least one
bare-major label and one dotted label serializes the bare-major keys
first, whatever order they were inserted in. This is the reason
bare-major labels were originally refused by the strict three-component
grammar, and the owner chose to admit them anyway.[^owner]

SchemaStore reads a catalog entry's `versions` by key, not by position,
so the effect is cosmetic: every URL is still reachable under its own
label, and the entry is accepted. Do not sort the map, wrap it, or
encode it as an array to "fix" this; the CLI's content-compare treats
the map as an object, and the same enumeration rule reorders it again on
the next parse.

[^versioning]: `SchemaVersioning` — the one-to-three-component label grammar, its numeric ordering with missing components read as `0`, and `catalogUrls`, which sorts ascending and inserts in that order.
[^catalog-entry]: `CatalogEntry.assemble` — derives `versions` from every versioned schema of one name through `SchemaVersioning.catalogUrls`.
[^owner]: The owner's design conversation of 2026-09-13: bare-major labels admitted, the enumeration quirk recorded as a gotcha rather than fought.
