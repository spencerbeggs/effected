---
"@effected/bundler": patch
---

## Bug Fixes

* `resolveNextVersions` keeps the current versions when a pnpm-native plan releases two same-named projects, instead of letting one project's version stand for both, and logs the refusal at debug level naming the package and its directories.
