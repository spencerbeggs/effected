---
"@effected/workspaces": minor
---

## Breaking Changes

* On an npm root, `WorkspaceDiscovery`, `getWorkspacePackagesSync` and `WorkspaceSnapshots` now read `package.json#workspaces` the way npm does, through `@effected/npm`'s `NpmWorkspacePatterns`. Before, they read it as a `GlobSet`. A root is npm's when package-manager detection says so. pnpm, yarn and bun roots keep `GlobSet`. The two readings differ in four ways, and npm's answer is what npm installs:
  * Negations are ordered. In `["packages/*", "!packages/a", "packages/a"]` the later positive puts `packages/a` back.
  * A trailing `/` is ignored, on a positive (`packages/*/`) and on a negation (`!packages/a/`).
  * An even run of `!` is a positive, so `!!packages/a` declares `packages/a`.
  * A backslash is a separator, so `packages\a` declares `packages/a`.
* On an npm root, a `workspaces` field past one of `NpmWorkspacePatterns`' ceilings now fails, where the `GlobSet` reading used to accept it. The ceilings are 1,000 patterns, 32 wildcard patterns, 256 brace alternatives and 256 characters for a matched pattern. Discovery and the sync facade fail with `WorkspacePatternError` (kind `uncompilable`) and `WorkspaceSnapshots.at` with `CatalogAssemblyError`, as an uncompilable pattern set already did. The error unions are unchanged.

## Features

* `WorkspacePatternError` has an optional `cause`. When the kind is `uncompilable`, it carries the typed error that stopped the read: glob's `GlobPatternError`, or `NpmWorkspacePatternsError` on an npm root.
