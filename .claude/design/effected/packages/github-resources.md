---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 93
related:
  - github.md
  - github-references.md
  - ../consumers/reposets.md
  - github-rest.md
  - github-errors.md
  - github-graphql.md
  - semver.md
  - sbom.md
---

# @effected/github — the resource services

## Overview

The resource services are the package's domain half: one context service per GitHub noun a consumer needs typed — repositories, git objects, issues and pull requests, releases, check runs and the configuration surfaces a fleet writes — each turning a set of endpoints into an operation stated once. The module names in `src/` are the authority on which nouns exist; the scope rule is that an endpoint earns a resource method when a consumer needs it typed, and everything else stays reachable through the typed request surface.

Every resource is a context service whose **layer requires only the client** and whose **methods each require [the repo coordinate](github.md#the-repo-coordinate)**, so a scoped repository override is real rather than decorative. Every member is an effect or a stream, every service ships a die-loudly test double and no resource retries — [the client owns that](github-errors.md#one-retry-policy-driven-by-githubs-own-headers). The mechanics they all stand on — the route-keyed request, the escape hatch and the pagination engine — belong to [the REST surface](github-rest.md), and the package-wide framing to [github.md](github.md); what stays here is the domain layer above them. See `src/` for the surfaces; what follows is what a reader needs *before* opening them.

## Upserts exist so consumers stop writing TOCTOU dances

Without a structured "already exists" discriminant, a consumer distinguishes "someone else created it" from a real failure with a check-then-create-then-fetch preamble — **up to four round trips for one intent** — or by string-matching the message.

`GitBranch.upsert` and `GitTag.upsert` are the answer: create, and on an [already-exists](github-errors.md#four-errors-and-classification-happens-once) failure force-update. **One round trip in the common case, two in the raced one**, and the recovery still *resets* rather than inheriting a branch a concurrent creator rooted elsewhere, which is the semantics the workaround was defending. **Prefer the upsert over catching the discriminant yourself** — it exists so the library can implement these, not so consumers can re-derive them.

**Absence is not an error.** An existence check degrades a not-found to `false`, and the option-returning read variants degrade it to none — the [`@effected/git`](git.md) invariant, same shape.

## Say-once is a different idempotence from say-again

`GitHubIssue.commentOnce` posts a marked comment **once, and never edits it**: find the marker, or create it. The guarantee is idempotence across *sequential* invocations — a re-run workflow, the motivating case — not mutual exclusion across concurrent ones, and the race that leaves is named below rather than implied away. It is the counterpart to `PullRequestComment.upsert`, not a variant of it, and the pair is worth stating together because a caller reaching for one usually thinks it wants the other. An upsert **edits in place**, which is right for a status comment that must converge on the current truth. A one-time announcement — "this shipped in release X" on the issue it closed — must **never** be rewritten: an edit either restates a fact that was true when it was said, or re-notifies everyone watching, and neither is what the sender meant.

**The marker is the existence check**, appended to the body in exactly the spelling `upsert` uses, so a comment either member writes stays findable by the other. That shared spelling is precisely why this belongs in the library: two members formatting the same sentinel slightly differently is a duplicate comment on every run, and it is invisible until it has happened a dozen times.

**The obvious wrong guess is cross-reference.** `isCrossReferencedBy` looks like the right question and cannot answer it: an issue reached through `linkedIssues` is cross-referenced by construction, from the moment the pull request named it, so the check is `true` before anything has been said. Only the marker answers "have I commented yet?" — recorded here because the cross-reference member's own docstring sends readers toward building this guard, and the guard is now the member.

**The lookup paginates**, for the reason [every list read on this package does](#the-configuration-write-half): a first-page-only check on a busy issue finds no marker and announces again.

**The remaining race is named rather than implied away.** GitHub offers no conditional create, so two runs that both miss the marker both post. The window is a page read wide and the failure is one duplicate comment; the honest posture is to document it on the member rather than let the name promise an atomicity the API cannot provide — which the docstring now does in those words, stating the check-then-create is **not atomic** and sending a caller who needs mutual exclusion to serialize externally. The result value is a `CommentOnceResult` carrying `wrote` **and** the comment either way, so a caller can report "already announced" without a second read.

## The closing-reference grammar lives in `@effected/github-references`

The issue-reference grammar is not a resource service here and never will be again: it is [`@effected/github-references`](github-references.md), a pure package `github` takes as a regular `workspace:^` dependency. That doc is authoritative for the grammar — the dialects, why one regex for all of them is wrong and how the offsets and the safe-integer bound are ruled.

What stays here is the boundary, and it is exactly one line wide: `src/index.ts` **re-exports the six extracted names** — `CLOSING_KEYWORDS`, `ClosingKeyword`, `IssueReference`, `harvestIssueReferences`, `BareLineReference`, `parseBareLineReference` — so consumers that adopted the grammar in its old home keep compiling. The re-export is a migration affordance, **droppable at a later bump**, and the closing-list surfaces are deliberately **not** added to it; `__test__/IssueReferencesCompat.test.ts` is the promise as a test.

The reason the grammar could leave without contradicting [the pure-but-GitHub-shaped rule](github.md#bundle-reachability) is that the rule says a *vendor rule* belongs in the kit rather than in a consumer — it never said which kit package. Hosting it beside the client cost nothing to `github`'s own consumers and everything to the octokit-free ones, which is what the extraction settles.

## The hazard that costs production data

**Never spell a rebase as an upsert to the target head followed by a commit.** Each call is correct and each is documented; the hazard is in their *sequence*. Resetting a release branch to its base makes an open pull request from that branch have an **empty diff**, and GitHub auto-closes a pull request in that state. A consumer that reset and re-added content about three seconds later lost its open release pull request inside that window **while the run reported success**.

The correct spelling is one operation with **no observable intermediate state**: read the target commit for its tree, create a tree on it, create a commit with the target as parent, then upsert **once** to the finished sha. The branch never rests on the bare target head, so no pull request is ever momentarily empty.

**No API changed, deliberately.** A rebase-shaped member would bake one consumer's release policy into the resource surface, and the members needed to compose it correctly already exist and already return the right values. What was missing was the *warning*, so both members' TSDoc carries it — one on the "a reset is observable" side, one on the "this is commit-onto-your-own-branch, not a rebase" side. **A hazard that only exists between two calls has to be documented at both**, because a reader arrives at whichever one they reached for.

## Projections that replace consumer code

- **A commit read returning its tree sha.** Consumers reach for a commit purely to get a tree for the Git Data API; with the projection, a whole client requirement drops out of the consumer's function signature.
- **Repository settings as a faithful projection plus narrow accessors.** Consumers hit the same endpoint for different subsets — the full settings block, the default branch, the node id — which is why both the full projection and the narrow accessors exist; a default-branch-only accessor would not be enough. All of it lives on `GitHubRepository`, which already owns the route; [why there is no settings service](github.md#module-topology) is recorded with the collision that made the point.
- **Semver-aware tag selection.** Returning tag strings forces a consumer into an effect *per parse and per comparison* to find its latest release. Here parsing and comparison are the sync primitives [`@effected/semver`](semver.md) already exports, so the whole selection is one pass over the page stream with no effect round trips. The **tag-name-to-version convention is documented and pluggable** — the default strips a leading `v` and takes the substring after the last `@`, covering the tag forms the kit's own release tooling produces — with an override for anything else, and prereleases excluded unless asked for.
- **Associated pull requests, named for what they answer.** A method a consumer cannot find gets a cast instead. **That is a discoverability failure as much as a typing one**, which is why naming is treated as part of the surface here.

## Shapes corrected against the domain rather than against fixtures

- **A file list answers with typed entries, not paths.** Path *and* status, plus line counts and any pre-rename path — the same projection the commit-diff read returns, because GitHub answers both endpoints with the same wire shape. Projecting to the path alone sent every consumer who needed the status back to a raw route, which is the failure this surface exists to prevent.
- **Head and base shas are required fields.** GitHub always reports both, they are what a caller needs to commit onto a pull request's head or diff against its base, and modelling them as absent described the old fixtures rather than the domain. Whether a pull request has merged is likewise a fact GitHub always reports, so it is a real option rather than an optional key — and the projection **constructs** that option rather than decoding one, because a codec bridging GitHub's nullable wire form would describe GitHub's encoding as if it were ours.
- **A commit summary carries its parents**, required — empty for a root commit, two or more for a merge — so "which commit did this come from" never needs a raw route.
- **A content read keeps all three of its guards**, which are correct and hard-won: reject a directory listing, reject a non-file type and **reject any encoding other than base64**, because an over-size file comes back with a different encoding and decoding it as base64 yields silent garbage.
- **A sticky-comment marker is a pure class**, not a hardcoded vendor string and not a layer parameter — so it carries no branding, and it is testable without a client.
- **Auto-merge is an explicit method**, not an option that fired a mutation from a tap after create or update — which is how a failure could surface from a call that had already succeeded.
- **A poll-to-completion loop has no sentinel error.** Encoding "not done yet" as an error value bakes it into a user-visible error union; here the loop repeats with a predicate over the *success* value and a genuine timeout fails as an ordinary rejected error. The generic poll-until-a-domain-predicate combinator this is an instance of belongs to [`@effected/github-actions`](github-actions.md); this domain-specific loop stays.

## The configuration-write half

Secrets, variables, rulesets, deployment environments, security features and CodeQL default setup are a different *kind* of surface from everything above. The rest of this document is about reading GitHub and reporting on it; these write a repository's configuration, repeatedly, across a fleet. They exist because [reposets](../consumers/reposets.md) is the first consumer to do that, and the hazards a fleet write carries are what earn them a section.

**A repository-scoped write must never be able to reach an organization's object.** `GET /repos/{owner}/{repo}/rulesets` returns rulesets **inherited from the organization** alongside the repository's own, and they are indistinguishable without `source_type`. Matching by name alone therefore let a repository-scoped upsert `PUT` the organization's ruleset id — rewriting policy for *every repository the organization owns*, from a caller that never mentioned the organization. `upsert` filters on `source_type` before matching, and the projection keeps that field for the same reason it is the one easiest to drop. **The general rule: when a listing mixes scopes, the scope discriminant is not an optional field of the projection, it is the projection's reason for existing.**

**A truncated list read is worse than a failed one, because it looks complete.** A list read that fetches a single page — secrets, variables, rulesets, environments or the workflow listing — lets a consumer see the first page as the whole set. Two distinct harms, and the second is the one to fear: a cleanup policy deleting undeclared resources sees a subset, and the ruleset upsert's existence check misses an existing ruleset past page one and **creates a duplicate instead of updating**. A truncation defect does not surface as missing data, it surfaces as a wrong decision. Every list read paginates, and the [per-method pagination-forwarding test](github.md#testing) is what keeps that from regressing one method at a time.

**A normaliser must also accept the form its own parameter type declares.** `GitHubRepository.updateSettings` normalises the patch it sends: a bare `"enabled"` in `security_and_analysis` is wrapped into the `{ status }` form GitHub requires, and merge keys whose owning strategy is being disabled are dropped rather than sent into a 422. Both are conveniences for the shape a *human writing config* produces — but `RepositoryPatch` is GitHub's own parameter type, so `{ status: "enabled" }` is what the types instruct a caller to send, and a normaliser that wraps bare strings only **silently discards that block** while the request still returns 200. Two things make it a rule. **The failure is invisible in the direction that looks like success** — no error, no warning and only a probe of what was actually *sent* shows it, which is what `GitHubFixtures.requested` is for. And **a consumer's own schema can mask it entirely**: a consumer typing those fields as a two-literal union only ever sends the bare string, so the defect never reaches them, while the next caller — reading the types instead of the config — hits it first. So the typed form passes through untouched, a test pins both forms producing identical output and that branch does not get "simplified" away.

**A write reports what it sent, not what it was asked for.** `GitHubRepository.applySettings` returns `AppliedSettings` — the REST keys and the GraphQL keys that actually went out, in the caller's own names. The two agree with the caller's input right up until preparation drops a field GitHub would reject, which is *precisely* the case a person reading a dry run is checking. A caller reporting `Object.keys(input)` is describing its own intent while this package decides the content; the divergence is the whole value of the return.

**Secret writes carry the sealed box, and it is not optional.** GitHub's secrets API accepts only libsodium sealed-box ciphertext, so a secrets service without the crypto is unusable rather than merely inconvenient — which is why the encryption came up with the resources instead of being left to consumers. The dependency reasoning is in [github.md](github.md#tier-and-dependencies); `src/internal/crypto.ts` carries the algorithm's own trap, that both the concatenation order and the 24-byte nonce length are fixed by libsodium and getting either wrong produces a box GitHub **accepts** and cannot decrypt.

**A workflow listing belongs on the service that already owns the route family.** `WorkflowDispatch.list` answers "does this repository have workflows at all", and the case for it is a live 422: `actions` is a real CodeQL language, GitHub validates it against workflow *files*, and a repository-languages read can never report it. It went onto the existing service rather than into a new module, it reports GitHub's state string **without interpreting it** — whether a disabled workflow counts is a server-side rule this package cannot test — and a repository with no workflows answers with an empty array, so absence stays distinguishable from being unable to ask.

## The check-run bracket concludes on every exit

A bracket built from a success tap and an error tap fires on success and on a *typed* failure only. An **interrupted** run — a cancelled workflow, a job timeout, a losing branch of a race — and a **defect** both leave the check run in progress forever, and GitHub never reaps such a run, so it blocks branch protection until a human deletes it by hand. The bracket *shape* invites the assumption that it behaves like an acquire-use-release, and nothing in the type signature says otherwise.

The bracket is therefore an exit-aware finalizer, which runs **uninterruptibly**, and that is what lets the concluding request survive the very interrupt that triggered it. The defaults: success on success, failure on a typed failure *or* a defect and cancelled on an interrupt only. **Only the success path keeps the error channel** — failing to record a success is a real failure the caller should see, whereas on the other paths the completing call is ignored, because neither an interrupt nor an existing failure should be replaced by whatever went wrong while reporting it. That makes it the **exit's** choice rather than the verdict's.

The second half is that the other conclusions — neutral, timed out, action required, skipped — must be reachable without dropping to a raw create-and-complete pair. The motivating case is real: a **findings-derived** verdict, where neutral means "ran, advisory output, does not block branch protection" and a strict-warnings input escalates it. The work computes the verdict; the bracket has to carry it. So the callback receives a **conclude handle** as a second parameter rather than returning an outcome the bracket maps. Two reasons decided that: an outcome return **entangles the verdict with the callback's own value** — the real consumer concludes with a computed *output* as well as a literal, so the return type would become a mandatory triple for every caller, including ones that just want their value back — and a return value only exists on the **success** path, so failure and interrupt would still have needed a separate mechanism. Passing the handle second is additive: existing callbacks still compile.

**Recording, not sending.** The handle stores the verdict in a ref and the finalizer writes it **exactly once**, on whichever path the callback leaves by. That is what makes an explicit conclusion survive a later failure or an interrupt, keeps the completion a single request no matter how many times the handle is called (**last verdict wins**), and lets the handle's error channel be `never` — a caller that could observe a failed completion there would have to decide what to do about it while already on the way out. **A recorded verdict wins on every exit path**, failure and interruption included, because how the *check* ran and how the surrounding *program* ended are different questions and only the callback knows the first: a findings-derived neutral must not be overwritten by cancelled just because the job was torn down afterwards.

Two mutants discriminate: reverting to the tap form fails the interruption and defect tests while leaving success and typed-failure green, and restricting the recorded verdict to the success path fails exactly the two precedence tests.

## Byte budgeting is a pure method

GitHub caps a check-run summary at a byte count, **not a character count**, and rejects the request when it is exceeded. Emoji and box-drawing characters cost several bytes each, so a character-count check passes while the request fails — a production discovery. That logic lives here, as a pure method on the output value class, testable with no client at all.

Stripping one trailing replacement character after slicing the byte buffer is **not enough**: a split four-byte code point can produce more than one, so the trim runs until the tail is clean. A property test asserts the result is valid UTF-8 within budget for arbitrary input, and the annotation list is sliced to GitHub's own limit.

## The permission comparator is not a service

It is **a pure ordinal comparator over a record the caller already holds**, with zero octokit and zero requirements: a pure class with a comparison method and two assertion effects.

This is the highest-leverage question a design round asks: *is any of this pure, and can it be tested without a layer?* Wrapped in a service, a comparator needs a whole-behaviour test double that reimplements the entire ranking; as a pure class it needs none. There is no "warn on over-permission" member: the comparison returns the extras and the caller decides what to log.

## Attestation and artifact metadata

**Attestation upload and listing** are the REST half of a three-way split — signing and SBOM assembly are [`@effected/sbom`](sbom.md)'s, and the mint-sign-build-attest pipeline is consumer composition. Two behaviours are deliberate: the **pinned API version**, which is why this surface uses the decoding request with an owned schema rather than a generated response type, and **two distinct statuses both meaning "no attestations"**, degraded to an empty list. The bundle crossing the seam is [structurally typed on this side](sbom.md#the-attestation-seam-no-edge-either-way), so neither package takes an edge on the other.

**Artifact metadata** is worth its own module for its projection, even though its route is in the generated map. The endpoint is **org-scoped rather than repository-scoped**, and the organization is nonetheless resolved from the repo coordinate's owner **like every other resource**: taking the org as a positional argument would make the uniform rule false for exactly one call site and cost every caller the question of where its org comes from. The scoped override covers the cross-org case exactly as it covers the cross-repository one.

## One internal projection stays internal

The raw wire shape a file list decodes from is exported from its own module — so the projection is shared between the two endpoints that answer with it rather than written twice — but **deliberately not from the entry point**, because it is octokit's vocabulary rather than this package's. The typed entry is the public type; the raw shape is how it gets built.
