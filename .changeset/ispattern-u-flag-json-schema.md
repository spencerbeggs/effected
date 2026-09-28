---
"@effected/git": patch
"@effected/github-actions": patch
"@effected/package-json": patch
"@effected/sbom": patch
"@effected/semver": patch
"@effected/templates": patch
"@effected/workspaces": patch
---

## Bug Fixes

JSON Schemas derived from this package's schemas carry their string `pattern` again. Effect's JSON Schema export emits a `Schema.isPattern` check as `pattern` only when its regular expression has the `u` flag, and without it the pattern was dropped silently, leaving a bare `{ "type": "string" }`. Decoding was never affected. Every pattern in the package now has the `u` flag, which does not change what it accepts.
