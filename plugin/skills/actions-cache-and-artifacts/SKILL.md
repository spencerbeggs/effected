---
name: actions-cache-and-artifacts
description: Use when caching a dependency directory in a GitHub Action, uploading or downloading a workflow artifact, installing a toolchain into the runner's tool cache, or storing a keyed blob with caller-owned metadata against the runner's Actions cache or an S3-compatible bucket. Trigger phrases include ACTIONS_RESULTS_URL, ACTIONS_RUNTIME_TOKEN, tool cache, blob store, ActionCache, Artifact, GitHubCacheBlobStore, BlobStore, S3Config, ToolInstaller, CacheKey, hashFiles, restore keys, FileBlobTransfer, DataBlobTransfer, stage-then-swap, signedUploadUrl, Twirp retry, @azure/storage-blob confinement.
---

# Actions cache and artifacts

The storage tier of `@effected/github-actions`: caches, artifacts, blobs, and
installed tools. No predecessor covered any of it — `@actions/cache` and
`@actions/artifact` are both re-implemented directly against their HTTP
protocols, because either dependency alone drags a tree larger than this
package (`packages/github-actions/CLAUDE.md`).

For the general Effect v4 service/layer rules this package follows —
`Context.Service`, `provideMerge` vs `mergeAll`, memoization by reference —
see `effect-v4-services-layers`; this skill carries only the
storage-specific instance of each.

## Which one do I want

| Need | Service | Layer | `R` (besides itself) | Error |
| --- | --- | --- | --- | --- |
| Archive and restore a dependency directory across jobs | `ActionCache` | `ActionCache.layer` | `ActionEnvironment \| HttpClient \| FileSystem \| Path \| ChildProcessSpawner` | `ActionCacheError` |
| Upload, list, get, download or delete a workflow artifact | `Artifact` | `Artifact.layer` | same five | `ArtifactError` |
| A keyed blob with caller-owned metadata, in the Actions cache | `BlobStore` over `GitHubCacheBlobStore.layer` | `GitHubCacheBlobStore.layer` | `HttpClient \| ActionEnvironment` | `BlobStoreError \| BlobEnvelopeError` |
| Same, in S3 / R2 / MinIO / Spaces | `BlobStore` over `BlobStore.layerS3(config)` | `BlobStore.layerS3(config)` | `HttpClient \| ActionOutputs` | same |
| A cache key, its restore-key ladder, and `hashFiles` | `CacheKey` | none — a pure `Schema.Class` with `Effect.fn` statics | `FileSystem` (`hashFiles`), `+ Path` (`matchingFiles`) | `CacheKeyError` |
| Download, extract and cache a toolchain | `ToolInstaller` | `ToolInstaller.layer` | `ActionEnvironment \| FileSystem \| Path \| HttpClient \| ChildProcessSpawner` | `ToolInstallerError` |

**Only `ActionCache`, `Artifact` and `GitHubCacheBlobStore.layer` speak to the
Actions results backend** (`ACTIONS_RESULTS_URL` / `ACTIONS_RUNTIME_TOKEN`) —
see Trap 1. `BlobStore.layerS3` and `ToolInstaller` need neither variable and
work identically from a `run:` shell step.

**`ActionCache`'s `paths` are GLOB PATTERNS on save, hashed LITERALLY on
both sides.** `save` resolves them with actions/cache parity before tar
(`**/node_modules` matches directories, archived recursively; non-matching
patterns — absent literals included — are dropped silently; a fully-empty
resolution fails typed with zero backend calls; `~` and `!` work; relative
patterns root at `GITHUB_WORKSPACE`). `restore`'s tar is pure extract and
consumes no paths — its `paths` argument exists only to derive the cache
**version**, which hashes the LITERAL pattern list on both save and restore
(toolkit parity: `getCacheVersion` never sees resolved paths), so the same
literal list must be passed to both or the entry is invisible. Until
2026-08-02 save handed patterns to tar verbatim and every glob-carrying
list failed on a real runner as `tar: **/…: Cannot stat` — treat that
message as the resolution-was-skipped signature.

`ActionRuntime.layer` provides none of the six services above by default —
see `actions-runtime` for why, and for the one-line cost of taking one
(`Action.run(program, { layer: ActionCache.layer })`).

## Trap 1 — the results backend answers only from a `uses:` step

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` all speak the same
Twirp v2 protocol at `ACTIONS_RESULTS_URL` with `ACTIONS_RUNTIME_TOKEN`
(`internal/actionsResults.ts:57,60`). The runner injects both into **action**
execution contexts and not into `run:` shell steps, so code that works from a
bundled action fails as `misconfigured` when a workflow invokes the identical
code with `node ./main.js` — nothing else in the environment tells the two
cases apart.

`resultsBackend` (`internal/actionsResults.ts:137-152`) reads the pair through
`ActionEnvironment.getOptional`, per call, and fails with the **bare variable
name** when either is absent:

```ts
export const resultsBackend = (env: ActionEnvironmentShape): Effect.Effect<ResultsBackend, string> =>
 Effect.gen(function* () {
  const url = yield* env.getOptional(RESULTS_URL);
  const token = yield* env.getOptional(RUNTIME_TOKEN);
  if (Option.isNone(url)) {
   return yield* Effect.fail(RESULTS_URL);
  }
  if (Option.isNone(token)) {
   return yield* Effect.fail(RUNTIME_TOKEN);
  }
  // ...
 });
```

Each of the three services wraps that string into its own typed
`"misconfigured"` reason, naming the variable in the message
(`ActionCache.ts:179-187`, `BlobStore.githubCache.ts:80-88`, and per-artifact
in `Artifact.ts:274-283`):

```ts
const backend = resultsBackend(env).pipe(
 Effect.mapError(
  (name) =>
   new ActionCacheError({
    reason: "misconfigured",
    detail: `${name} is not set — the Actions cache is only reachable from a \`uses:\` step, never from \`run:\``,
   }),
 ),
);
```

**Resolved per call, not at construction.** Only the `ActionEnvironment`
service itself is resolved once, at layer build time, so every member's `R`
stays `never` — the same fix `ActionEnvironment.payload` needed. Resolving
`RESULTS_URL`/`RUNTIME_TOKEN` at construction instead would fail merely
*composing* the layer outside Actions, including for an action that never
touches the cache.

**`Artifact` has a third failure mode the other two don't**: the run/job
backend ids come from the runtime token's own `scp` claim
(`internal/actionsResults.ts:94-118`, `backendIdsFrom`), decoded from the
plaintext token *before* it is wrapped in `Redacted`. A token with no
`Actions.Results` scope is `misconfigured` too, not a call failure
(`Artifact.ts:284-296`):

```ts
Result.isFailure(resolved.backendIds)
 ? Effect.fail(new ArtifactError({ reason: "misconfigured", artifact, detail: resolved.backendIds.failure }))
 : Effect.succeed({ baseUrl: resolved.baseUrl, token: resolved.token, ids: resolved.backendIds.success });
```

**The runtime token is never declassified.** It arrives from
`ActionEnvironment` as plaintext, is wrapped in `Redacted` at the read, and
leaves only through `HttpClientRequest.bearerToken`, which accepts a
`Redacted` directly (`internal/twirp.ts:103-108`). `Redacted.value` still
appears nowhere in this package outside `Secret.ts` — see
`actions-state-and-secrets` for the declassification seam in full.

## Trap 2 — Azure is confined to exactly three modules

`@azure/storage-blob` is the only heavy dependency here, and the confinement
is structural, not a style preference: a consumer that imports only
`ActionOutputs` must be unable to link Azure into its bundle. Three modules
may import it — `ActionCache.ts`, `Artifact.ts`, `BlobStore.githubCache.ts` —
**three, not the two a casual read of the spec suggests**, because the
Actions-cache Twirp protocol itself hands back an Azure blob URL for the
payload.

**No shared helper in `internal/` may import it.** An internal helper is
exactly how a heavy import leaks into a light module's graph, so each of the
three modules carries its **own** ~15-line Azure adapter instead of sharing
one — the duplication *is* the invariant (`ActionCache.ts:105-134`,
`Artifact.ts:198-224`, `BlobStore.githubCache.ts:34-55`; each is byte-for-byte
the same shape: `BlockBlobClient(url).uploadFile/uploadData`,
`BlobClient(url).downloadToFile/downloadToBuffer`, wrapped in
`Effect.tryPromise` into `BlobTransferError`). `internal/actionsResults.ts` and
`internal/twirp.ts` — the two modules all three share — reach only `effect`
and `effect/unstable/http`, never Azure.

The three are **separate named re-exports** in `index.ts`, never gathered
into a namespace object — `export const Stores = { cache, artifact, blob }`
would make every one of them reachable from any of them, the same barrel
hazard the config-codec packages guard against.

`__test__/reachability.test.ts` measures this rather than asserting it:

- a **control** proves the three permitted modules *do* reach Azure — without
  it, every other assertion could pass because the walker is blind, not
  because the edge is absent;
- exact edge-set assertions for the light modules (`ActionOutputs.ts` reaches
  only `effect`; `CacheKey.ts` reaches `@effected/glob`, `effect`,
  `node:crypto`; `Action.ts` reaches `@effect/platform-node`, `effect`,
  `effect/unstable/http` — never Azure);
- its own discriminating test for the comment stripper, because the stripper
  must run **line comments before block comments** — prose containing an
  `@azure/*`-shaped token opens what looks like a block comment to the regex,
  and stripping blocks first eats the real imports that follow, silently, in
  the safe direction for a `notInclude` check and the dangerous one for the
  reachability walk.

`ActionRuntime.layer` excludes all three services for the identical reason —
folding the cache into the default runtime would put a blob-storage client in
the bundle of every action that merely sets an output. See `actions-runtime`
for the runtime's composition and the one-line cost of opting a service back
in.

## Trap 3 — the tool cache only ever contains complete tools

`ToolInstaller.cacheDir`/`cacheFile` **stage into a temp directory under the
cache root, then rename into place** — never copy straight to the
destination:

```ts
const swapIntoCache = (staging: string, tool: string, version: string): Effect.Effect<string, ToolInstallerError> =>
 Effect.gen(function* () {
  const destination = cachePath(tool, version);
  yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
  // A previous interrupted install, or a re-install of the same version.
  yield* fs.remove(destination, { recursive: true, force: true });
  yield* fs.rename(staging, destination);
  return destination;
 }).pipe(Effect.mapError((cause) => new ToolInstallerError({ reason: "cacheFailed", subject: tool, cause })));
```

(`ToolInstaller.ts:174-182`.) Copying straight to the destination leaves a
**partial** tool behind on failure, and `ToolInstaller.find`'s check —
`fs.stat` reporting a `Directory` — reports that partial directory as a
**hit** (`ToolInstaller.ts:239-244`). Every later run then uses a broken
toolchain and never re-downloads it: the worst kind of cache failure, because
it is silent and it compounds.

**The staging directory must stay under the cache root**
(`ToolInstaller.ts:184-205`, `staged`):

```ts
// `directory: root` matters: a rename across filesystems is not atomic
// (and on many platforms not permitted at all), so the staging area has
// to live under the cache root rather than in the system temp directory.
yield* fs.makeDirectory(root, { recursive: true });
const staging = yield* fs.makeTempDirectory({ directory: root, prefix: ".staging-" });
```

`os.tmpdir()` is a different filesystem on most CI images, so a rename from
there would silently degrade to a copy — and a copy is exactly the
naive-and-wrong implementation this trap exists to rule out. `staged` also
removes the staging directory on the **failure path only**
(`Effect.tapCause`): on success it has already been renamed away, so nothing
is left to clean up.

`ToolInstaller.cachePath` is the layout contract with the runner —
`<root>/<tool>/<version>/<arch>`, using Node's `process.arch` spelling
(`x64`), not the runner's `RUNNER_ARCH` (`X64`) — and it is pure, exported,
and tested on its own (`ToolInstaller.ts:356-361`) because a tool cached at
any other path is invisible to every other step in the workflow.

## Trap 4 — both field spellings are read, and retry is structural

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` all decode Twirp
responses through `field`/`stringField`/`isOk` (`internal/twirp.ts:140-156`):

```ts
export const field = (body: unknown, name: string): unknown => {
 if (typeof body !== "object" || body === null) return undefined;
 const record = body as Record<string, unknown>;
 const snake = name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
 return record[name] ?? record[snake];
};
```

The backend is an internal, reverse-engineered protocol whose two halves
disagree: protobuf JSON emits `signedUploadUrl`, some cache RPCs answer
`signed_upload_url`. Reading only one is the sharpest possible silent
failure — the cache or artifact upload/download URL comes back
`undefined`, the operation reports `refused` with no HTTP status to blame,
and the workflow log reads "the cache never hits" with no further clue.
Guess wrong and the failure is indistinguishable from a real outage.

**Twirp retry is structural, not stringly-typed, and lives in exactly one
place.** `TwirpFailure` (`internal/twirp.ts:44-57`) is keyed on `kind:
"transport" | "status" | "malformed"`, not a formatted message — the
predecessor tested for the substrings `"HTTP 503"` and `"ECONNRESET"`, which
made rewording a message a silent policy change. `isRetryable`
(`internal/twirp.ts:70-78`) retries a transport fault unconditionally and a
`408`/`429`/`5xx` status, never a `malformed` body or any other status:

```ts
export const isRetryable = (failure: TwirpFailure): boolean => {
 if (failure.kind === "transport") return true;
 if (failure.kind === "malformed" || failure.status === undefined) return false;
 return failure.status >= 500 || failure.status === 408 || failure.status === 429;
};
```

`twirpCall` (`internal/twirp.ts:93-126`) applies the retry itself — 4 retries,
`Schedule.exponential("3 seconds", 1.5)` — so **no protocol built on top of it
can ship without the retry policy**; a caller cannot forget to wrap a call.
A `409` short-circuits to the exported `CONFLICT` sentinel before retry even
applies, because a conflict means "this already exists," which is a success
for a save and a miss for a lookup — two different answers the *caller*
chooses between, never the transport.

## The transport seam

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` each take their transport
as an argument rather than hard-wiring the Azure client:

```ts
// BlobTransfer.ts:41-65
export interface FileBlobTransfer {
 readonly uploadFile: (url: string, file: string) => Effect.Effect<void, BlobTransferError>;
 readonly downloadToFile: (url: string, file: string) => Effect.Effect<void, BlobTransferError>;
}

export interface DataBlobTransfer {
 readonly uploadData: (url: string, data: Uint8Array) => Effect.Effect<void, BlobTransferError>;
 readonly downloadToBuffer: (url: string) => Effect.Effect<Uint8Array, BlobTransferError>;
}
```

`FileBlobTransfer` moves whole files (the cache and artifact protocols never
touch a payload in memory); `DataBlobTransfer` moves buffers (the blob store
never touches a filesystem path). Split rather than merged, because a single
four-member interface would force every implementation to stub two members it
can never be asked for.

Each of the three services ships both a bound `layer` (the real Azure client)
and a `layerWith(transfer)` beside it — `ActionCache.layerWith`
(`ActionCache.ts:393-403`), `Artifact.layerWith` (`Artifact.ts:641-651`),
`GitHubCacheBlobStore.layerWith` (`BlobStore.githubCache.ts:216-219`). What
this package owns and tests is the **protocol** — the RPC sequence, conflict
handling, version derivation, retry policy, framing; the pre-signed `PUT`
itself is not. Supplying the transport is what lets a test exercise the
first group (real `tar`, real archive contents, real conflict handling)
without the second, and it is the same seam an integration test uses to
point the real protocol at a local endpoint. Same shape as
`@effected/sbom`'s `SigstoreSigner.layerWith`.

**A parameterized layer factory mints a fresh reference per call** — bind
`layerWith(transfer)`'s result to a `const` rather than calling it at each
composition site; see `effect-v4-services-layers`'s memoization section for
why that matters.

`BlobStore.layerMemory` (`BlobStore.ts:172-190`) is the in-memory double for
`BlobStore` itself, and it is **not a stub**: it runs the real `BlobEnvelope`
framing on every `get`/`put`, so a round trip through it proves metadata
survives storage rather than merely asserting the double's own echo.

## Framing: `BlobEnvelope`, briefly

`BlobStore`, `GitHubCacheBlobStore` and `BlobStore.layerS3` all put bytes
behind `BlobEnvelope`'s schema-versioned frame before they ever reach a
transport — `[4B magic "EFBS"][1B version][4B metadata length][metadata
JSON][body]`. The frame's shape, its five-reason error union, and why a
legacy raw blob decodes as a clean `notAnEnvelope` miss rather than garbage
are covered in full in `actions-state-and-secrets` — this skill names it only
to place it in the storage flow: `BlobStore.put`/`get`
(`BlobStore.ts:64-76`) and `GitHubCacheBlobStore`'s `put`/`get`
(`BlobStore.githubCache.ts:110-154`) both call
`BlobEnvelope.encodeResult`/`decodeResult` per call, with the caller's own
`Schema.Codec` as the metadata contract — the package owns *framing*, the
caller owns *meaning*.

`GitHubCacheBlobStore`'s Twirp `version` field is a **constant hash**
(`BlobStore.githubCache.ts:32`, `createHash("sha256").update("blobstore|1.0")`)
rather than `ActionCache`'s path-derived version — a blob store has no
archived paths to hash, so every key maps to one reproducible Twirp slot, and
a **format** change stays inside the envelope (`unsupportedVersion`) rather
than becoming a second version channel that can disagree with the real one.

## `CacheKey` and where `hashFiles` lives

`CacheKey` is a pure `Schema.Class` — no service, no layer — over validated,
comma/newline-refusing segments (`CacheKey.ts:52-58`), with a restore-key
ladder that is **policy-carrying, not only derived**: absent policy, every
prefix becomes a rung (most-specific first); `withRestoreDepths([4, 3])`
makes the key carry an explicit ladder (each depth = leading segments kept,
rungs emitted in the order given — order IS the policy, GitHub tries them in
order); `withoutRestoreKeys()` is the exact-match-only spelling (zero
rungs). All three ride the same schema field, survive `ActionState` round
trips, and pass through `ActionCache.restore(paths, cacheKey)` untouched —
never hand-build a ladder beside a typed key. The default derivation drops
one trailing segment per rung; the depths grammar lives in the class TSDoc
(`CacheKey.ts`, the `restoreKeys` getter and `withRestoreDepths` remarks —
line numbers shift, search the members). Two properties every hand-rolled
ladder gets wrong:
**every rung ends in the separator** — GitHub matches a restore key as a bare
prefix, so `Linux-pnpm` (no trailing `-`) would also match
`Linux-pnpmx-…` from an unrelated cache — and **a one-segment key produces no
rung at all**, because an empty prefix would match every cache in the
repository. `CacheKey.forBranch` orders segments `os → scope → branch →
hash` deliberately (`CacheKey.ts:128-147`): reversed, a feature branch's
first fallback would jump to `main` before ever trying its own branch.

`CacheKey.hashFiles` (`CacheKey.ts:168-182`) is **byte-compatible with
`@actions/glob`'s `hashFiles`**, and every detail that makes it so is easy to
get wrong: paths are sorted and de-duplicated before hashing, each file is
digested on its own, and the per-file digest feeds the accumulator as
**binary**, not hex:

```ts
accumulator.update(createHash("sha256").update(bytes).digest());
```

A hex-fed accumulator produces a perfectly plausible-looking digest that
simply never matches a cache entry written by any other action in the same
workflow. `Option.none()` for an empty file set — "nothing matched" is not a
digest, it is the signal that a pattern is wrong, and folding it into a key
would cache silently against a constant.

`CacheKey.matchingFiles` (`CacheKey.ts:207-238`) is discovery, kept
deliberately separate from matching: the walk is core
`FileSystem.readDirectory(workspace, { recursive: true })`, the matching is
`@effected/glob`'s `GlobSet` — the same minimatch dialect `@actions/glob`
uses, so a workflow author's `!**/node_modules/**` behaves identically to
every other cache step in the same workflow. `node:fs.globSync` was rejected
on a correctness argument, not a weight one: it welds discovery and matching
into one non-stubbable call, and Node's glob dialect is not minimatch — a
dialect divergence is a *silent* cache-key difference from every sibling
action, the worst failure mode a cache key has. Candidates are matched by
their path **relative to the workspace**, which makes "never hash a file
outside the workspace" structural; directories are excluded by an explicit
`fs.stat` check, because a directory named `notes.txt` matches `**/*.txt` and
is not a file. `CacheKey.hashMatching` is `matchingFiles` fed straight into
`hashFiles` — the pairing every consumer otherwise writes by hand, whose two
halves have to agree about ordering.

**`hashFiles` is homed here honestly, not permanently.** It cannot live in
`@effected/glob` — pure tier, forbidden the FS dependency and does no IO — and
it cannot live in `@effected/walker` today, because core `Crypto` at
beta.101 is RNG-and-digest-only with no HMAC, and this package is licensed
for `node:crypto` while a boundary-tier package is not. If a second,
non-Actions consumer ever wants `hashFiles`, that is the trigger to move it —
into a small `@effected/hash` package, or back into `walker` once core grows
an HMAC contract — not a reason to duplicate it in place.

## `node:` imports, and no `@actions/*`

`node:crypto` is sanctioned throughout this tier — `ActionCache.versionOf`
and `GitHubCacheBlobStore`'s constant `VERSION` hash both use
`createHash("sha256")`, `Artifact.digestOf` streams a SHA-256 over the
**stored zip** rather than buffering it (an artifact is the one payload here
with no size ceiling), and `BlobStore.layerS3`'s SigV4 signer HMACs with it —
because core `Crypto` exposes digests but no HMAC at beta.101. `node:zlib`
and `node:stream` back the cache and artifact codecs for the same reason.
This is the one package in the kit licensed for a direct `node:` import; see
`packages/github-actions/CLAUDE.md` for the full accounting and
`effect-v4-services-layers`'s platform-capabilities section for why every
other package requires-in-`R` instead.

**No `@actions/*` dependency anywhere in this tier.** `@actions/cache` and
`@actions/artifact` are each implemented directly against their HTTP
protocols; `@actions/tool-cache` is reproduced as a directory layout
contract (`ToolInstaller.cachePath`) rather than imported. Reaching for one
of these packages to "save time" is the wrong instinct here — the point of
this tier is that the protocol is small enough to own directly, and owning it
is what makes every trap above testable.

## Everything that can go through a core contract does

Sanctioned is not unlimited. `ToolInstaller.download` runs over core
`HttpClient`, streaming the response body to disk with `Stream.run(response.
stream, fs.sink(file))` rather than buffering (`ToolInstaller.ts:207-236`) —
retried up to twice with `Schedule.exponential("1 second")`, gated on
`ToolInstallerError.retryable` (a `5xx`/`408`/`429` on `downloadFailed`, never
a `404`, which is the server saying "never" rather than "later"). Extraction
(`extractTar`/`extractZip`) and every archive step in `ActionCache` and
`Artifact` run over core `ChildProcessSpawner` in `R`, never a hand-rolled
`node:child_process` spawn — the `commands` invariant applies to this tier
exactly as it does everywhere else in the kit. `CacheKey` reads file
contents over core `FileSystem`. The `node:` licence covers what core
genuinely cannot do (HMAC, gzip framing), not a blanket exemption from
requiring platform capabilities in `R`.

## Where the rest of this territory lives

Name these by, don't restate their contents:

- `actions-runtime` — `Action.run`, `ActionRuntime.layer`'s composition, and
  the one-line cost of adding `ActionCache`/`Artifact`/`GitHubCacheBlobStore`
  to a program's extra layer.
- `actions-state-and-secrets` — `BlobEnvelope`'s wire format and error union
  in full, the `Redacted` runtime token, `Secret`'s declassification seam
  (`forSigning` is what lets `BlobStore.layerS3` sign with a raw HMAC key
  without a second unwrap seam), and `HttpClientRequest.bearerToken`.
- `running-commands-and-tools` — `ToolDiscovery`, which answers "is this
  tool already on the runner," a different question from `ToolInstaller`'s
  "install it here."
- `testing-actions` — `layerTest` doubles for every service in this tier, the
  `settle`-fiber pattern for retry tests under `TestClock`, and the fake
  `fetch` decoding trap (`Response`, never `String(init.body)`) that once
  presented as ten unrelated timeouts.
