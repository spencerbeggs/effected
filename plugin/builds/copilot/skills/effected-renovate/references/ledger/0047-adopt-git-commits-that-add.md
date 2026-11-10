---
id: "0047"
title: "Git.commitsThatAdd finds the commit that added each path, replacing @changesets/git's getCommitsThatAddFiles"
kind: adopt
shows: none
applies:
  "@effected/git": ">=0.31.0"
detect: ["getCommitsThatAddFiles", "@changesets/git", "--diff-filter=A", "deepenCloneBy", "isRepoShallow"]
changesets: ["git-commits-that-add"]
---

Offer this to the user; never apply it unasked. It fits code that credits a changeset or changelog line with the commit that added a file: a call to `@changesets/git`'s `getCommitsThatAddFiles`, or a hand-rolled `git log --follow` that takes the oldest entry.

- `Git.commitsThatAdd(cwd, paths)` returns one `Option` of a sha per path, aligned with `paths`. `Option.none()` replaces upstream's `undefined` for a path no commit added. Renames are followed.
- Taking the oldest `log --follow` entry credits the boundary commit in a shallow CI checkout. Replace it with this lookup, which never does that.
- In a shallow clone the default is to fail with `ShallowHistoryError`, naming the paths whose adding commit is behind the boundary. Upstream always deepens instead. To match it, pass `deepen: { by: 50 }`. That runs `git fetch --deepen` against `origin` (or `deepen.remote`) for up to `deepen.maxRounds` rounds, default 20, so the checkout needs fetch credentials. Ask the user before turning it on in CI, since it fetches from the network and changes the clone.
- A path that has left the working tree now resolves to the commit that added it, where upstream answered `undefined`. Check any caller that relied on that.

Check the installed `.d.ts` for the exact shapes. Verify by running both lookups over the changeset files of a full checkout and of a `git clone --depth 1` checkout with deepening on, and comparing the shas.
