---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 92
related:
  - github.md
  - github-rest.md
  - github-errors.md
  - github-resources.md
---

# @effected/github — GraphQL

## Overview

GraphQL is the package's second transport: a `GraphQLDocument` (`src/GraphQL.ts`) carrying a name, the document text and a response schema, executed through the same client, the same [error taxonomy](github-errors.md) and the same span conventions as a REST call. There is no separate GraphQL service.

What differs from [the REST surface](github-rest.md) is ownership, and that is why it is its own doc: REST routes come from a generated map that describes all of GitHub, while every GraphQL document here is one the kit chose to write. A document whose subject is a GitHub primitive the package already models is owned here; a document whose subject is one consumer's domain stays with that consumer. The mechanism is the kit's, the schema may not be. Package-wide framing is in [github.md](github.md).

## Typed documents, decoded responses

A document is built from a name, the document text and a response schema; the variables type is stated separately, with an optional encoder onto the wire object. The constructor is **curried** for that reason — TypeScript takes explicit type arguments all-or-nothing, so a single call would force the caller to spell out the decoded type as well — and the encoder exists so the variables type is genuinely load-bearing rather than structurally interchangeable. The client encodes the variables, posts the document and **decodes the response through the schema**, so a GraphQL result is a domain value rather than an `unknown` the caller casts, and a decode failure is [the decode kind](github-errors.md#four-errors-and-classification-happens-once) with the schema error carried structurally.

The name is not decoration: it names the span and the error's operation field, rather than a literal `"graphql"` standing in for every call.

**There is no separate GraphQL service.** The only thing one could do is error shaping — parsing *another error's* message string looking for an errors array — and with a typed error carrying that array structurally there is nothing left for it to do.

## Ownership: the mechanism is ours, the schema may not be

The rule that sorts documents between the kit and its consumers:

- **A document whose subject is a GitHub primitive this package already models is owned here** — linked issues, cross-reference timeline probes, creating a branch linked to an issue (which has **no REST equivalent**, and is the clearest case for owning a document at all), and enabling or disabling auto-merge behind [the resource method](github-resources.md#shapes-corrected-against-the-domain-rather-than-against-fixtures).
- **A document that merely happens to be spelled in GraphQL has no place here.** A consumer that does over GraphQL what a REST resource method already does reached for it only because it happened to hold a node id; the resource method is the answer.
- **A document whose subject is a domain no other consumer touches stays with that consumer.** Project boards are one repo's domain, not the kit's. That consumer keeps its document and constructs its own typed document value, gaining typed variables, a decoded response and the structural already-exists discriminant in place of a message sniff — which is the point: **the document type is the mechanism, owned here; a domain schema is content, owned by whoever has the domain.** Pulling it in would make the kit carry a domain no other consumer touches.

Where two spellings of one owned document exist, the strict superset wins and the resource method exposes its extra filter rather than shipping two documents.
