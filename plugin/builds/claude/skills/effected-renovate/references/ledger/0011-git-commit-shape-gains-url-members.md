---
id: "0011"
title: "GitCommitShape gains two required members, breaking hand-rolled GitCommit doubles"
kind: breaking
shows: typed
applies:
  "@effected/github": ">=0.29.0"
detect: ["GitCommitShape", "Layer\\.succeed\\(GitCommit"]
changesets: ["github-commit-urls"]
---

`GitCommitShape` gained two required members that return the new commit with its URL. A test double written as a `Layer.succeed` of the whole shape stops typechecking; the compiler finds each one.

Replace each hand-rolled double with `GitCommit.makeTest`, which already covers the new members, or add the two members to the double. `createCommit` and `commitFiles` are unchanged. Check the installed `.d.ts` for the member names.
