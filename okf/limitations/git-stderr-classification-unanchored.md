---
type: Limitation
title: Git error classification uses unanchored substring matching on stderr
description: A path or ref name that literally contains one of the classification phrases could theoretically misclassify; anchoring is deferred until a real collision is observed.
status: stable
bounds: ../decisions/git-classification-happens-once.md
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: c26da2ba09b0ab21
---

# Git error classification uses unanchored substring matching on stderr

## Condition

`@effected/git`'s `classify` step (`packages/git/src/Git.ts`) recognizes
git's domain-specific failures — an unknown ref, a non-fast-forward push
rejection, a dirty-worktree refusal — by matching known phrases as
**unanchored substrings** against stderr pinned to `LC_ALL=C`. A
repository, branch, tag, path or remote name that happens to literally
contain one of these phrases as a substring can trigger this condition.

## Symptom

If a git operation fails for an unrelated reason but the failing
command's stderr happens to contain a phrase from
`UNKNOWN_REF_PATTERNS` or one of the other pattern sets — for instance
because a ref or path name embeds one of those words — `classify` could
in principle route the failure to the wrong typed error (an `UnknownRefError`
for something that was not actually an unresolved ref, or similarly for
the push/merge classification kinds). No such collision has been observed
in practice; this describes a theoretical exposure surface pinned by the
package's own documentation rather than an incident that has occurred.

## Why this is acceptable

Anchoring the matches more precisely (to a specific position in the
stderr line, or to the exact message shape git emits) would add
complexity to every pattern set for a collision that has not been
observed. `LC_ALL=C` pins the message language so at least the risk is
confined to phrases that could appear in a name someone chose, rather
than to translated text varying by locale. The tradeoff is recorded
explicitly in the package's own source comment above
`UNKNOWN_REF_PATTERNS`, precisely so a future reader treats it as a known
and accepted risk rather than rediscovering it as a suspected bug.

## What the fix would take

Anchoring each pattern to a specific structural position in git's stderr
output — for example requiring the phrase to appear as a whole line, or
immediately following a known prefix git always emits for that failure
class — rather than matching it as a substring anywhere in the text. This
is deferred until a real collision is observed in practice, because
tightening every pattern preemptively risks the opposite failure: a
pattern anchored too strictly against an assumption about git's exact
wording that a future git version quietly changes, causing the
classification to stop firing at all.
