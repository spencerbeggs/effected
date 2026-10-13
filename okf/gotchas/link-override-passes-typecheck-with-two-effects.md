---
type: Gotcha
title: A green typecheck after linking an unreleased kit build hides a second effect instance
description: Linking a consumer straight at a kit package's directory typechecks cleanly once every clashing sibling is linked too — that clean state is the trap, because it is produced by two resolved effect instances in one process, not by one.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: fa030ebc70079066
---

# A green typecheck after linking an unreleased kit build hides a second effect instance

## What a reader sees

A consumer is pointed at an unpublished, unreleased `@effected/*` build
with a plain pnpm `link:` (or `file:`, which pnpm resolves the same way
for a directory) protocol. The first typecheck after linking reports type
identity errors — "two different types with this name exist" — for the
linked package and its siblings. Linking each clashing sibling package the
same way, one at a time, makes the errors disappear, and the typecheck
goes green.

## What they would wrongly conclude

That the green typecheck means the consumer is now correctly wired
against the unreleased build, and that reaching it by linking every
complaining sibling was the right fix.

## What is actually true

A plain `link:`/`file:` override leaves the linked package resolving
`effect` and its `@effected` siblings from the *kit's own* tree, not the
consumer's, which puts a second `effect` instance in the process. The type
identity errors are the visible, honest half of that problem — a
`Context.Service` tag is an identity, and two resolved copies of the same
package are two distinct tags. Chasing those errors by linking each
clashing sibling in turn does not fix the duplication; it links enough of
the graph that the type-level mismatch stops surfacing, while the runtime
duplication remains. The invisible half is what actually breaks: schema
class adapters failing silently across the instance seam, an all-strings
table cell coming back non-string, or a large minority of an otherwise
passing suite failing only against the linked tree.

## The check

Never treat a green typecheck as confirmation that a `link:`/`file:`
override is safe. Use
[the file: plus injected dependenciesMeta form](../runbooks/link-a-consumer-to-an-unreleased-kit.md)
instead, which materializes a real copy resolving its own dependencies
from the consumer's tree rather than the kit's — one `effect`, one of
everything, with no sibling overrides required at all. If a typecheck only
went green after linking multiple siblings to chase away type identity
errors, treat that history itself as the signal that a second `effect`
copy is present, and re-verify with the injected form before trusting any
test result against the linked build.
