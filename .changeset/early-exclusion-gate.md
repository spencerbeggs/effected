---
"@effected/workspaces": patch
---

## Performance

Workspace enumeration now applies `packages:` exclusions as directories are accepted, rather than filtering the accumulated set afterwards. An excluded directory no longer costs a `package.json` existence probe or a map insert.

- Applies to both the async enumerator and the `getWorkspacePackagesSync` escape hatch, which stay in lockstep.
- Membership, ordering, and public API are unchanged; only when the exclusion is evaluated changed.

## Tests

- Pins that an excluded directory is still descended, so a package nested beneath it stays discovered — `!packages/private-*` rejects that one directory, never the subtree below it.
