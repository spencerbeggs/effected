---
"@effected/bundler": patch
---

## Bug Fixes

* A CI build that fails its API Extractor pass on a forgotten export now writes the same diagnostics to `dist/prod/issues.json` as a local build of the same tree. Before, the artifact kept only the error-level entries, with no `file` or `line`, and dropped every warning.
  * The build still fails as before, with exit code 1, `buildOk: false` and `MetaGenerationError`.
  * The CI-fatal entries are listed in `errors` at error level, with their source locations.
  * In a package with several entry points, the entries after the failing one are reported too.
