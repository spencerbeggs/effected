---
"@effected/github": patch
---

## Bug Fixes

* `GitHubIssue`'s REST calls now pin `x-github-api-version: 2026-03-10`, eliminating the `Deprecation` header warning `@octokit/request` was printing straight to consumer workflow logs under the previous default calendar version.
