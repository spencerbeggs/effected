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
faithfulness guards matching `Person`'s.

The **string** branches had the same class of bug, reached through the fields
the shorthand has no syntax for. A repository decoded from `"effected/kit"`
that gained a `type`, a `directory` or an unknown key re-encoded as the bare
string, dropping the addition; `Bugs` did the same for an unknown key. Both now
fall through to the object form unless the string can still carry the value,
matching `Person` and `Funding`. The `directory` case is the live one, since
this release also ships `Repository.directoryUrl` — making a bare-string
repository into a monorepo member is exactly the edit that was being lost.
