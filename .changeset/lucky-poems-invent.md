---
"@effected/workspaces": patch
---

## Performance

`WorkspaceDiscovery.getPackage` and the `workspaceResolver` layer's `versionOf` now look names up through a name index cached against the memoized package list, instead of scanning the list on every call.

- Duplicate package names still resolve to the first matching package, unchanged from the previous linear scan
