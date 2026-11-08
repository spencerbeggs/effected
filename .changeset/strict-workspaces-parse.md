---
"@effected/lockfiles": minor
---

## Features

* `@effected/glob` is a new peer dependency, used to match npm `workspaces` globs
* `LockfileDiff` reads a non-workspace `file:` link as `file:<root-relative>`, and on bun and npm reads a catalog-to-workspace entry by its specifier, as pnpm records it
* On npm, a peer provided by a `file:` directory is checked against its version

## Bug Fixes

* The npm parser marks a link row a workspace only when the root `workspaces` globs match, following npm's map-workspaces rules, so a `file:` directory is no longer an importer, and importers are deduplicated
* A hostile `workspaces` field fails typed with a `LockfileParseError` (validation) at these caps: 1,000 patterns, 32 wildcard patterns, 256 brace alternatives (exact count; a range of 100 or more values weighs its value count) and 256 characters per wildcard pattern
* A `workspaces` pattern that cannot compile fails typed, with no fallback

## Breaking Changes

Install `@effected/glob` alongside `@effected/lockfiles`, since it is now a required peer.
