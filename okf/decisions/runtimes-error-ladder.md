---
type: Decision
title: runtimes' error ladder keeps four distinctions the pipeline must not collapse
description: Structured Schema.TaggedError classes with no free-text message field, and four cases (invalid range, unresolvable default, auth method, no-match tag) that must stay separately typed.
status: stable
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 3ff971ca116bd58b
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: b8e489798c73e614
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# runtimes' error ladder keeps four distinctions the pipeline must not collapse

## Context

`@effected/runtimes`' resolve pipeline can fail for several structurally
different reasons — a malformed range, an unmatched default, an
authentication mismatch, a version that plain does not exist — and a
pipeline implementation can easily fold two of these into one answer
without anyone noticing until a caller depends on the distinction.

## Decision

The `Schema.TaggedError` classes live in `ResolvedVersions.ts` and
`GitHub.ts`. No error carries a free-text `message` field, because that
would duplicate what the structured fields already encode. Four
distinctions the pipeline must not collapse:

- **An invalid semver range surfaces as `InvalidRangeError`, not "no
  versions found."** That error belongs to `@effected/semver`, and
  consumers import it from there — the [no-barrel
  rule](../conventions/no-barrel-re-exports.md) forbids re-exporting a
  dependency's surface. Swallowing a range failure into an empty result
  would report a typo as a not-found.
- **An unresolvable *requested* default fails; an *absent* one falls
  back.** These are different questions: Node alone falls back to the
  LTS pick when no default was requested, so silently omitting an
  unmatched requested default would hand the caller LTS as though they
  had asked for it — the error is `UnresolvableDefaultError`.
- **The authentication method is passed down, not assumed**, so the
  anonymous arm is reachable and unauthenticated feeds are never
  mislabelled as token rejections.
- **The no-match error is `NoMatchingVersionError`, never
  `VersionNotFoundError`.** `@effected/semver` already exports a
  `VersionNotFoundError` with that `_tag` for a different condition, and
  both meet in this package's error channel; two classes sharing a `_tag`
  break `catchTag` routing.

## Alternatives rejected

**One generic `RuntimeResolutionError` with a `reason` field covering all
four cases.** Rejected because a caller plausibly recovers from exactly
one of these (an invalid range is a caller bug to fix; a no-match is a
legitimate "nothing satisfies this" outcome to display), and collapsing
them removes the ability to `catchTag` selectively — the same reasoning
[`github-actions`' per-reason error decision](github-actions-per-reason-tagged-errors.md)
applies to its own error classes.

## Consequences

A test asserting an error's *type* — not merely that some failure
occurred — is what catches a collapse of any of these four distinctions;
a test that only checks `Exit._tag === "Failure"` would stay green if a
raw transport error or the wrong tagged error leaked through in place of
the intended one.
