---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

- The workspaces reference no longer teaches the sync facade as the workaround for a version-less root; `WorkspacePackage.version` is optional and `getWorkspacePackagesSync` reports skips through `onSkip`.
- The secrets reference's comment stripper example uses the safe lines-then-blocks order, matching the structural-checks rule it cites.
