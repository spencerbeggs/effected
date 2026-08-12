---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 92
related:
  - github.md
  - github-rest.md
  - github-errors.md
  - github-resources.md
---

# @effected/github — GraphQL

## Overview

GraphQL is the package's second transport: a `GraphQLDocument` carrying a name, the document text, a response schema and a variables schema, executed through the same client, the same [error taxonomy](github-errors.md) and the same span conventions as a REST call. There is no separate GraphQL service.

What differs from [the REST surface](github-rest.md) is ownership, and that is why it is its own doc: REST routes come from a generated map that describes all of GitHub, while every GraphQL document here is one the kit chose to write. A document whose subject is a GitHub primitive the package already models is owned here; a document whose subject is one consumer's domain stays with that consumer. The mechanism is the kit's, the schema may not be. Package-wide framing is in [github.md](github.md).

## Typed documents, decoded responses

A `GraphQLDocument` carries a name, the document text, a response schema and a variables schema. The client encodes the variables, posts the document and **decodes the response through the schema** — so a GraphQL result is a domain value, not an `unknown` the caller casts, and a decode failure is [the decode kind](github-errors.md#four-errors-and-classification-happens-once) with the schema error carried structurally.

The name is not decoration: it names the span and the error's operation field, where a predecessor passed the literal string `"graphql"` for every call.

**The separate GraphQL service disappears.** It was a pure error-shaping wrapper that parsed *another error's* message string looking for an errors array. With a typed error carrying that array structurally, there is nothing left for it to do.

## Ownership: the mechanism is ours, the schema may not be

A predecessor owned two documents and left the rest in consumers, where three repos wrote five more. The rule that sorts them:

- **A document whose subject is a GitHub primitive this package already models is owned here** — linked issues, cross-reference timeline probes, creating a branch linked to an issue (which has **no REST equivalent**, and is the clearest case for owning a document at all), and enabling or disabling auto-merge behind [the resource method](github-resources.md#shapes-corrected-against-the-domain-rather-than-against-fixtures).
- **A document that merely happened to be spelled in GraphQL is dropped.** Two consumer documents did over GraphQL what a REST resource method already does; the consumer reached for GraphQL only because it happened to hold a node id.
- **A document whose subject is a domain no other consumer touches stays with that consumer.** Project boards are one repo's domain, not the kit's. That consumer keeps its document and constructs its own typed document value, gaining typed variables, a decoded response and the structural already-exists discriminant in place of a message sniff — which is the point: **the document type is the mechanism, owned here; a domain schema is content, owned by whoever has the domain.** Pulling it in would make the kit carry a domain no other consumer touches.

Where an owned document replaced both a library version and a consumer's own, the **consumer's** version generally won on merit — a strict superset with more fields and an extra filter — and the resource method exposes that filter rather than shipping two documents.
