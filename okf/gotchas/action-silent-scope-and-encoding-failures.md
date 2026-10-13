---
type: Gotcha
title: A scope-qualified filter, a version-only sort, and a plain Redacted all fail silently
description: Three call sites that look like they return an ordinary empty or degraded result actually mean "this call was answered wrong" — a bare ref against a fork PR, a semver-only tag comparison, and Schema.Redacted's default encoded literal.
status: stable
resource: ../../packages/github/src/PullRequest.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 887857fff3784460
---

# A scope-qualified filter, a version-only sort, and a plain Redacted all fail silently

## What a reader sees

Three unrelated-looking calls each return a plausible, well-typed result
with nothing marked as an error: `PullRequest.list({ head })` returns an
empty array; a tag-listing sort by SemVer produces "the latest" tag
without complaint; and a value passed through `Schema.Redacted` round-trips
through JSON as a string.

## What they would wrongly conclude

That an empty pull-request list means there is genuinely no matching pull
request; that the SemVer-sorted "latest" tag is also the most recently
created one; and that persisting a `Schema.Redacted`-typed field and
reading it back preserves the secret it wrapped.

## What is actually true

Each is a real trap with a real fix, not a hypothetical:

- **`PullRequest.list({ head })` wants a qualified `owner:ref`.**
  `PullRequestInfo.head` — the bare ref this method's own return type
  hands back — round-trips correctly only for a pull request opened from
  the *current* repository. For a fork-originated pull request, qualifying
  a bare ref with the current repo's owner names a branch in the wrong
  account, so the filter matches nothing and the call returns an empty
  list rather than an error.[^pr-list] When the head may live in a fork,
  build the qualified `owner:ref` from the source owner, never from
  `PullRequestInfo.head` alone.
- **A tag list sorted purely by SemVer ignores recency.** Ordering release
  tags by version number, with no tie-break on creation time, silently
  picks a "latest" that can be older than a tag it outranks numerically —
  which pins a monorepo release boundary backwards without any typed
  failure to catch it.
- **`Schema.Redacted` does not survive serialization by design**, so a
  naive `Schema.Redacted(Schema.String)` field encodes to the literal
  string `"<redacted>"` rather than the real value — persisting through it
  across a process boundary round-trips something useless. The fix is
  `Schema.RedactedFromValue`, which decodes to `Redacted` and encodes back
  to the real string, with masking left as the caller's explicit
  job.[^redacted-from-value]

## The check

Trace every "empty result" or "successfully persisted" outcome back to
what was actually compared or encoded before trusting it:

- For a pull-request lookup that might involve a fork, build the
  `owner:ref` explicitly rather than trusting a bare-ref round trip.
- For "the latest release", confirm whether the comparison is by version
  or by recency, and add an explicit tie-break if recency matters.
- For any field that must survive a `pre`/`main`/`post` state boundary or
  similar round trip, use `Schema.RedactedFromValue` (or an equivalent
  explicit encode) rather than a bare `Schema.Redacted`, and mask the
  decoded value at the point it is logged.

[^pr-list]: `packages/github/src/PullRequest.ts:102-123` — the `list`
    method's own doc comment states the fork-qualification hazard on the
    `head` option.
[^redacted-from-value]: `packages/github/src/GitHubApp.ts:85-101` —
    `InstallationToken.token` uses `Schema.RedactedFromValue` specifically
    because it must survive `Schema.encodeUnknownEffect` across the
    `GITHUB_STATE` process boundary; a bare `Schema.Redacted` would not.
