---
"@effected/workspaces": patch
---

## Documentation

* Records how pnpm matches a `peerDependencyRules.allowedVersions` key, measured against pnpm 11.22.0: the version qualifier on the parent is ignored and matching is by parent name, scoped to the package that declares the peer rather than to any ancestor of it. `PeerCheck` already behaved this way; the behaviour is now stated where a reader will find it
