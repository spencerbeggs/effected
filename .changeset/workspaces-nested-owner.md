---
"@effected/workspaces": patch
---

## Bug Fixes

### `ImportGraph.undeclared` gives a nested file to its innermost package in every order

`ownerOf` decides which package owns a file. It asked whether the file sits under a package directory, and it answered with a `..${sep}` prefix test on `path.relative`. The direct parent case answers exactly `..`, and that test read it as inside. A parent package listed after a package nested in it therefore took that package's files. A root-wide `include` then checked a nested package's files against the root manifest. The test now rejects `..` as well. Fixes a review finding on #995.