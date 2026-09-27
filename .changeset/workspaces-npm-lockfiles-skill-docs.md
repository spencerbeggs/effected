---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

- The `effected-packages` reference docs and construct index now teach the `@effected/workspaces` and `@effected/npm` changes they were drifting behind: `findWorkspaceRootSync`'s new `stopAt` ceiling and `FindWorkspaceRootSyncOptions`, `WorkspaceResolver.versionOf` and `DependencyResolutionError` reporting `reason: "no-version"` for a version-less workspace member (`"mechanism"` otherwise), and `PackageStateSnapshot.version` being optional so `WorkspaceStateSnapshot.versions` lists only members that declared a version — use `package(name)` for membership instead.
