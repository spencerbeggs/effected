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
  at: 2026-10-10T00:53:24Z
  body_sha256: c889156044774fc058084e12a9adfbe65ab904cfa3e1eba9d8f6c9a75688d905
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
happens in exactly one place, the shared classifier, reached through two
boundary mappers that read the same facts: `GitHubError.fromOctokit` turns
an unknown octokit throwable into a classified error, and
`GitHubError.fromResponse(operation, { status, headers?, body? }, nowMillis)`
does the same for a raw HTTP response (header names in any case; the body's
`message` sanitized the same way; `nowMillis` required, because it turns an
absolute rate-limit reset into a delay). Nothing else in the package
inspects a status code or a message. A test records a raw response with
`GitHubFixtures.failure(...)` on the fixture client, which classifies it at
call time against `Clock`, so a test about GitHub's actual answer runs the
real classifier rather than a hand-built error.

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
- **A 422's validation entries ride on the error, not only in its kind.**
  GitHub documents six `errors[].code` values; only `already_exists` gets
  a kind of its own, and it is read from the code first because some
  endpoints (creating a release for a tag that has one) send no message
  at all. The other five classify as rejected and stay inspectable through
  the `validation` field and `hasValidationCode`. `missing` is deliberately
  not `notFound`: it names a resource the request referred to, not the one
  it acted on, and routing it there would let a not-found recovery swallow
  a bad argument.
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
carries any `JwtError` from signing (an unreadable PEM, an RSA key under
2048 bits, a runtime without WebCrypto) as a typed failure rather than a
defect. PKCS#1 keys, which is what GitHub hands you, and PKCS#8 keys both
sign on every runtime: the signer wraps PKCS#1 to PKCS#8 in-process.

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
