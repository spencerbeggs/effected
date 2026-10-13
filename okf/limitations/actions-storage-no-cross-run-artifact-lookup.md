---
type: Limitation
title: There is no cross-run artifact lookup
description: The artifact module cannot fetch an artifact produced by a different workflow run; the API exists on GitHub's side but has no call site shaping it here yet.
status: stable
bounds: ../interfaces/actions-storage.md
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 065e7c258e797312
---

# There is no cross-run artifact lookup

## Condition

A consumer of `@effected/github-actions`' artifact module
(`packages/github-actions/src/Artifact.ts`) wants to download an artifact
that a **different** workflow run produced, rather than one from the
current run.

## Symptom

No member of the artifact module supports this. A consumer looking for a
cross-run lookup finds nothing to call — there is no typed
"not implemented" refusal, no stubbed method, no placeholder signature to
discover through autocomplete.

## Why this is acceptable

A parameter whose only behaviour would be a typed "not yet implemented"
refusal is a surface that answers no question, so shipping one ahead of a
real need was rejected deliberately. The module is also **provisional**
in a way the rest of the package is not: it has no call site shaping its
design today. The near-miss that reads like a precedent for one — a
storage record living on a different GitHub API, one import line away and
differing only by a suffix — is recorded specifically so this absence is
not re-litigated from the same confusion a future reader is likely to
have.

Adding cross-run lookup once a real consumer needs it is additive to the
module's surface; shipping a speculative version now and later removing
or reshaping it would not be, since a consumer might already depend on
its exact shape.

## What the fix would take

The first consumer with a genuine cross-run lookup need is the one whose
feedback should shape the addition. If it arrives, its token field must
be typed as a `Redacted` value rather than a bare string, per this
package's [declassification seam](../interfaces/actions-runtime.md#secrets-the-declassification-seam) —
a cross-run token is a credential, and this package already has the seam
for declassifying one.
