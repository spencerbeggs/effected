---
"@effected/npm": minor
---

## Features

### npm's workspace-pattern rules

`NpmWorkspacePatterns.matcherResult` compiles a root's `workspaces` patterns by npm's own rules and fails with a typed `NpmWorkspacePatternsError`. The rules had lived in `@effected/lockfiles`; they now live here once.
