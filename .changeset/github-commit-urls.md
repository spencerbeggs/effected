---
"@effected/github": minor
---

## Breaking Changes

`GitCommitShape` gains two required members, `createCommitWithUrl` and `commitFilesWithUrl`, so a hand-rolled `Layer.succeed` double stops typechecking. `GitCommit.makeTest` already covers them. `createCommit` and `commitFiles` are unchanged and still return the sha.

## Features

* `CreatedCommit` (#1207) carries the new commit's `sha` and its `htmlUrl`, taken from GitHub's reply so it has the right host on GitHub Enterprise Server.
* `createCommitWithUrl` and `commitFilesWithUrl` return a `CreatedCommit`. A reply with no `html_url` fails with a `GitHubError` that names the commit already created.

## Documentation

* Interrupting a request aborts its underlying fetch (#1217). That was already the behaviour; it is now tested and documented.
