---
id: "0014"
title: "New helpers replace local code: VersionSpecifier, insertAfter, createParents, literalPrefix, Sgr, platformFree, headingSlugs, extglobBang"
kind: adopt
shows: none
applies:
  "@effected/semver": ">=0.22.0"
  "@effected/jsonc": ">=0.24.0"
  "@effected/package-json": ">=0.30.0"
  "@effected/glob": ">=0.19.0"
  "@effected/env": ">=0.11.0"
  "@effected/workspaces": ">=0.43.0"
  "@effected/markdown": ">=0.27.0"
  "@effected/github": ">=0.29.0"
---

Offer these to the user; never apply them unasked. Each replaces a shape that consumers wrote by hand.

- **`VersionSpecifier`** (`@effected/semver`). A hand-rolled regex for a dependency specifier of one operator and one complete version can use it. It rejects compound ranges, partial versions and wildcards.
- **`insertAfter` and `createParents`** (`@effected/jsonc` modify options, and `@effected/package-json`'s edits). Local code that finds a sibling to place a key after, or creates missing parent objects, can use them.
- **`GlobPattern.literalPrefix`** (`@effected/glob`). A local helper that finds the literal leading directories of a glob can use it. Under `nocase` it is not a safe walk root on a case-sensitive filesystem.
- **`extglobBang`** (`@effected/glob`, opt-in). Use it to read a leading `!(` as the extglob, as picomatch does.
- **`Sgr`** (`@effected/env`). `picocolors`, or a hand-written regex that strips SGR escapes, can use `Sgr.paint` and `Sgr.strip`.
- **`SourceBoundary.platformFree`** (`@effected/workspaces`). A hand-written boundary rule that bans Node built-ins and `@effect/platform*` can use it.
- **`MarkdownDocument.headingSlugs`** (`@effected/markdown`). A local slugger for heading anchors can use it; parity is with `github-slugger`.
- **`Effect.timeout` around `@effected/github` calls** is safe: interrupting a request aborts its fetch.

Read the installed `.d.ts` for each signature before proposing a change.
