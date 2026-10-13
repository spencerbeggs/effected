---
type: Limitation
title: Decoding a JsonLdDocument silently drops the additional catch-all
description: JsonLdDocument only implements the encode direction; a Schema decode of the wire form succeeds but does not reconstruct which fields were originally flattened from a node's catch-all.
bounds: ../modules/schema-org.md
status: stable
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 376f250526560eb2
---

# Decoding a JsonLdDocument silently drops the additional catch-all

## The condition

`JsonLdDocument` is a `Schema.Class`, so `Schema.decodeUnknown(JsonLdDocument)`
exists as a callable symbol simply by virtue of being a Schema class. But
the class's encode direction is asymmetric with what a faithful decode
would need to do: encoding spreads a node's `additional` catch-all entries
directly into the node's JSON object (`src/JsonLdDocument.ts`), so on the
wire a flattened catch-all key is indistinguishable from a typed field.

## The symptom

Calling `Schema.decodeUnknown(JsonLdDocument)` on a JSON-LD document
**succeeds** rather than failing, but the decoded value silently drops
every key that was originally in a node's `additional` record: those keys
were flattened into the object at encode time, and the decoder has no way
to tell "this key came from `additional`" apart from "this key is a typed
field I don't recognize", so it does not attempt to re-gather anything into
`additional`. A caller who assumes `decode(encode(graph))` round-trips a
graph unchanged will find the catch-all fields of every node quietly gone
from the result, with no error, warning, or type-level signal that
anything was lost.

## Why this is acceptable

Re-implementing the decode direction correctly would require re-gathering
every unrecognized wire key back into `additional`, and that reconstruction
carries real design decisions the package has not made: which keys count
as "recognized" (the typed fields plus `@id`/`@type`), how to handle a key
that collides with a typed field on decode (the mirror of
`ConflictingTermError` on encode), and whether the reconstruction should be
strict or lossy on ambiguous input. Shipping a decode that silently
produces a plausible-but-wrong result — one that looks like it worked and
loses data — is worse than shipping none, so the package declares the
decode direction unimplemented rather than shipping a half-correct one.
This is explicit and tested: the class's TSDoc states the asymmetry in
those words, and `__test__/JsonLdDocument.test.ts` pins it so a future
change cannot let the round trip start "half working" by accident.

## What the fix would take

Implementing decode would mean designing the catch-all re-gathering rule
first — deciding, for every unrecognized key on a decoded node, whether it
becomes an `additional` entry or a decode failure, and handling the
collision case explicitly rather than by omission. That design question is
recorded as the central open item for when the decode direction is
eventually built; until it lands, `JsonLdDocument.buildResult` /
`.build` (the validating constructors) and the encode-only serializer
(`toJsonLd` / `toScriptBody`) remain the package's only supported
directions. Parsing existing JSON-LD back into typed nodes is listed as
out of scope for the same reason — no consumer has needed it, and building
it means answering the catch-all question first.
