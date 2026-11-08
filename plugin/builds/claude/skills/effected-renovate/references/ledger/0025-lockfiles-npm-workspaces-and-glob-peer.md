---
id: "0025"
title: "@effected/lockfiles: peers @effected/glob, reads npm file: directories as non-workspaces, and refuses hostile workspaces fields"
kind: breaking
shows: behavioural
applies:
  "@effected/lockfiles": ">=0.23.0"
detect: ["\"@effected/lockfiles\"", "Lockfile\\.parse"]
changesets: ["strict-workspaces-parse"]
closes: ["spencerbeggs/effected#1267"]
---

`@effected/lockfiles` now peers `@effected/glob`. Add it beside `@effected/lockfiles` (through `catalog:effected`) in every package that depends on lockfiles, and check the install raises no missing-peer warning.

- **npm `file:` directories are no longer workspaces.** npm writes a local directory exactly like a workspace link; the parser now marks a link row a workspace only when the root `workspaces` globs match it, by npm's own rules (negation by an odd count of `!`, a later positive cancels a negation, dot directories never match a wildcard). Such a directory no longer appears in `importers`, and a workspace linked twice appears once. A peer provided by a `file:` directory is checked against its version instead of counting as satisfied. Re-check any report or test that counted importers or workspaces on npm lockfiles.
- **A hostile `workspaces` field fails typed** as `LockfileParseError` at stage `validation`: more than 1,000 patterns, 32 wildcard patterns, 256 brace alternatives or 256 characters in one wildcard pattern, or a pattern glob cannot compile. Real repositories are far inside these; a tool parsing untrusted lockfiles handles the failure.

Verify by parsing a real npm lockfile with a local `file:` dependency and comparing `importers` with `npm query .workspace`. Read the installed `.d.ts` for the exact shapes.
