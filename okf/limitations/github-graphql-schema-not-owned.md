---
type: Limitation
title: "@effected/github does not own every GraphQL document"
description: A document over a consumer-specific domain (project boards, etc.) is deliberately not modelled in the kit.
status: stable
bounds: ../interfaces/github-graphql.md
tags: [bundle, architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 99a0b75f7d7a528c
---

# @effected/github does not own every GraphQL document

## The condition

A consumer needs a GraphQL query or mutation whose subject is its own
domain — project boards are the recorded example — rather than a GitHub
primitive `@effected/github` already models (linked issues, cross-reference
timeline probes, branch-linked-to-issue creation, auto-merge toggling).

## The symptom

There is no `GraphQLDocument` in `@effected/github` for that query. A
consumer reaching for one finds nothing to import and must construct its
own typed document value using the package's `GraphQLDocument` mechanism.

## Why this is acceptable

REST routes come from a generated map describing all of GitHub, so modelling
one costs nothing beyond typing it. Every GraphQL document, by contrast, is
one the kit chose to write by hand, so the ownership question is a
deliberate ruling rather than an omission: a document whose subject is a
GitHub primitive this package already models is owned here; a document that
merely happens to be spelled in GraphQL, where a REST resource method
already does the same job, has no place here; and a document whose subject
is a domain no other consumer touches — project boards being one
consumer's, not the kit's — stays with that consumer. Pulling a
consumer-specific document into the kit would make the kit carry a domain
no other consumer touches.

## What the fix would take

Nothing to fix: a consumer constructs its own `GraphQLDocument` value over
the same mechanism (typed variables, a decoded response, the structural
already-exists discriminant), which is the entire value the mechanism
provides regardless of who owns the schema. A document only moves into the
kit if a second consumer independently needs the same GitHub-primitive
query, at which point it is added as an ordinary new document.
