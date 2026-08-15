---
"@effected/app": patch
---

## Documentation

### The effected plugin's skills carry the 2026-08-14 release-wave learnings

Six additions distilled from the consumer-unblock wave, each placed at the trigger where an agent hits it:

- `github-api` documents REST calendar versioning: the header-less default rides the deprecated `2022-11-28` version, the per-route octokit warning misreads as a route deprecation, and a package-wide pin is unsafe until removed response fields are audited (an `optionalKey` read silently decodes absent).
- `effect-v4-services-layers` names the split-graph trap: two resolved copies of one `@effected` package are two service tag identities, presenting as an unprovided service rather than a version error.
- `effect-v4-source-lookup` gains the registry rung: a closed upstream issue proves nothing about published artifacts, and a repo-local grep cannot see downstream consumers — installed artifacts settle both.
- `effected-packages` indexes `@effected/memfs` with a full per-package reference, and `effect-v4-testing` routes filesystem stubbing to `MemoryFileSystem.layerWith` past a single trivially-stubbed `layerNoop` member.
- `effect-v4-planning` records that a pure, total module legitimately answers the design gate with no error channel, no services and no observability.
