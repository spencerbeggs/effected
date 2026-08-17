---
"@effected/github-references": minor
---

## Features

Four additive surfaces layered onto the grammar shipped in the first release.

### Inline lists

`harvestReferenceLists` generalizes the closing-list grammar to running prose: several lists can appear on one line (`Closes #123, Fixes #456` yields two), no colon, keywords from either set matched by word boundary, and a list cannot continue past a newline. An issue number past `Number.MAX_SAFE_INTEGER` anywhere in a candidate skips the whole match rather than yielding a partial list. Each hit is a `HarvestedReferenceList` — a `ReferenceList` widened with `start`/`end` offsets over the matched extent.

```ts
import { harvestReferenceLists } from "@effected/github-references";

harvestReferenceLists("Closes #123, Fixes #456 while we're at it");
// [
//   { keyword: "closes", closing: true, issueNumbers: [123], start: 0, end: 11 },
//   { keyword: "fixes", closing: true, issueNumbers: [456], start: 13, end: 23 },
// ]
```

### Per-line text helpers

`parseBareLines`, `parseClosingLists` and `parseReferenceLists` apply their single-line counterparts (`parseBareLineReference`, `parseClosingList`, `parseReferenceList`) across a whole multi-line text, collecting the accepted hits in line order. Rejected lines contribute nothing, and results carry no line numbers — a consumer that needs positions keeps its own split loop.

```ts
import { parseReferenceLists } from "@effected/github-references";

parseReferenceLists("Closes #1\nnot a reference\nRefs: #2, #3");
// [
//   { keyword: "closes", closing: true, issueNumbers: [1] },
//   { keyword: "refs", closing: false, issueNumbers: [2, 3] },
// ]
```

### Collected reference lists

`collectReferenceLists` reads a whole text line by line across both postures: a line that parses as a whole-line reference list (colon-tolerant) contributes it, and any other line is harvested inline (no colon). The preference means a colon-less trailer line is never counted once per posture. Results carry no offsets — this is the line-granular composition consumers were hand-rolling to interleave trailer parsing with prose harvesting.

```ts
import { collectReferenceLists } from "@effected/github-references";

collectReferenceLists("Fixes: #10\nprose mentioning closes #11");
// [
//   { keyword: "fixes", closing: true, issueNumbers: [10] },
//   { keyword: "closes", closing: true, issueNumbers: [11] },
// ]
```

### Keyword families

`keywordFamily` collapses any of the twelve keywords across both sets to one of four `KeywordFamily` stems (`"close"`, `"fix"`, `"resolve"`, `"ref"`), replacing the `startsWith` heuristics downstream consumers were hand-rolling to categorize harvested references. The projection is an explicit `Record` over the full keyword union, so a keyword added to either set without a family entry is a compile error.

```ts
import { keywordFamily } from "@effected/github-references";

keywordFamily("resolved"); // "resolve"
keywordFamily("refs"); // "ref"
```
