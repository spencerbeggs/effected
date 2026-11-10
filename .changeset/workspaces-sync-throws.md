---
"@effected/workspaces": minor
---

## Breaking Changes

### `getWorkspacePackagesSync` throws instead of answering no packages

The sync facade used to return an empty or fallback list when discovery failed. It now throws the Effect surface's typed errors, so a broken workspace no longer reads as a workspace with no packages:

* `WorkspaceDiscoveryError` with reason `read`, when `pnpm-workspace.yaml` exists but cannot be read, or the root `package.json` pattern source cannot be read
* `WorkspaceDiscoveryError` with reason `invalidYaml` or `invalidJson`, when either fails to parse
* `WorkspacePatternError` with reason `uncompilable`, when the patterns do not compile as one `GlobSet`

```ts
try {
  const packages = getWorkspacePackagesSync(root);
} catch (error) {
  // WorkspaceDiscoveryError | WorkspacePatternError
}
```
