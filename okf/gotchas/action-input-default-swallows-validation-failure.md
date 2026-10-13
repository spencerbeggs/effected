---
type: Gotcha
title: A validation failure on an absent input silently resolves to the default
description: "Config.withDefault built over a missing-data classification swallows a validation error the same way it swallows a genuinely absent input — dry-run: yes silently becomes false."
status: stable
resource: ../../packages/github-actions/src/ActionInput.ts
stale_after: "2027-01-13T00:00:00Z"
tags:
  - security
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e15d4a54dcdeaeb2
---

# A validation failure on an absent input silently resolves to the default

## What a reader sees

A workflow author writes `dry-run: yes` intending to opt into a
boolean-flag input — the wrong literal for a boolean `Config` schema,
which expects `true`/`false`. The action runs to completion with no
error, no warning, and every mutation the workflow author meant to
rehearse actually happens, exactly as if `dry-run` had been left unset.

## What they will wrongly conclude

That the input was read correctly and defaulted safely — the same "empty
and unset are both missing" rule `@effected/github-actions` uses
everywhere else in `ActionInput`, behaving exactly as documented. Nothing
in the output distinguishes "the workflow never set this input" from "the
workflow set this input to a value that failed to parse."

## What is actually true

`Config`'s `withDefault` combinator is built on Effect v4's classification
of a failure as *missing data*, and an issue constructed with an absent
**actual** value — which is what a validation failure on a value that
never parsed produces — is classified the same way as a config key that
was never set at all. Nothing about the default combinator's signature
suggests the fallback depends on *how* the underlying failure was
constructed, so a value that failed to parse and a value that was never
present both fall through to the default. `dry-run: yes` therefore
resolves to `false`, silently, and the action performs every mutation the
"rehearsal" run was meant to skip. This is a v4 `Config` semantics trap,
not a typo in this package's code, and the issue built for the failure
does carry the offending value, which is what makes the failure
diagnosable once a reader knows to look for it.

## The check

Read the issue that a failed `Config.string`/`Config.boolean` decode
constructs before assuming a default-wrapped read degrades safely: an
issue with a present `actual` field distinguishes "this value failed to
parse" from "this key was never set," but `Config.withDefault` does not
make that distinction on the caller's behalf. `Action.run` installs an
input-aware `ConfigProvider` precisely so a bare accessor degrades to the
*correct* answer rather than to whatever default the schema declares, but
that provider does not change this classification — a value that parses
to the wrong type still resolves to the default rather than to a typed
failure. A workflow author's typo in a boolean or enum-shaped input value
is therefore only caught if the accessor's own tests specifically
construct a present-but-invalid value and assert a typed failure rather
than a defaulted success.
