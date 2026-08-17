# @effected/github-references

[![npm](https://img.shields.io/npm/v/@effected%2Fgithub-references?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/github-references)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

GitHub's issue-reference grammar as pure functions: the nine closing keywords in the three dialects real tools write — inline in prose, one reference per line, and a whole line naming several issues at once. Strings in, values out. No service, no layer, no client, no network, and no octokit anywhere in the dependency graph: `effect` is the only peer and there are no runtime dependencies at all.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/github-references

Deciding which issues a pull request closes is a grammar question, not an API call, and the answer is usually re-derived from memory in a one-line regex. That regex is where the bugs live: accept a colon inline and you harvest references GitHub will not link, so your pipeline reports an issue as closing that merging leaves open. Accept `closes 123` without the `#` and you report a link GitHub never made. Read `Closes #1, #2 and #3` with a parser built for one reference per line and you silently see the first issue and lose the rest.

This package is that grammar written once, with the disagreements resolved on purpose rather than by whoever copied the regex last. Each dialect is a separate function because each has a distinct producer: prose is written by humans for GitHub's own scanner, and a generated references region is written by tooling for humans. The functions are pure and synchronous — no `Effect`, no layer to provide, nothing to stub in a test — so a release script, a lint rule, a commit-message check and an Action can all speak the same grammar without any of them installing a GitHub client.

## Install

```bash
npm install @effected/github-references effect
```

```bash
pnpm add @effected/github-references effect
```

Requires Node.js >=24.11.0.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`effect` v4 is the only peer dependency and there are no others of any kind. `Option` is the only part of `effect` the surface touches, and nothing here runs an effect, so every function is callable from ordinary synchronous code.

## Quick start

Harvest references out of a pull request body, then read a generated line that names several issues:

```ts
import { harvestIssueReferences, parseClosingList } from "@effected/github-references";

console.log(harvestIssueReferences("Fixes #12 and closes #13."));
// [ { issueNumber: 12, keyword: "fixes", start: 0, end: 9 },
//   { issueNumber: 13, keyword: "closes", start: 14, end: 24 } ]

console.log(parseClosingList("Closes #247, #248 and #251"));
// Option.some({ keyword: "closes", issueNumbers: [247, 248, 251] })
```

## Inline in prose

`harvestIssueReferences` reads the **inline-in-prose** dialect: one of the nine closing keywords in `CLOSING_KEYWORDS`, mandatory whitespace, then `#<number>`, anywhere in the text, case-insensitive, and **no colon** — that is the spelling GitHub itself scans a pull request body for. Every hit carries `start` and `end` offsets into the input, so a caller can underline the match, strip it, or rewrite it in place.

```ts
import { harvestIssueReferences } from "@effected/github-references";

console.log(harvestIssueReferences("closes: 123 and fixes #9"));
// [ { issueNumber: 9, keyword: "fixes", start: 16, end: 24 } ]
// — the colon spelling is not the inline dialect, and `123` has no `#`
```

Duplicates come back as written, because whether `fixes #1, fixes #1` means one intent or two is the caller's question. This is the dialect a release pipeline harvests from commit subjects and pull request descriptions.

## Bare lines

`parseBareLineReference` reads the **bare-line** dialect: after trimming, the whole line *is* the reference, the colon is optional, and anything left over rejects the line. That is the shape a generated references block writes, one reference per line. There are no offsets, because in a dialect where the line is the reference an offset would restate a constant.

```ts
import { parseBareLineReference } from "@effected/github-references";

console.log(parseBareLineReference("Closes: #12"));
// Option.some({ issueNumber: 12, keyword: "closes" })

console.log(parseBareLineReference("closes #12 for real"));
// Option.none() — the bare-line dialect takes the whole line or nothing
```

## Closing lists

`parseClosingList` reads one whole line naming several issues under a single keyword. Items are `#<digits>` separated by a comma, by `and`, or by the Oxford `, and`, and the keyword's colon is optional as in the bare-line dialect.

```ts
import { parseClosingList } from "@effected/github-references";

console.log(parseClosingList("Fixes #1, #2, and #3"));
// Option.some({ keyword: "fixes", issueNumbers: [1, 2, 3] })

console.log(parseClosingList("Closes #1 and please review"));
// Option.none() — trailing prose rejects the line rather than parsing a prefix
```

`parseReferenceList` is the wider reading of the same line. It additionally accepts the non-closing `REFERENCE_KEYWORDS` — `ref`, `refs`, `references` — which associate an issue without closing it, and reports which set matched through a `closing` flag. `parseClosingList` is the closing-only view of exactly that engine, so a `Refs:` line is `Option.none()` there and `closing: false` here:

```ts
import { parseClosingList, parseReferenceList } from "@effected/github-references";

console.log(parseReferenceList("Refs #7, #8"));
// Option.some({ keyword: "refs", closing: false, issueNumbers: [7, 8] })

console.log(parseClosingList("Refs #7, #8"));
// Option.none() — a reference list, but not a closing one
```

## Grammar rules worth knowing

- **The `#` is mandatory in every dialect.** `closes: 123` is not a reference; GitHub does not link it, and a parser that accepts it reports links that were never made.
- **The list dialects are whole-line.** Same-line whitespace is `[ \t]` only, so an embedded newline cannot smuggle a second line past a parser whose contract is one line, and trailing content rejects the line instead of yielding a partial reading.
- **Duplicates are preserved, in order.** Whether `#12, #12` means one issue or two is the caller's business; collapsing them would destroy evidence a caller may be linting for.
- **Keyword case does not matter, and the result is canonical.** `CLOSES`, `Closes` and `closes` all match, and `keyword` always comes back lowercased.
- **Unsafe issue numbers are treated differently on purpose.** Digits past `Number.MAX_SAFE_INTEGER` make the prose harvest *skip that one match*, while the list dialects reject the *whole line*: surrounding prose makes no claim about a skipped number, but a list line is a single claim about a set of issues that a partial result would misrepresent.
- **No input is truncated and no length cap applies.** The list dialect is parsed by a single character-by-character scan — no regular expressions at all — so a hostile line cannot trigger catastrophic backtracking and there is nothing to defend with truncation.

## Out of scope

Cross-repo references (`owner/repo#12`) and full-URL references (`https://github.com/owner/repo/issues/12`) are real GitHub spellings that this package does not read yet — guessing at their shape would freeze an API nobody has driven. Issue *state* is out of scope too, because state is not grammar, and anything that asks GitHub a question belongs to [`@effected/github`](https://www.npmjs.com/package/@effected/github).

## Coming from @effected/github

The grammar used to live in `@effected/github`, which still re-exports exactly the six original names — `CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference` — so code written against the old home keeps compiling. That re-export is a compatibility shim and may be dropped at a later `@effected/github` release; the closing-list surfaces are deliberately not part of it. Import from this package instead, and drop the `@effected/github` dependency entirely if the grammar is all you wanted from it.

## Features

- `harvestIssueReferences(text)` — every inline closing reference in running text, in document order, each with `issueNumber`, canonical `keyword` and `start` / `end` offsets.
- `parseBareLineReference(line)` — the one reference a whole trimmed line carries, colon optional, as an `Option`.
- `parseClosingList(line)` — the issues a whole line names under one of the nine closing keywords, comma-, `and`- or Oxford-separated.
- `parseReferenceList(line)` — the same line under the closing *and* non-closing keyword sets, reporting which matched through a `closing` flag.
- `CLOSING_KEYWORDS` / `ClosingKeyword` — the nine keywords GitHub acts on, and the type of one of them.
- `REFERENCE_KEYWORDS` / `ReferenceKeyword` — the three non-closing keywords that associate without closing.
- `IssueReference`, `BareLineReference`, `ClosingList`, `ReferenceList` — the result types, one per dialect reading.

## License

[MIT](LICENSE)
