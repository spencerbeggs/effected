# @effected/github-references

## 0.2.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.1.0

### Features

- Four additive surfaces layered onto the grammar shipped in the first release.
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

* First release. GitHub's issue-reference grammar as pure functions — strings in, values out, no service, no layer, no client. Extracted from `@effected/github` so a consumer with no octokit can speak the grammar without pulling in that install weight.
  ### Three dialects
  - **Inline-in-prose** — `harvestIssueReferences` scans running text (`fixes #12 and closes #13`); whitespace mandatory, no colon, each hit carries offsets.
  - **Bare-line** — `parseBareLineReference` takes a whole trimmed line as the reference (`Closes: #12`); colon optional, no offsets.
  - **Closing-list** (new dialect) — `parseClosingList` / `parseReferenceList` read one whole line naming several issues at once, separated by `,`, `and`, or the Oxford `, and`:

  ```ts
  import { parseClosingList, parseReferenceList } from "@effected/github-references";
  import { Option } from "effect";

  parseClosingList("Closes #247, #248 and #251");
  // Option.some({ keyword: "closes", issueNumbers: [247, 248, 251] })

  parseReferenceList("Refs: #12, #13");
  // Option.some({ keyword: "refs", closing: false, issueNumbers: [12, 13] })
  ```
  `REFERENCE_KEYWORDS` (`ref`, `refs`, `references`) is a separate, non-closing keyword set — GitHub does not act on these, but a references region writes them. `parseReferenceList` reports whether the matched keyword closes via its `closing` flag; `parseClosingList` is the closing-only view, returning `Option.none()` for a non-closing keyword.

  Grammar rules: `#` is mandatory, whitespace inside the line is `[ \t]` only (no embedded newlines), duplicates are preserved, and an issue number past `Number.MAX_SAFE_INTEGER` rejects the whole line (unlike the prose harvest, which merely skips the one match).

  Peers on `effect` only — zero runtime dependencies.
