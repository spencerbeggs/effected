---
"@effected/package-json": minor
---

## Breaking Changes

* `PackageFileTarget.path` and `ExportEntry.path` are percent-decoded, as Node resolves them (`./dist/a%20b.js` gives `a b.js`). Types targets stay as written, because TypeScript does not decode. A raw `?`, `#` or NUL in a target is refused, which is stricter than Node.

## Features

* `PackageExports` transcribes Node's `PACKAGE_EXPORTS_RESOLVE` and `PACKAGE_IMPORTS_RESOLVE`: patterns, null exclusions and array fallbacks. `resolveTypesResult` adds TypeScript's `types` and `types@` conditions, extension substitution and `typesVersions` without `exports`. `entriesResult` and `typesEntriesResult` enumerate exported subpaths (#530).
* `PackageJsonFile.exportedFiles` expands pattern exports against package files, never entering `node_modules` or following a symlink, re-resolving each candidate so null exclusions still decide.
* `Repository.slug` returns the owner and name, counting a bare `owner/name` shorthand as GitHub, as npm does.

## Bug Fixes

* A `*` match is substituted literally, as Node does: a `$&`, `$$`, `` $` `` or `$'` in a request or file name no longer reads as a replacement pattern, and `exportedFiles` no longer drops such files.
* A `main`, `types` or `typesVersions` target with a `..` that stays inside the package (`./lib/../index.js`) resolves to the normalized path, as Node loads it, instead of failing `invalidPackageTarget`. A `..` that climbs out, or any encoded or control-character dot segment, is still refused.

### Security

* Every `exports` and `imports` target is confined to the package, and substituted targets and bare imports are re-checked, so a pattern match cannot inject a forbidden segment or escape through substitution.
