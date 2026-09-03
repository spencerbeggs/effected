---
status: current
module: effected
category: architecture
created: 2026-08-17
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - github.md
  - github-resources.md
---

# @effected/github-references design

## Overview

`@effected/github-references` is GitHub's issue-reference grammar as pure functions: the nine closing keywords, a separate non-closing reference set and three dialects that read them. Strings in, values out — no service, no layer, no client. `src/` is three modules: the two prose-and-line dialects, the list dialect with its inline form and the keyword-family projection.

It is a package rather than a corner of [`@effected/github`](github.md) because the grammar and the GitHub *client* have opposite dependency costs. The rule that [pure-but-GitHub-shaped belongs in the kit rather than in a consumer](github.md#bundle-reachability) is right, and says nothing about *which* kit package: hosting the grammar beside the client costs `github`'s own consumers nothing and costs an octokit-free consumer the whole client tree for a few lines of pure string work. The test before hosting the next pure vendor rule is not "does a client already link here" but "can the consumers most likely to re-derive it actually reach it".

## Tier and dependencies

**Pure tier.** `effect` is the only peer; zero regular dependencies ([R1](../effect-standards.md#dependency-policy)), no services, no layers, no `R` anywhere, `sideEffects: false`. The inline and bare-line dialects are regex and string work; everything in `ClosingList.ts` is a regex-free character scan.

The dependency arrow points **at** this package: `@effected/github` takes it as a regular `workspace:^` dependency, for [one reason and one only](#the-github-compat-re-export).

## Naming

`@effected/github-references`, directory `packages/github-references`. The short form `github-refs` is rejected on two counts: inside the GitHub domain "refs" is already git-refs vocabulary (`refs/heads/...`), so the short name names the wrong thing, and house style is unabbreviated.

## The three dialects

**One regex for all three is the tempting simplification and it is wrong in a way nobody would notice.** Accepting the colon inline would harvest references GitHub will *not* link, so a pipeline would report an issue as closing when merging the pull request leaves it open. The dialects differ because their **producers** differ — prose is written by humans for GitHub's scanner, a generated region is written by tooling for humans — and that is the rule to apply if a fourth dialect appears.

### Inline-in-prose and bare-line

- **Inline-in-prose** (`harvestIssueReferences`) scans running text — `"fixes #12 and closes #13"` — with mandatory whitespace and **no colon**, because that is the spelling GitHub's own scanner honours when it decides what a pull request closes. This is what a release pipeline harvests out of commit subjects and pull-request bodies.
- **Bare-line** (`parseBareLineReference`) takes the whole trimmed line as the reference — `"Closes: #12"` — with an **optional** colon, because a generated references region writes one reference per line and the colon reads better there.

Two smaller decisions ride with them: an inline reference carries **offsets** and a bare-line one deliberately does not (the line *is* the reference, so an offset would be a constant restated), and in prose a digit run outside the safe-integer range is **skipped rather than parsed**, since rounding it silently yields a different, existing issue number — the behaviour the list dialect deliberately [contrasts with](#grammar).

### The closing-list dialect

`src/ClosingList.ts` reads one whole line naming several issues — `Closes #247, #248 and #251` — and exposes two entry points over one engine:

- `parseClosingList(line)` answers a `ClosingList` — **closing keywords only**.
- `parseReferenceList(line)` answers a `ReferenceList` — the **superset**, also accepting the non-closing `REFERENCE_KEYWORDS` (`ref`, `refs`, `references`), because GitHub's linker links `Refs #N` without closing it. `closing` is the discriminator, and `parseClosingList` is the closing-only *view* of the same engine rather than a second parser.

Two functions and one grammar, because the two live call sites want different halves: a commitlint rule needs the strict closing view, a changesets harvester needs the categorized superset and a consumer that fused them would either link nothing for `Refs` or claim `Refs` closes something.

### Grammar

A **whole-line dialect**, the bare-line posture rather than the prose one — after trimming, the *entire* line must be `<keyword>[:] <ref-list>`:

- Keyword is **case-insensitive**, and the result carries the **canonical lowercase** form.
- The colon is **optional**, as in bare-line.
- Whitespace is `[ \t]` only. Embedded newlines therefore cannot smuggle a second line into a single parse — a parser told "this is one line" must not silently accept two.
- List items are `#<digits>`, separated by `,`, by `and`, or by the Oxford `, and`. At least one item is required.
- **`#` is mandatory.**
- Trailing prose **rejects the line** — a whole-line dialect that ignored a tail would report a partial reading of a line it did not actually understand.
- **Duplicates are preserved.** Deduplication is the caller's business; a parser that silently collapses `#12, #12` has destroyed evidence the caller might be linting for.
- Any item whose digits exceed `Number.MAX_SAFE_INTEGER` **rejects the whole line**. This is the deliberate contrast with `harvestIssueReferences`, which *skips* an unsafe match in prose: in prose the surrounding text is not a claim about the skipped number, but in a list a partial result misrepresents the line as referencing fewer issues than it does.

The head pattern is **derived from the two keyword constants** rather than spelled a second time, so a keyword added to either set cannot drift from the grammar that reads it — and `closing` is membership in `CLOSING_KEYWORDS`, tested once against a widened set so no call site casts.

## Drift settlements

Downstream hand-rolled copies of this grammar disagree with each other. The kit is the place that settles the disagreement, and each settlement is a ruling, not an average:

| Question | Settlement |
| --- | --- |
| Keyword set | **The canonical nine GitHub documents.** Narrower downstream variants converge upward; a consumer accepting fewer keywords than GitHub silently under-links. |
| Bare `closes: 123` | **Rejected — `#` is mandatory.** Downstream's acceptance was drift, not grammar: GitHub requires `#` for a same-repo closing reference, so accepting the bare number reports a link GitHub will not make. |
| The `Refs` category | **A separate, non-closing keyword set**, surfaced through `parseReferenceList` with `closing: false`. Folding it into the closing set was the other available answer and it is wrong for the same reason as the row above. |
| ReDoS posture | **A single left-to-right character scan** — `ClosingList.ts` contains no regular expressions at all, so worst-case time is linear by construction and **no input truncation is needed** — contrast downstream's character truncation, which is a silent semantic change (a long line's tail simply stops existing) adopted to defend a regex this package does not have. |

**One accepted behavior delta**, agreed downstream in advance: the kit's `[ \t]+` separator is tighter than their `\s+`. It is the same choice as the newline rule above — a whole-line dialect whose separator class contains newlines is not really a whole-line dialect. The [inline harvester](#the-inline-list-grammar) keeps that separator class unchanged and admits the wider `\s` set in exactly one place, the keyword-to-first-item gap, where the inline posture requires it.

## The companion surfaces

Four surfaces sit beside the dialects, all **additive** — none reopens a ruling above, and none is part of the [compat re-export](#the-github-compat-re-export):

- **`harvestReferenceLists(text)`** — the list grammar worn inline. The two original families each covered half of GitHub's real inline grammar: `harvestIssueReferences` is inline but one `#N` per match and ignores the reference keywords, while `parseReferenceList` does lists and `Refs` but whole-line only. `Closes #123, Fixes #456` on one line is a spelling GitHub links and neither read. Results are `HarvestedReferenceList` — a `ReferenceList` widened with `start`/`end` offsets.
- **`parseBareLines`, `parseClosingLists`, `parseReferenceLists`** — the per-line application every call site was writing as a `split("\n")` plus an `Option`-collect loop.
- **`keywordFamily(keyword)`** (`src/KeywordFamily.ts`) — the close/fix/resolve/ref projection consumers were spelling as `keyword.startsWith("fix")`.
- **`collectReferenceLists(text)`** — the per-line composition of the whole-line and inline postures, for a text that mixes generated trailer lines with human prose.

### The inline list grammar

`harvestReferenceLists` is the [closing-list grammar](#grammar) worn in the **inline-in-prose** posture rather than the whole-line one, so it inherits the list rules and swaps the posture rules — the same dialects-differ-because-producers-differ reasoning that [split the first two](#inline-in-prose-and-bare-line):

- The keyword is **case-insensitive** and drawn from **either** keyword set, canonical-lowercased in the result, with `closing` reported by membership in `CLOSING_KEYWORDS` — as in the whole-line parsers.
- **Word boundaries hold on both sides.** The characters immediately before and after the keyword's letter run must not be `[A-Za-z0-9_]`, spelled as an adjacency check rather than a regex `\b`, so `recloses #1` and `1closes #1` do not match.
- **No colon**, exactly like `harvestIssueReferences`: the colon spelling belongs to the line dialects, and accepting it inline would harvest links GitHub will not make.
- The **keyword-to-first-item gap is any whitespace, newlines included**, mirroring the inline dialect's `\s+`; because the module has no regexes, `\s` is spelled as a code-point predicate over the same set JavaScript means by it.
- **List continuation keeps `[ \t]` only**, so a list cannot continue past a newline — a later line makes its own claims. The two whitespace classes in one function are the point: the *gap* is prose, the *list* is a line-shaped structure.
- **A list ends at its last item.** A separator not followed by an item is prose, not grammar, and stays unconsumed: `closes #1 and fixes #2` yields `closes: [1]` then `fixes: [2]`, because ` and ` fails as a separator when what follows is not `#`.
- **An unsafe item anywhere skips the entire candidate** — never a partial list, for the same reason [the whole-line parser rejects the whole line](#grammar) — and scanning resumes after that item's extent rather than re-entering the abandoned candidate.
- **Offsets run from the keyword's first character to one past the last digit of the last item**, the inline family's convention (the whole-line results still carry none, because the line *is* the reference).

**One asymmetry is deliberate and pinned by test:** the `and` separator stays **lowercase-only** in prose, inherited from the line dialect, while the keyword is case-insensitive. `closes #1 AND #2` therefore harvests `closes: [1]`. Loosening it is a grammar change to the shared separator scanner, not a local tweak to the harvester; a consumer that hits it opens a design conversation rather than a patch.

### Per-line application

`parseBareLines`, `parseClosingLists` and `parseReferenceLists` each split on `"\n"`, apply the matching single-line parser and collect the accepted results in line order; rejecting lines contribute nothing. CRLF needs no special case because each parser already trims. They are conveniences over the parsers, not new grammar — `parseClosingLists` is the closing-only *view* of `parseReferenceLists` for the same reason `parseClosingList` is a view of `parseReferenceList`.

**No line numbers, deliberately.** Most consumers only aggregate the references, and `BareLineReference` has no position to begin with; a consumer that needs positions keeps its own split loop, which is three lines. Returning positions from the collect form would make the cheap case pay for the rare one and would invent a coordinate the underlying results do not carry.

**`collectReferenceLists` is the two per-line families composed, not a third parser.** The three helpers above are all single-posture: `parseReferenceLists` only ever reads the colon-tolerant whole-line dialect, so a text mixing generated trailer lines with human prose loses the prose half, and there is no other per-line entry point onto `harvestReferenceLists`. Per line, `parseReferenceList` is tried first — colon-tolerant, the line dialect's posture — and only a line that is not a whole-line list falls through to `harvestReferenceLists` on that same line, colon-less, the inline posture. **The preference is the whole ruling: a line that matches whole-line never also gets harvested**, so a colon-less trailer line, which is valid under both readings, contributes its list **exactly once** rather than once per posture. Results carry **no offsets**, for the same reason the other collect forms carry no line numbers — this is deliberately the line-granular composition, coarser than either source; a consumer that needs spans calls `harvestReferenceLists` directly rather than asking this function to smuggle offsets from only one of its two branches.

### Keyword families

The keywords across both sets are four stems conjugated. `keywordFamily` maps each to `"close" | "fix" | "resolve" | "ref"` through an **explicit total `Record`** keyed by `ClosingKeyword | ReferenceKeyword`, so a keyword added to either constant without a family entry is a **compile error**. That is the whole argument for the module: the downstream `startsWith("fix")` collapse is a heuristic that fails silently on a keyword nobody remembered, and a table the type system checks cannot.

The projection is a **separate function, not a field on the results**. A `family` field would be computed for every harvested reference whether or not the consumer categorizes, and would have to be added to three result shapes; a function costs the callers that want it one call and leaves the shapes alone.

## Out of scope, recorded

- **Cross-repo and full-URL references.** Neither dialect's consumers emit them, and guessing their shape would freeze an API nobody has driven.
- **Issue-state classification.** Issue *state* is not grammar; a second consumer should drive it, and the first will likely want it from the client rather than from a parser.
- **A `@changesets/get-github-info` replacement.** That is API-tier work — it queries GitHub — so it belongs to [`@effected/github`](github.md) if anywhere, never to a pure grammar package.

## The github compat re-export

`@effected/github` **re-exports exactly the six names the grammar was extracted from it under** — `CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference` — so consumers that adopted the grammar in its old home keep compiling. That re-export is the **only** reason `github` depends on this package. Two riders:

- It is **droppable at a later `github` bump**, once consumers import from the new home. It is a migration affordance, not a permanent surface.
- The closing-list surfaces and the [companion surfaces](#the-companion-surfaces) are deliberately **not** re-exported from `github`. New consumers import this package; widening the compat surface would make the re-export permanent by accident.

**The promise is a test, not a comment.** `github`'s `__test__/IssueReferencesCompat.test.ts` exercises the value exports through the entry point and annotates values with the type exports, so compiling *is* the assertion for the types. A future bump that drops the re-export deletes that suite deliberately, which is the point: the surface cannot lapse silently.

## Testing

`@effect/vitest`, `assert.*` — never `expect`; tests in `__test__/`, one file per module.

The suite carries the [drift settlements](#drift-settlements) as executable rulings rather than as prose: keyword casing and canonicalization, the optional colon, each separator form including the Oxford comma, mandatory `#` cited to its drift row, trailing-prose rejection, duplicate preservation and the whole-line rejection on an unsafe digit run sitting beside `harvestIssueReferences`'s skip-in-prose behavior for contrast. A hostility case pins the ReDoS posture — a pathological long line parses in linear time and is neither truncated nor hung on.

The companion surfaces pin their own rules the same way: the inline harvester's two whitespace classes, its word boundaries, the lowercase-only `and` asymmetry and the whole-candidate skip on an unsafe item; the per-line forms' order-preserving collection and CRLF handling; `keywordFamily` asserted **exhaustively over every keyword** rather than sampled, since totality is the point of the explicit record; and `collectReferenceLists`'s once-per-posture preference, including a colon-less line proven to contribute once rather than twice.
