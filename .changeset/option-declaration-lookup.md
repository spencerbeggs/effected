---
"@effected/markdown": minor
---

## Breaking Changes

`SchemaResolver.declarationOf(data)` now follows the lookups-return-`Option` rule.

* Default overload: `Result<Option<SchemaDeclaration>, SchemaDeclarationInvalidError>`, previously `Result<SchemaDeclaration | undefined, Invalid | Missing>`. A missing declaration is `Option.none()` and no longer an error.
* With `requireDeclaration: true`: `Result<SchemaDeclaration, Invalid | Missing>`, for callers that want absence to fail.

Callers that tested for `undefined` must match on the `Option`; callers that handled the missing-declaration error on the default path should use `requireDeclaration: true`.
