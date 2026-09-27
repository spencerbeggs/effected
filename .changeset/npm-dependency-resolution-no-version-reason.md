---
"@effected/npm": minor
---

## Features

`DependencyResolutionError` gains a `reason: "mechanism" | "no-version"` field, part of #612. `reason` defaults to `"mechanism"` both at construction and when decoding an error that was encoded before the field existed, so existing callers and stored errors are unaffected. `WorkspaceResolver.versionOf` now sets `reason: "no-version"` (with no `cause`) for a workspace member whose manifest declares no `version`; every other resolution failure keeps `reason: "mechanism"` with the originating failure as `cause`. Callers should branch on `reason` rather than inspecting the cause.
