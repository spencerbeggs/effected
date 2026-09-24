---
type: Convention
title: State which count moved and why, whenever a gate's number changes
description: "Three of this repository's gates are assertions that a number did not change unexpectedly; when one moves, name the count and the reason in the report, or an unexplained change is indistinguishable from a regression."
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - testing
  - ci
  - dx
sources:
  - id: turbo-json
    resource: ../../turbo.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T05:36:02Z
  body_sha256: 64149521eea6ed5655aeb5288c1858c2a5a8f028764674a2621eaba44da270a5
---

# State which count moved and why, whenever a gate's number changes

Three of this repository's gates work by asserting that a number did
**not** change: the `suppressed:` count in `dist/<target>/issues.json`
(where `suppressed: 0` usually means a build gate never actually ran, see
[a turbo cache hit reads like a fresh
build](../gotchas/turbo-cache-hit-replays-clean-log.md) and [running the
bundler script directly](../gotchas/direct-prod-build-fakes-a-clean-gate.md)
for the two ways that number can lie), the `Tests:` line a vitest run
reports (see [a vitest positional filter is a substring match, and a package-dir run never loads the root config](../gotchas/vitest-positional-filter-is-cwd-relative.md)
for how a filter miss reports the same `0/0` shape as an empty suite),
and `packages.length`-style assertions in fixture tests. Each has
independently caught a silently wrong answer in this repository's
history.

Each also shares one weakness: **the number lives in one place and its
reason lives in another**, so a diff by itself cannot say whether a moved
count is a regression or a correct consequence of the change under
review. A `suppressed:` count that drops from 3 to 0 could mean three
warnings were fixed, or it could mean the build never ran and the file is
stale — the number alone does not distinguish them.

The discipline that closes that gap: **when a count moves, state which
count and why, in the report.** An unexplained count change is a finding
to investigate, not noise to wave past. When adding or changing a count
gate, write next to it what would have to be true for the number to
change legitimately, so a future reader has the reason at hand instead of
having to reconstruct it from the diff alone.
