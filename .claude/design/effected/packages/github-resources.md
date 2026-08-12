---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 93
related:
  - github.md
  - github-rest.md
  - github-errors.md
  - github-graphql.md
  - semver.md
  - sbom.md
---

# @effected/github — the resource services

## Overview

The resource services are the package's domain half: one context service per GitHub noun a consumer needs typed — repositories, branches, tags, commits, contents, issues, pull requests and their comments, releases, check runs, workflow dispatches, attestations, artifact metadata and token permissions — each turning a set of endpoints into an operation stated once.

Every resource is a context service whose **layer requires only the client** and whose **methods each require [the repo coordinate](github.md#the-repo-coordinate)**, so a scoped repository override is real rather than decorative. Every member is an effect or a stream, every service ships a die-loudly test double, and no resource retries — [the client owns that](github-errors.md#one-retry-policy-driven-by-githubs-own-headers). The mechanics they all stand on — the route-keyed request, the escape hatch and the pagination engine — belong to [the REST surface](github-rest.md), and the package-wide framing to [github.md](github.md); what stays here is the domain layer above them. See `src/` for the surfaces; what follows is what a reader needs *before* opening them.

## Upserts exist so consumers stop writing TOCTOU dances

A predecessor's branch error carried no structured "already exists" discriminant, so a consumer wrote a seven-line comment plus a nine-line workaround on top of a three-call preamble — **up to four round trips for one intent** — to distinguish "someone else created it" from a real failure. The mirror-image dance existed in another repo, and two more sites string-matched the message.

`GitBranch.upsert` and `GitTag.upsert` are the answer: create, and on an [already-exists](github-errors.md#four-errors-and-classification-happens-once) failure force-update. **One round trip in the common case, two in the raced one**, and the recovery still *resets* rather than inheriting a branch a concurrent creator rooted elsewhere, which is the semantics the workaround was defending. **Prefer the upsert over catching the discriminant yourself** — it exists so the library can implement these, not so consumers can re-derive them.

**Absence is not an error.** An existence check degrades a not-found to `false`, and the option-returning read variants degrade it to none — the [`@effected/git`](git.md) invariant, same shape.

## The hazard that costs production data

**Never spell a rebase as an upsert to the target head followed by a commit.** Each call is correct and each is documented; the hazard is in their *sequence*. Resetting a release branch to its base makes an open pull request from that branch have an **empty diff**, and GitHub auto-closes a pull request in that state. A consumer that reset and re-added content about three seconds later lost its open release pull request inside that window **while the run reported success**.

The correct spelling is one operation with **no observable intermediate state**: read the target commit for its tree, create a tree on it, create a commit with the target as parent, then upsert **once** to the finished sha. The branch never rests on the bare target head, so no pull request is ever momentarily empty.

**No API changed, deliberately.** A rebase-shaped member would bake one consumer's release policy into the resource surface, and the members needed to compose it correctly already exist and already return the right values. What was missing was the *warning*, so both members' TSDoc carries it — one on the "a reset is observable" side, one on the "this is commit-onto-your-own-branch, not a rebase" side. **A hazard that only exists between two calls has to be documented at both**, because a reader arrives at whichever one they reached for.

## Projections that deleted consumer code

- **A commit read returning its tree sha.** Two consumers reached for a commit purely to get a tree for the Git Data API, in byte-duplicate blocks with a comment explaining why. With it, a whole client requirement drops out of one consumer's function signature.
- **Repository settings as a faithful projection plus narrow accessors.** Three consumers hit the same endpoint for three different subsets — one wanted sixteen settings fields, one wanted the default branch, one wanted the node id — which is why both the full projection and the narrow accessors exist. A default-branch-only accessor would not have been enough.
- **Semver-aware tag selection.** A consumer ran an effect *per parse and per comparison* across thirty-five lines to find its latest release tag. Here parsing and comparison are the sync primitives [`@effected/semver`](semver.md) already exports, so the whole selection is one pass over the page stream with no effect round trips. The **tag-name-to-version convention is documented and pluggable** — the default strips a leading `v` and takes the substring after the last `@`, covering the three tag forms the kit's own release tooling produces — with an override for anything else, and prereleases excluded unless asked for.
- **Associated pull requests, named for what they answer.** The method already existed and a consumer did not find it, writing the survey's one explicit-`any` cast instead. **That was a discoverability failure as much as a typing one**, which is why naming is treated as part of the surface here.

## Shapes corrected against the domain rather than against fixtures

- **A file list answers with typed entries, not paths.** Path *and* status, plus line counts and any pre-rename path — the same projection the commit-diff read returns, because GitHub answers both endpoints with the same wire shape. Projecting to the path alone sent every consumer who needed the status back to a raw route, which is the failure this surface exists to prevent.
- **Head and base shas are required fields.** GitHub always reports both, they are what a caller needs to commit onto a pull request's head or diff against its base, and modelling them as absent described the old fixtures rather than the domain. Whether a pull request has merged is likewise a fact GitHub always reports, so it is a real option rather than an optional key — and the projection **constructs** that option rather than decoding one, because a codec bridging GitHub's nullable wire form would describe GitHub's encoding as if it were ours.
- **A commit summary carries its parents**, required — empty for a root commit, two or more for a merge — so "which commit did this come from" never needs a raw route.
- **A content read keeps all three of its guards**, which are correct and hard-won: reject a directory listing, reject a non-file type, and **reject any encoding other than base64**, because an over-size file comes back with a different encoding and decoding it as base64 yields silent garbage.
- **A sticky-comment marker is a pure class**, not a hardcoded vendor string and not a layer parameter — so it carries no branding, and it is testable without a client.
- **Auto-merge is an explicit method**, not an option that fired a mutation from a tap after create or update — which is how a failure could surface from a call that had already succeeded.
- **A poll-to-completion loop has no sentinel error.** A predecessor encoded "not done yet" as an error value baked into a user-visible error union; here the loop repeats with a predicate over the *success* value and a genuine timeout fails as an ordinary rejected error. The generic poll-until-a-domain-predicate combinator this is an instance of belongs to [`@effected/github-actions`](github-actions.md); this domain-specific loop stays.

## The check-run bracket concludes on every exit

The bracket's first shipped form used a success tap and an error tap, and those fire on success and on a *typed* failure only. An **interrupted** run — a cancelled workflow, a job timeout, a losing branch of a race — and a **defect** both left the check run in progress forever, and GitHub never reaps such a run, so it blocks branch protection until a human deletes it by hand. The bracket *shape* invites the assumption that it behaves like an acquire-use-release, and nothing in the type signature said otherwise.

The fix is an exit-aware finalizer, which runs **uninterruptibly**, and that is what lets the concluding request survive the very interrupt that triggered it. The defaults: success on success, failure on a typed failure *or* a defect, and cancelled on an interrupt only. **Only the success path keeps the error channel** — failing to record a success is a real failure the caller should see, whereas on the other paths the completing call is ignored, because neither an interrupt nor an existing failure should be replaced by whatever went wrong while reporting it. That makes it the **exit's** choice rather than the verdict's.

The second half is that the other conclusions — neutral, timed out, action required, skipped — were unreachable without dropping to a raw create-and-complete pair. The motivating case is real: a **findings-derived** verdict, where neutral means "ran, advisory output, does not block branch protection" and a strict-warnings input escalates it. The work computes the verdict; the bracket has to carry it. So the callback receives a **conclude handle** as a second parameter rather than returning an outcome the bracket maps. Two reasons decided that: an outcome return **entangles the verdict with the callback's own value** — the real consumer concludes with a computed *output* as well as a literal, so the return type would become a mandatory triple for every caller, including ones that just want their value back — and a return value only exists on the **success** path, so failure and interrupt would still have needed a separate mechanism. Passing the handle second is additive: existing callbacks still compile.

**Recording, not sending.** The handle stores the verdict in a ref and the finalizer writes it **exactly once**, on whichever path the callback leaves by. That is what makes an explicit conclusion survive a later failure or an interrupt, keeps the completion a single request no matter how many times the handle is called (**last verdict wins**), and lets the handle's error channel be `never` — a caller that could observe a failed completion there would have to decide what to do about it while already on the way out. **A recorded verdict wins on every exit path**, failure and interruption included, because how the *check* ran and how the surrounding *program* ended are different questions and only the callback knows the first: a findings-derived neutral must not be overwritten by cancelled just because the job was torn down afterwards.

Two mutants discriminate: reverting to the tap form fails the interruption and defect tests while leaving success and typed-failure green, and restricting the recorded verdict to the success path fails exactly the two precedence tests.

## Byte budgeting is a pure method

GitHub caps a check-run summary at a byte count, **not a character count**, and rejects the request when it is exceeded. A consumer discovered this in production, because emoji and box-drawing characters cost several bytes each — so a character-count check passes while the request fails. That logic lives here now, as a pure method on the output value class, testable with no client at all.

It was **hardened while moving**: the consumer's version stripped one trailing replacement character after slicing the byte buffer, but a split four-byte code point can produce more than one, so this trims until the tail is clean. A property test asserts the result is valid UTF-8 within budget for arbitrary input, and the annotation list is sliced to GitHub's own limit.

## The permission comparator is not a service

Its predecessor's live layer was a plain success layer with zero octokit and zero requirements — **a pure ordinal comparator over a record the caller already holds**. It becomes a pure class with a comparison method and two assertion effects.

This is the highest-leverage question a design round asks and no skill prompts for: *is any of this pure, and can it be tested without a layer?* Here the answer was yes and the predecessor had wrapped it in a service anyway — which is also why its test double was the heaviest in that package, reimplementing the entire ranking. One service, one whole-behaviour double and a parameterized layer factory all disappear. A "warn on over-permission" member that despite its name did not warn is deleted: the comparison returns the extras and the caller logs.

## Attestation and artifact metadata

**Attestation upload and listing** are the REST half of a three-way split — signing and SBOM assembly are [`@effected/sbom`](sbom.md)'s, and the mint-sign-build-attest pipeline is consumer composition. Two behaviours are ported deliberately: the **pinned API version**, which is why this surface uses the decoding request with an owned schema rather than a generated response type, and **two distinct statuses both meaning "no attestations"**, degraded to an empty list. A predecessor's runtime guard that **threw a plain error** when the client was not octokit-backed has no successor: with a typed client there is nothing to sniff. The bundle crossing the seam is [structurally typed on this side](sbom.md#the-attestation-seam-no-edge-either-way), so neither package takes an edge on the other.

**Artifact metadata** is worth its own module for its projection, even though its route turns out to be in the generated map after all — so a predecessor's defensive cast and string-body tolerance are unnecessary, and the field it sent that the endpoint does not have is gone. The endpoint is **org-scoped rather than repository-scoped**, and the organization is nonetheless resolved from the repo coordinate's owner **like every other resource**: it shipped taking the org as a positional argument, the one method on the whole surface that did, which made the uniform rule false for exactly one call site and cost every caller the question of where its org comes from. The scoped override covers the cross-org case exactly as it covers the cross-repository one.

## One internal projection stays internal

The raw wire shape a file list decodes from is exported from its own module — so the projection is shared between the two endpoints that answer with it rather than written twice — but **deliberately not from the entry point**, because it is octokit's vocabulary rather than this package's. The typed entry is the public type; the raw shape is how it gets built.
