---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-23
last-synced: 2026-08-23
completeness: 94
related:
  - github-actions.md
  - github-actions-runtime.md
  - glob.md
  - npm.md
---

# @effected/github-actions — storage and provisioning

## Overview

Storage and provisioning is the runner-side storage protocols and the installers built on them: the Actions cache and artifact APIs, the blob store and its envelope, cache-key derivation, and tool and package-manager provisioning.

What it owns is the **protocol**, never the transport — the RPC sequence, conflict handling, version derivation, retry policy and envelope framing all sit on this side of a pre-signed URL, and the upload itself is taken as an argument. It is also where the package's heavy edges concentrate: everything Azure-touching lives in three modules here, and `@effected/npm` is reachable only from the package-manager installer, which is why none of this is in the layer [`Action.run`](github-actions-runtime.md#actionrun-and-the-composed-runtime) composes — a consumer that wants a cache passes it in and writes one explicit layer line. Package-wide framing — including the [reachability rules](github-actions.md#bundle-reachability-confining-the-heavy-edges) that make the confinement checkable — is in [github-actions.md](github-actions.md).

## The blob store and its metadata channel

A raw get/put/has store over byte arrays has **no metadata channel**, so the consumer that needed one hand-rolled a binary frame and namespaced its keys with a version prefix to represent a format change. Both are framing concerns leaking into a consumer, and both are what this subsystem absorbs.

**`BlobEnvelope` is a pure, schema-versioned module** owning the wire format and nothing else — no IO, no service, fully testable from a byte array. Four decisions carry it:

- **A magic prefix makes a legacy blob legible.** A raw, unframed payload decodes as a typed "not an envelope" rather than as garbage metadata, so a consumer migrating existing cache entries gets a clean miss instead of a corrupt read. The magic identifies the **family** and a separate byte identifies the **revision**: a version digit inside the magic would be a second version channel, and two version channels can disagree.
- **The version lives in the blob, not in the key.** A format change is detected on read and the entry is simply a miss, so **keys stay stable across format revisions** and old entries age out naturally.
- **Metadata is the caller's schema, not a fixed shape.** The package owns *framing*; the consumer owns *meaning*.
- **The primitives are `Result`-returning**, per the [sync-primitive policy](../sync-primitive-policy.md): framing is pure computation.

**The stored value is `StoredBlob<A>`, renamed from `Blob<A>`.** The old name collided with the DOM's global `Blob` — harmlessly in source, and *not* harmlessly in the published docs model, where API Extractor disambiguated it to `Blob_2`. A generated name with a numeric suffix is a name no consumer can search for, so the rename is a documentation fix as much as a clarity one.

**The envelope's failures are a [per-reason tagged union](github-actions.md#errors)**: `BlobEnvelopeError` aliases `NotABlobEnvelopeError | TruncatedBlobEnvelopeError | UnsupportedBlobEnvelopeVersionError | BlobMetadataDecodeError | BlobMetadataEncodeError`. The split matters most precisely here, because the framing failures are the ones a caller *recovers from selectively* — "not an envelope" and "unsupported version" are both ordinary cache misses on a migrating consumer, while a truncated frame or a metadata decode failure is a corrupt entry worth reporting.

**The service takes the schema per call**, which is not a new idiom — it is exactly the shape the state service already has, which is the consistency argument for choosing it over a layer-baked or type-parameterized service. There is **no list and no delete**: eviction is the backend's, no consumer wants them, and adding them would mean designing an eviction story for two backends that both already have one.

Two backends, both requiring core's HTTP client in their layer: the **Actions cache** protocol, and an **S3-compatible** backend with request signing, **path-style** addressing and a custom endpoint — which is what makes it work against non-AWS object stores rather than only AWS. Signing is `node:crypto` HMAC, per [the crypto finding](github-actions.md#tier-and-dependencies). The GitHub-cache backend's layer static lives on **its own module's class**, not on the shared service class: putting it there would make the Azure client reachable from every module that reads a blob. That is the layer-static-belongs-to-the-module-owning-the-dependency rule, applied for a confinement reason rather than a stylistic one.

## The transport seam

The three Azure-touching modules **take their transport as an argument** — a file transport for the cache and artifacts, a buffer transport for the blob store — with a parameterized layer beside each real one.

The reasoning is the same one that makes [`@effected/sbom`](sbom.md) drive the **real** bundle builder through a stub signer: **what this package owns is the protocol, and the protocol is not the transport.** The RPC sequence, conflict handling, version derivation, retry policy and envelope framing are all on this side of the pre-signed URL; the upload itself is not. Taking the transport as an argument is what makes the protocol *execute* in a test rather than be described by one — the cache suite archives real files, deletes them and restores them, which is a claim about the filesystem no in-memory double could make. It is also how the opt-in integration tests point the real protocol at a local endpoint.

It settles a duplication question that looks like sloppiness and is not: **each of the three carries its own small Azure adapter.** Hoisting them into a shared internal helper is exactly the move the confinement rule forbids, and the reachability suite asserts the resulting edge sets exactly.

## Protocol details worth not re-deriving

**The RPC client decides retryability structurally.** One module owns the call, the conflict sentinel and the retry policy, and **applies the retry itself** so no protocol can ship without it. Its failure value is structural — transport, status, malformed, with the status when there was one — rather than a formatted string a predecessor tested for substrings, under which rewording a message was a silent policy change. Two corrections travel with it: **both field spellings are read** (camelCase *and* snake_case), because the backend is an internal protocol whose two halves disagree and a predecessor read only one — the failure mode of guessing wrong is "the cache silently never hits", which is the hardest cache failure to notice. And **a non-retryable failure never sleeps**, which is what keeps every ordinary failure test clock-free.

**The results backend is only reachable from a `uses:` step.** Its two environment variables are injected into action execution contexts and **not** into shell steps, so identical code works from a bundled action and fails when a workflow invokes it directly. All three services report that as a misconfiguration **naming the absent variable**, because nothing else in the environment distinguishes the two cases. They read the variables **per call through the environment service**, not at layer construction: resolving at construction would make merely *composing* the layer fail outside Actions, including for an action that never touches the cache.

**The runtime token is never declassified.** It arrives as plaintext, is wrapped immediately at the read, and leaves only through the HTTP client's bearer-token helper, which accepts a redacted value directly. So the [declassification seam](github-actions-runtime.md#secrets-the-declassification-seam) needed no new member for it.

**Artifact facts that are easy to get wrong**, each with a test: the create call's protocol version is unrelated to the version in the marketplace action's name (which is the obvious wrong guess); finalization hashes the **stored archive, streamed** rather than read, because an artifact is the one payload here with no upper bound on size; entries are stored **relative to the root directory**, or a download rebuilds a tree named after the runner that produced it; and a conflict on create is a **failure**, unlike the cache, because a run may hold one artifact per name.

**The cross-run artifact lookup is deliberately not implemented.** Every path through it in the package this replaced fails with "not yet implemented", so porting the parameter would ship a surface that answers no question: **a parameter whose only behaviour has ever been a typed refusal is a ported lie.** Adding it back when a consumer produces a real cross-run lookup is additive; shipping it and later removing it would not be. If it returns, its token field is a redacted value rather than a bare string, because it is a credential and this package has a seam for declassifying one.

The artifact module is **provisional by ruling** in a way the others are not: it was ported without a call site to shape it against — a thorough search found no direct consumer, and the near-miss that reads like one is a *storage record* on a different API, one import line away and differing by a suffix. Recording that collision is the point, so the absence is not re-litigated from the same confusion. The first consumer to adopt it is the one whose feedback reshapes it.

## Cache keys, and where file hashing lives

The key ladder is consumer-visible logic every consumer re-derives, so it is its own concept module: file hashing, the primary-key and restore-key ladder, and branch-aware derivation.

Three properties earned their tests, and each is a way the obvious implementation is wrong:

- **Every rung ends in the separator.** GitHub matches restore keys as bare prefixes, so a rung without it also matches an unrelated cache whose key merely starts the same way.
- **A one-segment key gets no rung at all.** An empty prefix matches every cache in the repository.
- **Branch-aware derivation orders the segments so the first fallback stays on the branch.** Reversed, a feature branch warms itself from the default branch and never finds its own cache.

**`withNamespace` is the cache-bust primitive, and it drops the ladder deliberately.** A busted run must match nothing an unbusted run wrote, *and* its own entries must be invisible to unbusted runs — one intent, and spelling the two halves separately is what makes getting it wrong undetectable. Restore keys are **prefix matches**, so folding a bust token in after the retained prefix leaves an ordinary run's rung prefix-matching busted entries: the cache still appears to work while quietly serving poisoned entries into unrelated runs. Two decisions make the combinator safe for *any* segment value, with no prefix reasoning at the call site: the segment goes **first**, so a namespaced key shares no prefix with an unnamespaced one, and the ladder is **dropped**, so no rung can reach outside the namespace even when the segment happens to equal an ordinary leading segment — which a prepend alone would not survive. Dropping the ladder is a safe default rather than a prohibition: the segments are all still there, so a caller who wants one busted run to warm from another follows with `withRestoreDepths` and gets an in-namespace ladder **deliberately**.

`CacheKeyError` also became a [per-reason union](github-actions.md#errors) — `CacheKeyReadError` carries a required `path`, `CacheKeyBadPatternError` a required `pattern` — which is the case where the old shape's optional fields were most visibly wrong: half the messages could render `"undefined"`.

**File hashing is byte-compatible with the official glob action**: sorted, de-duplicated, and each file's digest fed into the accumulator as **binary, not hex**. A hex-fed accumulator produces a perfectly plausible digest that never matches a cache entry written by any other action, so the test pins the digest as a literal.

**Discovery and matching are two halves, deliberately.** [`@effected/glob`](glob.md) is a **matcher, not a walker** — pure string-to-predicate by construction — so it cannot supply file discovery. The walk is therefore core's recursive directory read, which is the better half of the deal: it makes the whole pairing testable through a noop filesystem with no temp directory and no real IO. The alternative, a platform glob call, was rejected on a **correctness** argument rather than a weight one: it welds discovery and matching into one non-stubbable call, and node's glob dialect is not the minimatch dialect the official action uses — a dialect divergence surfaces as a *silent cache-key difference* from every other action in the same workflow, which is the worst failure mode a cache key has.

The two halves are separate statics rather than one, which is what lets a caller reuse the discovery, and walking from the workspace root makes "never hash a file outside the workspace" **structural** rather than a remembered check. Two behaviours earned tests and one is a real trap: candidates are matched by their path **relative to the workspace**, and **directories are excluded by an explicit stat** — a directory named like a file matches a file pattern and is not a file, so without the check it reaches the hasher, which fails on the read. A glob that will not compile is this module's own typed error rather than a dependency's error leaking onto its surface.

**Recorded escalation: if a second, non-Actions consumer wants file hashing, it moves** — into a small hashing package, or back into `walker` once core grows a digest contract. It is here because this package is integrated already and may use `node:crypto`. Not a permanent home, the honest one today.

## Tool and package-manager installation

Downloading, extracting and caching a toolchain, plus exact-version provisioning of the four package managers keyed by [`@effected/npm`](npm.md)'s pin model.

**`ToolInstallerError.subject` is required**, not optional. Every construction site had one, and an optional field on an error is a message that renders `"undefined"` on whichever path forgets — the same reasoning that drove the per-reason splits above, applied without needing a split.

**Downloads go through core's HTTP client and stream to disk** rather than buffering, and extraction requires core's subprocess contract in `R` — no spawner backend here, per the [commands invariant](commands.md#the-one-rule). The platform branch reads the **runner's own OS variable**, not the process platform.

**Installs stage then swap**: extract into a temp directory **under the cache root** and rename into place. Two invariants, both tested, and both confirmed by mutating the naive "make the destination, then copy into it" implementation back in — it fails both. A failed install must leave **nothing** at the cache path, because a lookup reports an empty directory as a **hit**, so every later run uses a tool that is not there and never re-downloads it. And a re-install must **replace** rather than merge, so the previous version's files do not survive inside the new one. The staging directory lives under the cache root deliberately: a rename across filesystems is not atomic and often not permitted, so a system temp directory would silently degrade the guarantee to a copy.

Tool installation deliberately takes **no edge to [`@effected/runtimes`](runtimes.md)**, despite the apparent overlap: that package resolves *versions* and answers with a download URL, while this one takes a URL and installs *files*. Nothing in the installer wants a version resolver, and a consumer that wants both composes them in three lines. The edge stays free if a real call site ever asks for it.

## Testing notes specific to this subsystem

- **Real IO where the claim is about the filesystem.** The installer tests run against the real platform layer with a real archiver, because stage-then-swap is a statement about what the filesystem contains after a partial failure and an in-memory double would only assert the double.
- **The envelope gets pure tests and a property**: round-trip arbitrary metadata and bodies, a truncated frame failing typed rather than throwing, a random byte array failing as not-an-envelope, and a bumped version byte failing as unsupported. This is the module where a counterexample is a corrupted cache entry.
- **A fake HTTP layer must decode the request body through a response**, never by stringifying it. The body arrives as bytes, and stringifying them yields a comma-separated digit soup that throws in the JSON parse, which inside a fake transport surfaces as a *transport fault*, which the client then **retries**, which hangs the virtual clock. One misread fixture presented as ten unrelated timeouts in modules that had nothing wrong with them.
- **A retry test needs a bounded settle helper** — a forked fiber plus a bounded clock-advance loop polling the fiber — rather than an unbounded wait: a fiber blocked on something that is not a sleep would otherwise hang to the vitest timeout with no clue why.
- **Mutants that discriminate here**: removing the RPC retry, dropping the snake_case field fallback, taking the finalized size from the body rather than the frame, computing the cache entry version over unsorted paths, ignoring the matched key on restore, storing archive entries absolutely, loosening the directory filter, hex-feeding the digest accumulator, dropping the ladder's sort, and importing Azure from an internal helper.
