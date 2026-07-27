---
"@effected/npm": minor
---

## Breaking Changes

`PublishOutcome.provenanceUrl` is now a plain optional field instead of an
`Option.Option<string>`. Read it as `outcome.provenanceUrl` (possibly
`undefined`), not `Option.getOrUndefined(outcome.provenanceUrl)`.

```ts
// Before
const url = Option.getOrUndefined(outcome.provenanceUrl);

// After
const url = outcome.provenanceUrl;
```

## Bug Fixes

`NpmRegistry.version` now reads a `github-packages` target through the
packument instead of the per-version endpoint. GitHub Packages answers the
per-version route with `405` regardless of credentials, so a lookup against a
GitHub Packages registry previously failed outright. Any other registry that
answers `405` on the per-version path is retried the same way, so the fix is
not GitHub-specific.
