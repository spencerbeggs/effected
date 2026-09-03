---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - github.md
  - github-rest.md
  - github-resources.md
  - git.md
  - commands.md
---

# @effected/github — errors and resilience

## Overview

Four error classes, one classification step and one retry policy cover everything that can fail on the wire: an error for REST, one for GraphQL, one for App authentication and one raised by the pure permission comparator, each carrying the structural `kind` every recovery routes on. Classification happens at a single boundary mapper, and the retry schedule reads GitHub's own rate-limit headers.

Resilience is a package-wide property rather than a property of any one transport, which is why it sits in its own doc: no resource service retries and none sniffs a status, so the mapper and the client's policy are the only two places in `@effected/github` where a status code is read at all. [The REST surface](github-rest.md) raises most of what is classified here and [the resource services](github-resources.md) consume the discriminant; the package-wide framing, including the consumer read census that sized these errors, is in [github.md](github.md).

## Four errors, and classification happens once

The package declares one error for the REST surface, one for GraphQL, one for App authentication and one raised by the pure permission comparator. See `src/GitHubError.ts` and its siblings.

**Classification happens in exactly one place**, the boundary mapper that turns an unknown octokit throwable into a classified error; nothing else in the package inspects a status code. That mirrors [`@effected/git`](git.md#errors-classification-happens-once), whose rule is that no consumer ever string-matches stderr — here, no consumer ever sniffs a status or a message.

The load-bearing field is **`kind`**: not-found, already-exists, rejected, unauthorized, rate-limited, transport, decode. It is what replaces every string sniff, and the sizing follows what consumers actually read — a reason string, a status, an operation name and a tag — so nothing beyond those is mandatory. `operation` names the resource method or the raw route; `reason` is the human-readable field consumers interpolate; the rest are optional with ergonomic statics filling them from the value the mapper already has.

Four consequences are traceable:

- **`retryable` is derived, not stored** — the kind already carries it — while a server-advised delay survives as an **optional field** because [the retry schedule reads it off the error](#one-retry-policy-driven-by-githubs-own-headers). That is the one field with a live internal reader and no external one.
- **"Already exists" is first-class on both channels**, REST and GraphQL. It closes a consumer that lowercased a message and grepped it for two words — **and the upsert operations make even that unnecessary**: the discriminant exists so the *library* can implement upsert, and consumers should not need it.
- **A schema failure never escapes.** The decoding request and the GraphQL member normalize a decode failure into the decode kind with the schema error carried structurally, per the [error standards](../effect-standards.md#error-handling-standards).
- **Statics cover every hand-construction site**, so a consumer test that used to build an error by hand is a one-liner.

The GraphQL error keeps a structured **errors list**, because it is the one structured field a consumer reads and because GraphQL genuinely returns a list, and its operation field names the **document** rather than the literal string a predecessor passed for every call. The App error's kind distinguishes JWT, token, revoke, identity and installation failures — the JWT arm exists because a documented platform constraint produces a real, explainable failure rather than a wrapped defect: the JWT signer converts a PKCS#1 private key (which is what GitHub hands you) to PKCS#8 **only under the Node export condition**, so on another runtime a PKCS#1 key fails explicitly.

## One retry policy, driven by GitHub's own headers

There is **one** retry policy and **no rate-limit subsystem**. Several policies — one of which inevitably lacks a predicate and retries permission denials — stack on each other unpredictably, and a rate-limit gate resolved through an optional-service lookup degrades the whole feature **silently** when nobody provides it.

- **The policy is wired once, in the client layer**, so every resource inherits it and **no resource retries on its own**; a per-operation retry would be a second policy layered on the client's.
- **Only transport and rate-limited failures retry.** There is no path on which a permission denial is retried.
- **A server-advised delay wins over the computed backoff**, unless it exceeds a ceiling — in which case the error is re-failed rather than slept through, because a long rate-limit reset must surface as a failure rather than a hang. Otherwise, full jitter over an exponential bound.
- **The schedule is built with the v4 metadata-carrying step constructor**, whose step receives the failure being retried. That is the native construct for "the delay depends on the failure", so no hand-rolled recursive retry loop is needed.

**Resilience imports no error class at all.** It declares a **structural** shape — retryable, plus an optional advised delay — so one policy serves both the REST and the GraphQL error and every policy decision is testable against a two-field literal. That is also why the error lives in its own module rather than inside the client: the policy needs the error's shape and the client needs the policy.

**Rate-limit headers stay, as an observable value rather than a shared cell.** The client parses them off every response into a ref held **inside the layer's own closure**, surfaced as one effect-valued member on the client shape: mockable from a partial record, observable in tests, impossible to forget to provide and impossible to desynchronize from the client that writes it.

**No proactive throttling.** A gate would duplicate what the reactive path handles correctly: GitHub answers an exhausted budget with a status plus reset headers, which classifies as rate-limited and gets the server-advised delay. A consumer that wants to pace itself has the snapshot and can build a gate; if a second one asks, it arrives additively.

**No dependency edge to [`@effected/commands`](commands.md)' retry vocabulary.** That module classifies a subprocess failure over a subprocess transport; this one classifies an HTTP failure over HTTP. Sharing would require a cross-package error contract to buy a shared word. What the two packages share is a **convention** — each owns "which of my failures are transient", exposes it and lets the caller compose the retry — and a convention belongs in [effect-standards](../effect-standards.md), not in a package edge.
