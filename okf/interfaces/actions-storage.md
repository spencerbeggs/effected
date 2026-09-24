---
type: Interface
title: actions-storage
description: The Actions cache and artifact protocols, the blob store envelope, cache-key derivation and the tool/package-manager installers.
status: stable
kind: api
resource: ../../packages/github-actions/src
tags:
  - architecture
  - bundle
generated:
  by: "okfit/claude-code"
  at: 2026-09-22T01:21:07Z
  body_sha256: ed60c4061e877b2b4e82ba020015da5c2da61b241598c5b9d5ef78b40f6e7730
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:32.522Z
---

# actions-storage

## Contract

Storage and provisioning owns the **protocol**, never the transport: the
RPC sequence, conflict handling, version derivation, retry policy and
envelope framing all sit on this side of a pre-signed URL, and the upload
itself is taken as an argument. None of it is in the layer `Action.run`
composes (see [actions-runtime](actions-runtime.md)) — a consumer that
wants a cache passes it in and writes one explicit layer line. This is
also where the package's heavy edges concentrate: everything Azure-touching
lives in three modules (`ActionCache.ts`, `Artifact.ts`,
`BlobStore.githubCache.ts`), and `@effected/npm` is reachable only from
`PackageManagerInstaller.ts` — see
[bundle reachability](../modules/github-actions.md#bundle-reachability).

### `BlobEnvelope` — the metadata channel

A pure, schema-versioned module owning the wire format for a raw get/put/has
byte-array store, with no IO and no service. A magic prefix identifies the
envelope **family**; a separate byte identifies the **revision**, so a
legacy blob decodes as a typed "not an envelope" instead of garbage
metadata, and a raw payload gives a migrating consumer a clean miss rather
than a corrupt read. The version lives in the blob, not in the key, so
keys stay stable across format revisions and old entries age out
naturally. Metadata is the caller's own schema — the package owns framing,
the consumer owns meaning — and the primitives are `Result`-returning,
because framing is pure computation. There is no list and no delete:
eviction belongs to the backend.

The stored value's type is `StoredBlob<A>`, never `Blob<A>` — that name
collides with the DOM global and the published docs model disambiguates it
to `Blob_2`, a name no consumer can search for. `BlobEnvelopeError` is a
per-reason tagged union (see
[errors](../modules/github-actions.md#errors)): "not an envelope" and
"unsupported version" are ordinary cache misses on a migrating consumer,
while a truncated frame or a metadata decode failure is a corrupt entry
worth reporting.

Two backends, both requiring core's HTTP client in their layer: the
Actions cache protocol, and an S3-compatible backend with request signing
(`node:crypto` HMAC), path-style addressing and a custom endpoint. The
GitHub-cache backend's layer static lives on its own module's class, never
on the shared service class, so the Azure client stays unreachable from
every other module that reads a blob.

### The transport seam

The three Azure-touching modules take their transport as an argument (a
file transport for the cache and artifacts, a buffer transport for the
blob store), with a parameterized layer beside each real one — which is
what lets the cache suite archive real files, delete them and restore
them as a claim about the filesystem no in-memory double could make. Each
of the three carries its own small Azure adapter deliberately: hoisting
them into a shared internal helper is exactly the move the confinement
rule forbids.

### Protocol details

The RPC client decides retryability structurally: one module owns the
call, the conflict sentinel and the retry policy, and applies the retry
itself so no protocol can ship without it. Both camelCase and snake_case
field spellings are read from the backend, because the two halves of the
internal protocol disagree, and a non-retryable failure never sleeps. The
results backend is reachable only from a `uses:` step — its environment
variables are injected into action execution contexts, not shell steps —
and all three services report that as a misconfiguration naming the
absent variable. The runtime token from that backend is never
declassified: it is wrapped immediately at the read and leaves only
through the HTTP client's bearer-token helper, which accepts a `Redacted`
directly (see
[the declassification invariant](../invariants/redacted-value-only-in-secret.md)).
Artifact backend ids come from that token's own `scp` claim, decoded
from the plaintext before it is wrapped.

Artifact facts worth not re-deriving: the create call's protocol version
is unrelated to the marketplace action's version; finalization hashes the
stored archive streamed, not read, because an artifact has no upper bound
on size; entries are stored relative to the root directory; and a
conflict on create is a failure, unlike the cache, because a run may hold
one artifact per name. The cross-run artifact lookup is deliberately not
implemented — see
[no cross-run artifact lookup](../limitations/actions-storage-no-cross-run-artifact-lookup.md).

### Cache keys and file hashing

The key ladder is its own concept module: every rung ends in the
separator (GitHub matches restore keys as bare prefixes, so a rung
without one also matches an unrelated cache), a one-segment key gets no
rung at all (an empty prefix matches every cache in the repository), and
branch-aware derivation orders segments so the first fallback stays on the
branch. `CacheKey.withNamespace` puts its segment **first** and drops the
ladder entirely: restore keys are prefix matches, so folding a bust token
in later would leave an ordinary run's rung prefix-matching busted
entries. A caller who wants an in-namespace ladder follows with
`withRestoreDepths`. `CacheKeyError` is a per-reason union whose members
each carry their own required field.

The restore policy is a three-point space carried on the typed key, and
`ActionCache.restore` picks it up through that key alone. Absence means
the default every-prefix ladder. `withRestoreDepths([4, 3])` carries an
explicit ladder — each depth is the number of leading segments a rung
keeps, emitted in the order given — because the default ladder drops
digest segments a five-segment key must never lose; a depth outside
`1..segments.length - 1` is refused at construction. `withoutRestoreKeys()`
is the same field carrying **zero** rungs: an exact-match-only restore
sends an empty `restore_keys` and never falls back. `CacheKey.digest(input,
length = 8)` is the segment-safe short digest for **non-file** segments (a
version list, a branch name): sha256, lowercase hex, truncated to satisfy
the segment grammar so it drops into `CacheKey.of` unchecked; a length
outside `1..64` is wiring, not data, and throws a `RangeError`. File
content stays with `hashFiles`.

`ActionCache.save` resolves its `paths` as glob **patterns** before `tar`
sees them, with `actions/cache` parity: a matched directory archives
recursively, a pattern matching nothing (including an absent literal)
drops silently, and a list resolving to nothing fails typed rather than
reserving an entry no archive backs. The entry **version** is a digest of
the *literal* pattern list on both sides — resolution feeds `tar`, never
the version — so `restore`, which resolves nothing, derives the same
version for free and `paths` must be the same literal list the save used.
One knowing divergence: matches stay **absolute** and archive under
`tar -P`, so a restore puts every file back where it came from regardless
of the restoring step's working directory. The engine is
[`glob`](../modules/glob.md), never `@actions/glob`.

File hashing is byte-compatible with the official glob action: sorted,
de-duplicated, each file's digest fed into the accumulator as binary, not
hex. Discovery and matching are two deliberate halves — `glob` is a
matcher, not a walker — and `CacheKey.matchingFiles` walks through
[`walker`](../modules/walker.md)'s `descend` (files only, one root per
include, `prune: []` so nothing is skipped implicitly, because the
runner's own `hashFiles()` prunes nothing either). Symlinked directories
are followed (`followSymlinks: true`) for parity with `@actions/glob`'s
default, `descend`'s real-path cycle guard keeping link loops finite;
note the walk is therefore **not** workspace-bounded under links — a
symlinked directory targeting outside the workspace is descended and its
files enter the key, as `@actions/glob` does. `ActionCache`'s own path
resolution stays hand-rolled, because cache paths are usually directories,
which `descend` never matches.

### Tool and package-manager installation

`ToolInstallerError.subject` is required, not optional. Downloads go
through core's HTTP client and stream to disk; extraction requires core's
subprocess contract in `R`. Installs stage then swap: extract into a temp
directory under the cache root and rename into place, so a failed install
leaves nothing at the cache path (a lookup reports an empty directory as a
hit) and a re-install replaces rather than merges. The staging directory
lives under the cache root because a rename across filesystems is not
atomic. Tool installation takes no edge to [`runtimes`](../modules/runtimes.md):
that package resolves versions and answers with a download URL, this one
takes a URL and installs files.

`ToolInstaller.provisionFile` packages the one composition with no
per-tool variation — a single bare binary (biome, and every Rust or Go
tool shipped as one executable): `find` → `download` → chmod `0o755`
(skipped on Windows, and done **before** caching, so the cache never
holds a non-executable tool) → `cacheFile`, answering `{ directory,
binDir }` where `binDir` *is* the cached directory. A hit **missing the
named binary** is a foreign or partial entry and is reinstalled over, not
answered. `ToolInstaller.cachePath(tool, version)` is the location
contract — the same closure `cacheDir` lands at — so a caller that must
write the final path *into* a staged tree before the swap (a shim naming
its target) asks the installer rather than re-deriving root and arch.

`PackageManagerInstaller` provisions the majors
[the support policy](../conventions/package-manager-support-policy.md)
names, answering a union discriminated on `source`
(`AmbientPackageManager` | `CachedPackageManager`), every tool-cache
answer carrying an `addPath`-able `binDir`. Shims for the npm-registry
managers are written into the **staged** entry, never as a post-swap
mutation, naming their target through `cachePath`; bun's own directory is
its `binDir`, and the bun path deliberately does not route through
`provisionFile` because integrity verification and zip extraction sit
between its download and chmod. The installer decides how to provision by
**artifact layout**, never by major. pnpm 12's
registry package is a wrapper whose `pnpm` bin is a shebang-less
placeholder that pnpm's own install script would overwrite with a native
binary shipped as an `@pnpm/exe.<os>-<arch>[-musl]` optional dependency;
since the installer runs no lifecycle scripts, it performs that overlay
itself when the wrapper manifest's `optionalDependencies` names an
`@pnpm/exe.*` package. The host's `@pnpm/exe.<target>` tarball comes from
the same registry as the wrapper and is verified **fail-closed** against
the packument's `dist.integrity` — it is a second artifact the pin never
named, so there is no integrity-less posture to honor — and its executable
is copied over the placeholder in the **staged** entry, where the wrapper's
`dist/` sits beside it as the binary expects. The manifest's `@pnpm/exe.*`
version must equal the pin's; anything else is `layoutUnexpected`.

Shims follow their target, not their manager: a `.js`/`.mjs`/`.cjs` target
runs under `node`, anything else is exec'd directly. For pnpm 12 that
makes `bins.pnpm` the native executable and `pn`/`pnpx`/`pnx` its
`#!/bin/sh` aliases. A cache hit whose entry still holds the placeholder —
written by a kit at or below 0.13.1, or by a foreign writer that ran no
lifecycle scripts — is not trusted: it is reinstalled over through the
same remove-then-rename swap, because a stale `exec node` shim beside it
would otherwise survive. The error union is unchanged at seven reasons;
`unsupportedPlatform` now also names a host pnpm publishes no `@pnpm/exe.*`
build for. Corepack's `bin/pnpm.mjs` route is deliberately not used: it
downloads the binary on first invocation, mutating the cached entry after
the swap. See
[the placeholder gotcha](../gotchas/pnpm-12-placeholder-bin-runs-under-node.md)
for what the un-overlaid layout looks like from a runner.

## Stability

The protocol surfaces (`ActionCache`, `Artifact`, `BlobStore` and its
backends, `BlobEnvelope`, `CacheKey`, `ToolInstaller`,
`PackageManagerInstaller`) are the contract; `internal/` (the request
signer, the Twirp client, the results-backend reader) is not.
