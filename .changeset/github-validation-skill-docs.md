---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

- The `github-api` and `effected-packages` skills now teach `GitHubError`'s `validation` entries and the `hasValidationCode` predicate, so 422 recovery branches on GitHub's validation code rather than on `reason` text.
- The `@effected/github` construct index lists `GitHubValidationCode` and `GitHubValidationEntry`.
