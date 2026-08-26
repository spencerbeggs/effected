---
"@effected/package-json": minor
---

## Features

### `Funding` model

A new `Funding` class models npm's `funding` field. `Funding.FromField`
always decodes to an array, whichever encoding the manifest used, so a
caller crediting maintainers never branches on arity; `url` is required.

```ts
import { Funding } from "@effected/package-json";
import { Schema } from "effect";

const entries = await Schema.decodeUnknownPromise(Funding.FromField)("https://example.com/sponsor");
entries[0]?.url; // "https://example.com/sponsor"
```

### `Repository.directoryUrl`

`Repository` gains `directoryUrl` — a monorepo member's own subdirectory URL
on GitHub/GitLab/Bitbucket. Falls back to `browseUrl` when there is no
`directory`, and returns `Option.none()` for an unrecognized host or a `..`
escape.

### `licenseExpressionOf`

A new `licenseExpressionOf(license: SpdxLicense) => Option<SpdxExpression>`
turns a branded manifest license into a parsed `@effected/spdx` expression,
returning `Option.none()` for npm's `UNLICENSED` and `SEE LICENSE IN <file>`
spellings.

## Bug Fixes

`Repository` and `Bugs` replayed their remembered object wire unconditionally
on encode, so an instance edited in place after decoding re-encoded as the
stale original and the edit was silently discarded. Both now carry
faithfulness guards matching `Person`'s; the string branches were always
guarded, only the object branches were affected.
