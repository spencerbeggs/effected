---
type: Gotcha
title: A plausible schema.org property on the wrong type serializes cleanly and gets silently ignored
description: A property that exists in the schema.org vocabulary but is not legal on the node's @type passes through JsonLdDocument's serializer untouched, and only Conformance.check catches it.
resource: ../../packages/schema-org/src/Conformance.ts
status: stable
stale_after: 2027-03-13T00:00:00Z
tags: [architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e14925180b5cd280
---

# A plausible schema.org property on the wrong type serializes cleanly and gets silently ignored

## What a reader sees

A consumer sets `softwareVersion` in the `additional` catch-all of a
`SoftwareSourceCode` node — a perfectly reasonable guess, since
`softwareVersion` is a real schema.org property and reads like exactly
what a version field on source code should be called. `JsonLdDocument`
accepts the node at construction (`additional` is unchecked by the type
system by design), `toScriptBody()` serializes it into valid JSON-LD with
no error and no warning, and a search engine or downstream JSON-LD
consumer parses the document without complaint.

## What they would wrongly conclude

That the property was recorded and will be read by whatever consumes the
JSON-LD — a search engine, another service, a downstream index — because
nothing in the pipeline up to and including serialization objected to it.

## What is actually true

`softwareVersion` is defined on `SoftwareApplication` in the schema.org
vocabulary, not on `SoftwareSourceCode` (which spells its version property
`version`). The property is real, spelled correctly, and shaped
correctly — it is simply not `domainIncludes`-legal for the type it was
placed on. schema.org's own consumers (and this package's `Conformance`
validator) resolve legality by walking the *type's* ancestor closure
against the *property's* domain set; a plausible-but-wrong placement like
this one produces no parse error and no schema violation a naive check
would catch, because nothing about the JSON is malformed. It is simply
information the vocabulary does not attach any meaning to at that
position, and a consumer reading the document has no way to distinguish it
from a deliberately-included extension property.

`JsonLdDocument` itself never checks this — the catch-all is unchecked by
construction, which is exactly why `Conformance` exists as a *separate*,
opt-in step. Only `Conformance.check(graph)` (always) or
`Conformance.validateResult(graph)` (as a failing gate) reports the
placement as a `PropertyNotOnType` issue, distinct from `UnknownTerm` (the
term does not exist at all) and from the two deprecation issue kinds.
Skipping the conformance step — building and serializing a graph without
ever calling `Conformance.check` or `.validateResult` — means this class of
mistake ships silently every time.

## The check

Run `Conformance.check(graph)` (or gate a CI step on
`Conformance.validateResult(graph)`) on every graph before it is
serialized and published, and read `PropertyNotOnType` issues as "this
property exists but is in the wrong place" rather than dismissing them as
noise alongside `UnknownTerm`. See [the validate
interface](../interfaces/schema-org-validate.md) for the three-valued
outcome model and the `unknownTerms` gating option. Building a graph and
calling `toScriptBody()` without ever running `Conformance` proves nothing
about whether the graph's properties are legal for their types.
