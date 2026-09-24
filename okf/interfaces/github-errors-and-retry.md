---
type: Interface
title: "@effected/github errors and retry"
description: Four error classes, one classification step, and one retry policy driven by GitHub's own headers.
status: stable
kind: api
resource: ../../packages/github/src/GitHubError.ts
tags: [bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 3a5bc4fbcc57620d5c17a03ec5eb69a0d3637288b9342fec9214435cc16aa048
verified:
  - by: human:spencer
    at: 2026-09-24T00:11:34.761Z
---

# @effected/github errors and retry

Four error classes, one classification step and one retry policy cover
everything that can fail on the wire: an error for REST, one for GraphQL,
one for App authentication and one raised by the pure permission
comparator, each carrying the structural `kind` every recovery routes on.
Classification happens at a single boundary mapper, and the retry schedule
reads GitHub's own rate-limit headers. Resilience is a package-wide
property rather than a property of any one transport:
[the REST client](github-rest-client.md) raises most of what is classified
here and [the resource services](github-resources.md) consume the
discriminant; package-wide framing is in
[the `github` module](../modules/github.md).

## Four errors, and classification happens once

The package declares one error for the REST surface, one for GraphQL, one
for App authentication and one raised by the pure permission comparator
(`packages/github/src/GitHubError.ts` and its siblings). Classification
happens in exactly one place, the boundary mapper that turns an unknown
octokit throwable into a classified error (`GitHubError.fromOctokit`);
nothing else in the package inspects a status code or a message.

The load-bearing field is `kind`: not-found, already-exists, rejected,
unauthorized, rate-limited, transport, decode
(`packages/github/src/GitHubError.ts:53`). It is what replaces every string
sniff, and the sizing follows what consumers actually read — a reason
string, a status, an operation name and a tag — so nothing beyond those is
mandatory. `operation` names the resource method or the raw route; `reason`
is the human-readable field consumers interpolate; the rest are optional
with ergonomic statics filling them from the value the mapper already has.

- **`retryable` is derived, not stored** — the kind already carries it —
  while a server-advised delay survives as an optional field because the
  retry schedule reads it off the error.
- **"Already exists" is first-class on both channels**, REST and GraphQL. It
  closes a consumer that lowercased a message and grepped it for two
  words — and the upsert operations make even that unnecessary.
- **A schema failure never escapes.** The decoding request and the GraphQL
  member normalize a decode failure into the decode kind with the schema
  error carried structurally.
- **Statics cover every hand-construction site**, so a consumer test that
  used to build an error by hand is a one-liner.

The GraphQL error keeps a structured errors list, because it is the one
structured field a consumer reads and because GraphQL genuinely returns a
list, and its operation field names the document rather than a literal
string standing in for every call. The App error's `kind` distinguishes
JWT, token, revoke, identity and installation failures — the JWT arm
exists because the JWT signer converts a PKCS#1 private key (which is what
GitHub hands you) to PKCS#8 only under the Node export condition, so on
another runtime a PKCS#1 key fails explicitly rather than as a wrapped
defect.

## One retry policy, driven by GitHub's own headers

There is one retry policy and no rate-limit subsystem. Several policies —
one of which inevitably lacks a predicate and retries permission denials —
stack on each other unpredictably, and a rate-limit gate resolved through
an optional-service lookup would degrade the whole feature silently when
nobody provides it.

- **The policy is wired once, in the client layer**, so every resource
  inherits it and no resource retries on its own.
- **Only transport and rate-limited failures retry.** There is no path on
  which a permission denial is retried.
- **A server-advised delay wins over the computed backoff**, unless it
  exceeds a ceiling — in which case the error is re-failed rather than
  slept through, because a long rate-limit reset must surface as a failure
  rather than a hang. Otherwise, full jitter over an exponential bound.
- **The schedule is built with the metadata-carrying step constructor**,
  whose step receives the failure being retried — the native construct for
  "the delay depends on the failure", so no hand-rolled recursive retry
  loop is needed.

Resilience imports no error class at all: it declares a structural shape —
retryable, plus an optional advised delay — so one policy serves both the
REST and the GraphQL error, and every policy decision is testable against a
two-field literal.

**Rate-limit headers stay, as an observable value rather than a shared
cell.** The client parses them off every response into a ref held inside
the layer's own closure, surfaced as one effect-valued member on the client
shape: mockable from a partial record, observable in tests, impossible to
forget to provide and impossible to desynchronize from the client that
writes it.

**No proactive throttling.** A gate would duplicate what the reactive path
handles correctly: GitHub answers an exhausted budget with a status plus
reset headers, which classifies as rate-limited and gets the server-advised
delay. A consumer that wants to pace itself has the snapshot and can build
a gate.

**No dependency edge to `@effected/commands`' retry vocabulary.** That
module classifies a subprocess failure over a subprocess transport; this
one classifies an HTTP failure over HTTP. What the two packages share is a
convention — each owns "which of my failures are transient", exposes it,
and lets the caller compose the retry.
