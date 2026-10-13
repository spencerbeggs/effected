---
type: Invariant
title: Secret.ts is the only place a Redacted becomes a string
description: "In @effected/github-actions, Redacted.value appears in exactly one source module, Secret.ts, whose every declassifying member masks through the runner's log filter before returning plaintext; a structural test scans src with comments stripped and asserts the set of unwrapping files is exactly that one."
status: stable
resource: ../../packages/github-actions/__test__/Secret.test.ts
tags:
  - security
  - testing
sources:
  - id: secret-module
    resource: ../../packages/github-actions/src/Secret.ts
  - id: secret-test
    resource: ../../packages/github-actions/__test__/Secret.test.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
integrity:
  generated:
    body: aa362b8282d96bfe
---

# Secret.ts is the only place a Redacted becomes a string

## The property

`Redacted.value` is called in exactly one file under
`packages/github-actions/src/`: `Secret.ts`. Every member of `Secret` that
returns plaintext — `forRunnerFile`, `forProcessEnv`, `forSigning`,
`forChildEnv` — registers the value with the runner's log filter
(`setSecret`) **before** any plaintext is returned, and `Secret.mask`
registers and stops there, so plaintext cannot be obtained in this
package without the runner's filter already knowing about
it.[^secret-module] Masking is the floor; declassification implies it.

The members are audit names over one mechanism, not four behaviours:
`forSigning` and `forProcessEnv` are `forRunnerFile` under a name that
says why the plaintext is needed. A **new** reason to hold plaintext is a
new member of `Secret`, never a `Redacted.value` call elsewhere —
`forSigning` exists because SigV4 needs raw bytes for an HMAC, and adding
it took one line.

The invariant is about where declassification happens, not about its
ordering. A detached worker inverts the ordering rather than the rule:
its stdout is a log file no runner parses, so a mask emitted inside it is
inert *and* writes the plaintext verbatim into the log. The parent masks
before the spawn via `Secret.forChildEnv` under the real layer, and the
worker composes `ActionOutputs.layerDetached`, under which `setSecret` is
a documented no-op — see
[the declassification seam](../interfaces/actions-runtime.md#secrets-the-declassification-seam).

## Why it must hold

`Redacted` cannot survive serialization by design, so every runner file,
child environment and signing call eventually needs a string. Making that
step explicit and confined is what makes it auditable: a grep for
`Redacted.value` answers the question "where can a secret leak?" with one
file. The structural test has caught two real leaks in the package's
lifetime.

## The mechanism

`__test__/Secret.test.ts` walks `src/`, **strips comments first** (line
comments, then block comments — the same order
[the reachability suite](../conventions/bundle-reachability-suite.md)
needs, and for the same reason: prose in a line comment containing `/*`
would otherwise open a phantom block that eats real code), and asserts the
set of files containing `Redacted.value` is exactly `{ "Secret.ts" }`. A
companion test asserts the guard is non-vacuous — the set is non-empty —
and two more pin the stripper itself, so a walker bug cannot turn the
assertion green by reporting nothing.[^secret-test]

Two neighbouring seams keep the invariant cheap to hold. The results
backend's runtime token is wrapped in `Redacted` at the read and leaves
only through `HttpClientRequest.bearerToken`, which accepts a `Redacted`
directly, so the Twirp path never touches the seam. And a plaintext
handoff on the far side re-enters through `Secret.adopt`, a
`Config.Redacted`, so a missing variable is a `ConfigError` naming it
rather than an empty secret that fails later as a 401.

## What would break it

A `Redacted.value` call in any other `src/` module, or an exception added
to the test's expected set. Either is the wrong fix: the right one is a
new `Secret` member with an audit name that says why the plaintext is
needed.

[^secret-module]: `packages/github-actions/src/Secret.ts` — the four
    declassifying statics, `mask`, and `adopt`, each with the TSDoc
    explaining the parent-masks-before-spawn rule for detached workers.
[^secret-test]: `packages/github-actions/__test__/Secret.test.ts` — "only
    Secret.ts unwraps a Redacted", "the guard can fail — it is asserting
    on a non-empty set", and the two comment-stripper tests.
