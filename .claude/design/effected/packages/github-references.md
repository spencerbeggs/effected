---
status: current
module: effected
category: architecture
created: 2026-08-17
updated: 2026-08-17
last-synced: 2026-08-17
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../package-setup.md
  - ../migration-playbook.md
  - github.md
  - github-resources.md
---

# @effected/github-references design

## Overview

`@effected/github-references` is GitHub's issue-reference grammar as pure functions: the nine closing keywords, the two dialects [`@effected/github`](github.md) shipped in 0.6.0, and a third **closing-list** dialect (`Closes #247, #248 and #251`) added here. Strings in, values out — no service, no layer, no client.

It exists because the grammar and the GitHub *client* have opposite dependency costs. effected#194 shipped the grammar inside `@effected/github` (`src/IssueReferences.ts`), with extraction reserved as the cheap 0.x move if a consumer balked at the octokit install weight. savvy-web/systems#507 recorded that balk: `@savvy-web/silk-effects` has zero octokit and is the foundation dependency of three downstream packages, so adopting the grammar would have dragged `@octokit/core`, `plugin-paginate-rest`, `blakejs`, `tweetnacl` and `universal-github-app-jwt` into every install of all four — for roughly forty lines of pure regex. effected#399 is the extraction ask, driven by a live dogfood loop with savvy-web/systems.

The package was **built 2026-08-17 and is pending its first release** — the extraction, the new dialect and the [four additive follow-ups](#the-four-additive-follow-ups) two rounds of the first adoption filed all landed the same day, and the adoption that drove them ran against the workspace rather than against a published version. Everything below therefore ships in one initial surface; nothing here is a version-to-version compatibility story yet.

The judgement that put the grammar in `github` was not wrong — [pure-but-GitHub-shaped belongs in the kit rather than in a consumer](github.md#bundle-reachability), because the grammar is a *vendor rule* and every hand-rolled copy is a re-derivation of it. What the balk established is that hosting it beside the client makes the rule unreachable for exactly the consumers most likely to re-derive it.

## Tier and dependencies

**Pure tier.** `effect` is the only peer; zero regular dependencies ([R1](../effect-standards.md#dependency-policy)), no services, no layers, no `R` anywhere, `sideEffects: false`. The moved inline and bare-line dialects are regex and string work; everything in `ClosingList.ts` — the two whole-line parsers, their per-line text forms and the inline list harvester, five exports now — is a regex-free character scan.

The dependency arrow points **at** this package: `@effected/github` takes it as a regular `workspace:^` dependency (see [compatibility](#the-github-compat-re-export)).

## Naming

`@effected/github-references`, directory `packages/github-references`. The issue's first suggestion, `github-refs`, is rejected on two counts: inside the GitHub domain "refs" is already git-refs vocabulary (`refs/heads/...`), so the short name names the wrong thing, and house style is unabbreviated.

## Ask 1: the move is a straight move

`IssueReferences.ts` moved **verbatim** — a 100% rename in the diff, module name kept, its test moving with it. No API was invented on the way, no signature "improved", nothing renamed. The six names that moved are the six `github` already exported:

`CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference`.

Everything the module's header documents stays true here, including its exclusions: cross-repo (`owner/repo#N`) and full-URL (`https://github.com/owner/repo/issues/N`) references remain **out of scope**. The two-dialect rationale is unchanged, and it now lives here rather than in [github-resources.md](github-resources.md#the-closing-reference-grammar-moved-to-effectedgithub-references), which points at this doc since the move.

### The two moved dialects

- **Inline-in-prose** (`harvestIssueReferences`) scans running text — `"fixes #12 and closes #13"` — with mandatory whitespace and **no colon**, because that is the spelling GitHub's own scanner honours when it decides what a pull request closes. This is what a release pipeline harvests out of commit subjects and PR bodies.
- **Bare-line** (`parseBareLineReference`) takes the whole trimmed line as the reference — `"Closes: #12"` — with an **optional** colon, because a generated references region writes one reference per line and the colon reads better there.

**One regex for both is the tempting simplification and it is wrong in a way nobody would notice.** Accepting the colon inline would harvest references GitHub will *not* link, so a pipeline would report an issue as closing when merging the pull request leaves it open. The dialects differ because their producers differ — prose is written by humans for GitHub's scanner, the region is written by tooling for humans — and that is the rule applied when [the third dialect](#ask-2-the-closing-list-dialect) showed up.

Two smaller decisions ride along unchanged: an inline reference carries **offsets** and a bare-line one deliberately does not (the line *is* the reference, so an offset would be a constant restated), and in prose a digit run outside the safe-integer range is **skipped rather than parsed**, since rounding it silently yields a different, existing issue number — the behaviour the list dialect deliberately [contrasts with](#grammar).

Keeping the move mechanical is what makes it reviewable as a move: a straight move plus a new module is two diffs a reader can check independently, where a move-and-redesign is one diff nobody can.

### The github compat re-export

`@effected/github` **re-exports exactly the six moved names** from its entrypoint, so silk-release-action's existing imports keep working untouched — the extraction must not be a breaking change for the consumer that already adopted the grammar in its old home.

Two riders:

- The compat re-export is **droppable at a later `github` bump**, once consumers import from the new home. It is a migration affordance, not a permanent surface.
- The new closing-list surfaces are deliberately **not** re-exported from `github`. New consumers import the new package; widening the compat surface would make the re-export permanent by accident.

**The promise is a test, not a comment.** `github`'s `__test__/IssueReferencesCompat.test.ts` exercises the three value exports through the entrypoint and annotates values with the three type exports, so compiling *is* the assertion for the types. A future bump that drops the re-export deletes that suite deliberately, which is the point: the surface cannot lapse silently.

## Ask 2: the closing-list dialect

New module `src/ClosingList.ts` — the third dialect, `Closes #247, #248 and #251`, driven day-one by two savvy-web/systems call sites: a commitlint closes-trailer rule (closing keywords only) and a changesets harvester that categorizes `Closes` / `Fixes` / `Refs`.

Surface:

- `interface ClosingList { keyword: ClosingKeyword; issueNumbers: ReadonlyArray<number> }` with `parseClosingList(line): Option.Option<ClosingList>` — **closing keywords only**.
- `REFERENCE_KEYWORDS = ["ref", "refs", "references"]` / `ReferenceKeyword`, `interface ReferenceList { keyword: ClosingKeyword | ReferenceKeyword; closing: boolean; issueNumbers: ReadonlyArray<number> }` with `parseReferenceList(line): Option.Option<ReferenceList>` — the **superset**, also accepting the non-closing Refs category, because GitHub's linker links `Refs #N` without closing it. `closing` is the discriminator, and `parseClosingList` is the closing-only *view* of the same engine rather than a second parser.

Two functions and one grammar: the commitlint rule needs the strict closing view, the changesets harvester needs the categorized superset, and a consumer that fused them would either link nothing for `Refs` or claim `Refs` closes something.

### Grammar

A **whole-line dialect**, the bare-line posture rather than the prose one — after trimming, the *entire* line must be `<keyword>[:] <ref-list>`:

- Keyword is **case-insensitive**, and the result carries the **canonical lowercase** form.
- The colon is **optional**, as in bare-line.
- Whitespace is `[ \t]` only. Embedded newlines therefore cannot smuggle a second line into a single parse, matching bare-line's posture — a parser told "this is one line" must not silently accept two.
- List items are `#<digits>`, separated by `,`, by `and`, or by the Oxford `, and`. At least one item is required.
- **`#` is mandatory.**
- Trailing prose **rejects the line** — a whole-line dialect that ignored a tail would report a partial reading of a line it did not actually understand.
- **Duplicates are preserved.** Deduplication is the caller's business; a parser that silently collapses `#12, #12` has destroyed evidence the caller might be linting for.
- Any item whose digits exceed `Number.MAX_SAFE_INTEGER` **rejects the whole line**. This is the deliberate contrast with `harvestIssueReferences`, which *skips* an unsafe match in prose: in prose the surrounding text is not a claim about the skipped number, but in a list a partial result misrepresents the line as referencing fewer issues than it does.

As built, the head pattern is **derived from the two keyword constants** rather than spelled a second time, so a keyword added to either set cannot drift from the grammar that reads it — and `closing` is membership in `CLOSING_KEYWORDS`, tested once against a widened set so no call site casts.

## Drift settlements

Three downstream hand-rolled copies of this grammar disagreed with each other. The kit is the place that settles the disagreement, and each settlement is a ruling, not an average:

| Question | Settlement |
| --- | --- |
| Keyword set | **The canonical nine GitHub documents.** Narrower downstream variants converge upward; a consumer accepting fewer keywords than GitHub silently under-links. |
| Bare `closes: 123` | **Rejected — `#` is mandatory.** Downstream's acceptance was drift, not grammar: GitHub requires `#` for a same-repo closing reference, so accepting the bare number reports a link GitHub will not make. |
| The `Refs` category | **A separate, non-closing keyword set**, surfaced through `parseReferenceList` with `closing: false`. Folding it into the closing set was the other available answer and it is wrong for the same reason as the row above. |
| ReDoS posture | **A single left-to-right character scan** — the module contains no regular expressions at all, so worst-case time is linear by construction and **no input truncation is needed** — contrast downstream's 10,000-character truncation, which is a silent semantic change (a long line's tail simply stops existing) adopted to defend a regex this package does not have. |

**One accepted behavior delta**, agreed downstream in advance: the kit's `[ \t]+` separator is tighter than their `\s+`. It is the same choice as the newline rule above — a whole-line dialect whose separator class contains newlines is not really a whole-line dialect. The [inline harvester](#the-inline-list-grammar) that followed keeps that separator class unchanged and admits the wider `\s` set in exactly one place, the keyword→first-item gap, where the inline posture requires it.

## The four additive follow-ups

The package shipped as designed and the first downstream adoption — savvy-web/systems round 1 — reported **zero discrepancies** against the rulings above. What it did surface is three *additive* gaps, each filed rather than absorbed because none of them changes a ruling. All three **shipped 2026-08-17**, before the first release:

| Ticket | Gap | Shipped surface |
| --- | --- | --- |
| [effected#402](https://github.com/spencerbeggs/effected/issues/402) | **An inline, list-aware harvester.** The two shipped families each covered half of GitHub's real inline grammar — `harvestIssueReferences` is inline but one `#N` per match and ignores the reference keywords, `parseReferenceList` does lists and `Refs` but whole-line only. `Closes #123, Fixes #456` on one line is a spelling GitHub links and neither read; it was the adoption's one real breakage, worked around downstream by declaring trailers whole-line. | `harvestReferenceLists(text): ReadonlyArray<HarvestedReferenceList>`, where `HarvestedReferenceList extends ReferenceList` with `start` / `end` offsets — [grammar below](#the-inline-list-grammar). |
| [effected#403](https://github.com/spencerbeggs/effected/issues/403) | **Text-level conveniences.** All three downstream call sites opened with the same `split("\n")` + per-line parse + `Option`-collect loop. | `parseBareLines(text)`, `parseClosingLists(text)`, `parseReferenceLists(text)` — [per-line application below](#per-line-application). |
| [effected#404](https://github.com/spencerbeggs/effected/issues/404) | **A keyword-family projection.** Categorizing the keywords into close/fix/resolve families was stringly at the consumer (`keyword.startsWith("fix")`). | New module `src/KeywordFamily.ts`: `type KeywordFamily = "close" \| "fix" \| "resolve" \| "ref"` and `keywordFamily(keyword)` — [families below](#keyword-families). |

Round 1 closed with those three shipped and no ruling reopened. **Round 2** — the same consumer's next pass, still inside the open pre-release window — found a fourth gap, this time a *window* left by the first three landing separately rather than a new grammar question:

| Ticket | Gap | Shipped surface |
| --- | --- | --- |
| round 2 finding | **The colon asymmetry left no per-line composition.** The whole-line dialect is colon-tolerant, the inline harvest is colon-less [by design](#the-inline-list-grammar); the one consumer wanting both postures in the same text — trailer lines *and* prose — had no single call to reach for, because `parseReferenceLists` walks lines but never falls through to the harvester, so it could not participate in a fused read: its results carry no line identity to interleave against. The consumer kept a hand-rolled per-line interleave to get both. | `collectReferenceLists(text): ReadonlyArray<ReferenceList>` — [ruling below](#per-line-application). |

**Shipping them does not widen the [`github` compat re-export](#the-github-compat-re-export)**, and the ruling that says so still binds: `github` re-exports the six moved names and nothing else, so nothing on this page beyond those six — neither the closing-list dialect nor any of the four follow-ups — is reachable from the client package. The re-export stays a migration affordance for silk-release-action's existing imports, still droppable at a later `github` bump.

### The inline list grammar

`harvestReferenceLists` is the [closing-list grammar](#grammar) worn in the **inline-in-prose** posture rather than the whole-line one, so it inherits the list rules and swaps the posture rules — the same dialects-differ-because-producers-differ reasoning that [split the first two](#the-two-moved-dialects):

- The keyword is **case-insensitive** and drawn from **either** keyword set, canonical-lowercased in the result, with `closing` reported by membership in `CLOSING_KEYWORDS` — as in the whole-line parsers.
- **Word boundaries hold on both sides.** The characters immediately before and after the keyword's letter run must not be `[A-Za-z0-9_]`, spelled as an adjacency check rather than a regex `\b`, so `recloses #1` and `1closes #1` do not match.
- **No colon**, exactly like `harvestIssueReferences`: the colon spelling belongs to the line dialects, and accepting it inline would harvest links GitHub will not make — the original two-dialect ruling, applied a third time.
- The **keyword→first-item gap is any whitespace, newlines included**, mirroring the inline dialect's `\s+`; because the module has no regexes, `\s` is spelled as a code-point predicate over the same set JavaScript means by it.
- **List continuation keeps `[ \t]` only**, so a list cannot continue past a newline — a later line makes its own claims. The two whitespace classes in one function are the point: the *gap* is prose, the *list* is a line-shaped structure.
- **A list ends at its last item.** A separator not followed by an item is prose, not grammar, and stays unconsumed: `closes #1 and fixes #2` yields `closes: [1]` then `fixes: [2]`, because ` and ` fails as a separator when what follows is not `#`.
- **An unsafe item anywhere skips the entire candidate** — never a partial list, for the same reason [the whole-line parser rejects the whole line](#grammar) — and scanning resumes after that item's extent rather than re-entering the abandoned candidate.
- **Offsets run from the keyword's first character to one past the last digit of the last item**, the inline family's convention (the whole-line results still carry none, because the line *is* the reference).

**One asymmetry is deliberate and pinned by test:** the `and` separator stays **lowercase-only** in prose, inherited from the line dialect, while the keyword is case-insensitive. `closes #1 AND #2` therefore harvests `closes: [1]`. Loosening it is a grammar change to the shared separator scanner, not a local tweak to the harvester; a consumer that hits it opens a design conversation rather than a patch.

### Per-line application

`parseBareLines`, `parseClosingLists` and `parseReferenceLists` each split on `"\n"`, apply the matching single-line parser, and collect the accepted results in line order; rejecting lines contribute nothing. CRLF needs no special case because each parser already trims. They are conveniences over the parsers, not new grammar — `parseClosingLists` is the closing-only *view* of `parseReferenceLists` for the same reason `parseClosingList` is a view of `parseReferenceList`.

**No line numbers, deliberately.** Most consumers only aggregate the references, and `BareLineReference` has no position to begin with; a consumer that needs positions keeps its own split loop, which is three lines. Returning positions from the collect form would make the cheap case pay for the rare one and would invent a coordinate the underlying results do not carry.

**`collectReferenceLists` is the two per-line families composed, not a third parser.** It exists because the three helpers above are all single-posture: `parseReferenceLists` only ever reads the colon-tolerant whole-line dialect, so a text mixing generated trailer lines with human prose loses the prose half, and there was no per-line entry point onto `harvestReferenceLists` at all. Per line, `parseReferenceList` is tried first — colon-tolerant, the line dialect's posture — and only a line that is not a whole-line list falls through to `harvestReferenceLists` on that same line — colon-less, the inline posture. **The preference is the whole ruling: a line that matches whole-line never also gets harvested**, so a colon-less trailer line (which is valid under both readings) contributes its list **exactly once**, never once per posture. This is what closes the gap a hand-rolled per-line interleave existed to paper over. Results carry **no offsets**, for the same reason the other collect forms carry no line numbers — this is deliberately the line-granular composition, coarser than either source; a consumer that needs spans calls `harvestReferenceLists` directly rather than asking this function to smuggle offsets from only one of its two branches.

### Keyword families

The twelve keywords across both sets are four stems conjugated. `keywordFamily` maps each to `"close" | "fix" | "resolve" | "ref"` through an **explicit total `Record`** keyed by `ClosingKeyword | ReferenceKeyword`, so a keyword added to either constant without a family entry is a **compile error**. That is the whole argument for the module: the downstream `startsWith("fix")` collapse is a heuristic that fails silently on a keyword nobody remembered, and a table the type system checks cannot.

The projection is a **separate function, not a field on the results**. A `family` field would be computed for every harvested reference whether or not the consumer categorizes, and would have to be added to three result shapes; a function costs the callers that want it one call and leaves the shapes alone.

## Out of scope, recorded

- **Cross-repo and full-URL references.** Inherited from the moved module's header; neither dialect's consumers emit them, and guessing their shape would freeze an API nobody has driven.
- **`LinkedIssueRef.isClosed`-style state classification.** Issue *state* is not grammar; a second consumer should drive it, and the first will likely want it from the client rather than from a parser.
- **A `@changesets/get-github-info` replacement.** That is API-tier work — it queries GitHub — so it belongs to [`@effected/github`](github.md) if anywhere, never to a pure grammar package.

## Testing

`@effect/vitest`, `assert.*` — never `expect`; tests in `__test__/`, one file per module: `IssueReferences.test.ts`, `ClosingList.test.ts` and `KeywordFamily.test.ts`.

The moved suite came with the moved module unchanged, which is the check that the move was a move. The closing-list suite carries the drift table as executable rulings: keyword casing and canonicalization, optional colon, each separator form including the Oxford comma, single-item lists, mandatory `#` (the bare-number rejection cited to the drift row), trailing-prose rejection, duplicate preservation, the whole-line rejection on an unsafe digit run beside `harvestIssueReferences`'s skip-in-prose behavior for contrast, and tab-versus-newline separator handling. A hostility case pins the ReDoS posture — a pathological long line parses in linear time and is neither truncated nor hung on.

The round-1 follow-ups added their own matrices, taking the suite from 27 cases to 53, and the round-2 `collectReferenceLists` addition took it to 58:

- **The inline harvest** pins every clause of [its grammar](#the-inline-list-grammar) as a case: two differently-keyworded lists from one line with exact offsets, a list ending where a separator leads to a new keyword, a `Refs` list reported `closing: false`, the three separator forms inside one candidate, canonical lowercasing with duplicates preserved, a newline crossed between keyword and first item but never inside a list, word boundaries on both sides, the colon rejected inline, mandatory whitespace before the first item, the whole-candidate skip on an unsafe item with scanning resumed after it, `Number.MAX_SAFE_INTEGER` itself accepted (the guard is strict, not fuzzy), the **lowercase-only `and`** asymmetry, empty and reference-free text, and a hostile input of long tab and newline runs for the linear-time posture.
- **The per-line forms** each pin the same four properties — accepted lines collected in order with rejecting lines skipped, CRLF absorbed by the parser's own trim, empty text and reference-free text yielding an empty array — plus duplicate lines preserved for `parseBareLines`, matching the parser-level duplicate ruling.
- **The family projection** asserts all twelve keywords exhaustively rather than sampling, since the point of the explicit record is totality; the conjugation collapse and the `ref` set get their own cases as documentation.
- **`collectReferenceLists`** pins the preference ruling directly: a colon trailer line the inline harvest alone cannot see, a prose line with no whole-line match falling through to the harvester, a colon-less line proven to contribute **once** rather than once per posture, both postures interleaved across a multi-line text in document order with every result asserted to carry no `start`, and empty/reference-free text yielding an empty array.
