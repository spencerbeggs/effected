---
type: Decision
title: GitHubClient keeps only the authenticated REST reads Bun and Deno need
description: Shared JSON-over-HTTP machinery lives in internal/http.ts, used unauthenticated by the Node fetchers and authenticated by GitHubClient, over one shared HTTP error family.
status: draft
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: b23c8600b71b6159
---

# `GitHubClient` keeps only the authenticated REST reads Bun and Deno need

## Context

`@effected/runtimes` has two kinds of network reads: Node's unauthenticated
dist index and release schedule, and Bun/Deno's authenticated GitHub REST
list operations. Both need the same underlying JSON-over-HTTP mechanics —
request construction, status mapping, schema decoding — but only the
latter needs authentication headers.

## Decision

The JSON-over-HTTP machinery lives in `internal/http.ts`, and the
unauthenticated Node fetchers use it **without** auth headers.
`GitHubClient` keeps only the authenticated REST list operations, and
`GitHub.ts` owns the shared HTTP error family — one concept, a typed HTTP
transport failure — which the unauthenticated fetchers reuse rather than
minting a parallel error ladder for a mechanically identical failure
mode.

## Alternatives rejected

**Two independent HTTP clients, one per auth posture.** Rejected because
it would duplicate request construction, status mapping and schema
decoding across Node's fetcher and `GitHubClient`, and would need a
second error type for what is structurally the same transport-failure
shape.

**Folding the unauthenticated Node reads into `GitHubClient`.** Rejected
because it would force Node consumers to satisfy `GitHubClient`'s
requirement — and by extension `GitHubAuth` — for reads that need no
authentication at all, breaking the [cache-strategy-as-layer
decision](cache-strategy-as-layer.md)'s guarantee that Node resolution
works with zero GitHub credentials.

## Consequences

Node's resolvers depend only on `HttpClient`; Bun and Deno depend on
`GitHubClient`, which itself depends on `GitHubAuth`. A transport failure
anywhere in the package surfaces through the one shared HTTP error
family, so a consumer catching that family handles both authenticated and
unauthenticated failures identically.
