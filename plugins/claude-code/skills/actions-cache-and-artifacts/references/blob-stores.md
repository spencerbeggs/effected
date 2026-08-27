# Blob stores, the results backend, and the Twirp protocol

## The results backend answers only from a `uses:` step

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` all speak the same
Twirp v2 protocol at `ACTIONS_RESULTS_URL` with `ACTIONS_RUNTIME_TOKEN`.
The runner injects both into **action** execution contexts and not into
`run:` shell steps, so code that works from a bundled action fails as
`misconfigured` when a workflow invokes the identical code as a plain
script — nothing else in the environment tells the two cases apart.

The internal lookup reads the pair through `ActionEnvironment`, per call,
and fails with the **bare variable name** when either is absent:

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
`"misconfigured"` reason, naming the variable in the message:

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
service itself is resolved once, at layer build time, so every member's
`R` stays `never` — resolving `RESULTS_URL`/`RUNTIME_TOKEN` at
construction instead would fail merely *composing* the layer outside
Actions, including for an action that never touches the cache.

**`Artifact` has a third failure mode the other two don't**: the run/job
backend ids come from the runtime token's own claims, decoded from the
plaintext token *before* it is wrapped in `Redacted`. A token with no
results-API scope is `misconfigured` too, not a call failure.

**The runtime token is never declassified.** It arrives from
`ActionEnvironment` as plaintext, is wrapped in `Redacted` at the read, and
leaves only through `HttpClientRequest.bearerToken`, which accepts a
`Redacted` directly. `Redacted.value` still appears nowhere in this
package outside `Secret.ts` — see `actions-state-and-secrets` for the
declassification seam in full.

## Azure is confined to exactly three modules

`@azure/storage-blob` is the only heavy dependency here, and the
confinement is structural, not a style preference: a consumer that
imports only a light service like `ActionOutputs` must be unable to link
Azure into its bundle. **Three** modules may import it — the ones backing
`ActionCache`, `Artifact` and `GitHubCacheBlobStore` — not the two a
casual read of the cache/blob split suggests, because the Actions-cache
Twirp protocol itself hands back an Azure blob URL for the payload.

**No shared helper may import it.** An internal helper is exactly how a
heavy import leaks into a light module's graph, so each of the three
modules carries its **own** small Azure adapter instead of sharing one —
the duplication *is* the invariant; every shared internal module the three
have in common reaches only `effect` and its HTTP layer, never Azure.

The three are **separate named re-exports**, never gathered into a
namespace object — bundling them under one exported object would make
every one of them reachable from any of them, the same barrel hazard
zero-dependency codec packages elsewhere in the kit guard against.

A reachability test measures this rather than asserting it:

- a **control** proves the three permitted modules *do* reach Azure —
  without it, every other assertion could pass because the walker itself
  is blind, not because the edge is absent;
- exact edge-set assertions for the light modules — a plain output service
  reaches only `effect`; the pure cache-key module reaches only a glob
  package, `effect`, and `node:crypto`; the entry-point module reaches the
  platform-node package, `effect`, and the HTTP layer — never Azure;
- its own discriminating test for the comment stripper, because the
  stripper must run **line comments before block comments** — prose
  containing an Azure-package-shaped token in a comment opens what looks
  like a block comment to the regex, and stripping blocks first eats the
  real imports that follow, silently, in the safe direction for a
  `notInclude` check and the dangerous one for the reachability walk.

`ActionRuntime.layer` excludes all three services for the identical
reason — folding the cache into the default runtime would put a
blob-storage client in the bundle of every action that merely sets an
output. See `actions-runtime` for the runtime's composition and the
one-line cost of opting a service back in.

## Both field spellings are read, and retry is structural

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` all decode Twirp
responses through a field reader that tries both spellings:

```ts
export const field = (body: unknown, name: string): unknown => {
  if (typeof body !== "object" || body === null) return undefined;
  const record = body as Record<string, unknown>;
  const snake = name.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  return record[name] ?? record[snake];
};
```

The backend is an internal, reverse-engineered protocol whose two halves
disagree: one representation emits camelCase, some RPCs answer
snake_case. Reading only one is the sharpest possible silent failure — the
cache or artifact upload/download URL comes back `undefined`, the
operation reports a refusal with no HTTP status to blame, and the workflow
log reads "the cache never hits" with no further clue. Guess wrong and the
failure is indistinguishable from a real outage.

**Twirp retry is structural, not stringly-typed, and lives in exactly one
place.** A dedicated failure type is keyed on a `kind` discriminant —
`"transport" | "status" | "malformed"` — never a formatted message;
matching against a message substring makes rewording that message a
silent policy change in what gets retried. Retry applies to a transport
fault unconditionally and to a `408`/`429`/`5xx` status, never a
`malformed` body or any other status:

```ts
export const isRetryable = (failure: TwirpFailure): boolean => {
  if (failure.kind === "transport") return true;
  if (failure.kind === "malformed" || failure.status === undefined) return false;
  return failure.status >= 500 || failure.status === 408 || failure.status === 429;
};
```

The retry itself is applied by the one shared call wrapper — four
retries, exponential backoff — so **no protocol built on top of it can
ship without the retry policy**; a caller cannot forget to wrap a call. A
`409` short-circuits to a conflict sentinel before retry even applies,
because a conflict means "this already exists," which is a success for a
save and a miss for a lookup — two different answers the *caller* chooses
between, never the transport.

## The transport seam

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` each take their
transport as an argument rather than hard-wiring the Azure client:

```ts
export interface FileBlobTransfer {
  readonly uploadFile: (url: string, file: string) => Effect.Effect<void, BlobTransferError>;
  readonly downloadToFile: (url: string, file: string) => Effect.Effect<void, BlobTransferError>;
}

export interface DataBlobTransfer {
  readonly uploadData: (url: string, data: Uint8Array) => Effect.Effect<void, BlobTransferError>;
  readonly downloadToBuffer: (url: string) => Effect.Effect<Uint8Array, BlobTransferError>;
}
```

`FileBlobTransfer` moves whole files (the cache and artifact protocols
never touch a payload in memory); `DataBlobTransfer` moves buffers (the
blob store never touches a filesystem path). Split rather than merged,
because a single four-member interface would force every implementation to
stub two members it can never be asked for.

Each of the three services ships both a bound `layer` (the real Azure
client) and a `layerWith(transfer)` beside it. What this package owns and
tests is the **protocol** — the RPC sequence, conflict handling, version
derivation, retry policy, framing; the pre-signed `PUT` itself is not.
Supplying the transport is what lets a test exercise the protocol (real
`tar`, real archive contents, real conflict handling) without the
network, and it's the same seam an integration test uses to point the
real protocol at a local endpoint.

**A parameterized layer factory mints a fresh reference per call** — bind
`layerWith(transfer)`'s result to a `const` rather than calling it at each
composition site; see `effect-v4-services-layers`'s memoization section
for why that matters.

`BlobStore.layerMemory` is the in-memory double for `BlobStore` itself,
and it is **not a stub**: it runs the real `BlobEnvelope` framing on every
`get`/`put`, so a round trip through it proves metadata survives storage
rather than merely asserting the double's own echo.

## `BlobEnvelope`: the schema-versioned frame

Cache and blob-store payloads get a metadata channel that raw bytes don't
have. `BlobEnvelope` is deliberately **pure**: no IO, no service, just
`Result`-returning encode/decode over a byte array. `BlobStore`,
`GitHubCacheBlobStore` and `BlobStore.layerS3` all put bytes behind this
frame before they ever reach a transport, using the caller's own
`Schema.Codec` as the metadata contract — the package owns **framing**,
the caller owns **meaning**.

Wire layout:

```text
[4B magic "EFBS"][1B version][4B metadata length, big-endian][metadata JSON][body]
```

`MAGIC` is the ASCII bytes for `EFBS`. A version digit folded into the
magic would be a second version channel that can disagree with the real
one; the magic identifies the frame *family*, the version byte identifies
the *revision*.

The failure union is sized to what a caller actually branches on.
`BlobEnvelopeError` is a **union type alias**, not a class with a `reason`
field — one class per failure, so you construct the member and
discriminate on `_tag`, and `Effect.catchTag` recovers from exactly one of
them rather than all five:

| `_tag` | Fires when |
| --- | --- |
| `NotABlobEnvelopeError` | The 4-byte magic is absent — a legacy, unframed blob, or garbage |
| `UnsupportedBlobEnvelopeVersionError` | The version byte doesn't match what this build writes |
| `TruncatedBlobEnvelopeError` | The buffer ends mid-header or mid-metadata |
| `BlobMetadataDecodeError` | The framed metadata JSON doesn't satisfy the caller's schema |
| `BlobMetadataEncodeError` | The value being stored doesn't satisfy the schema on the way out |

**A legacy raw blob decodes as a typed `NotABlobEnvelopeError` clean miss, on
purpose.** A consumer migrating an existing cache from a hand-rolled
binary frame to this envelope gets a decode failure it can treat as "not
cached yet," not a corrupt read of garbage metadata — the magic check runs
before anything else on decode. **The version lives in the blob, not in
the key**: a format revision is detected on read (`UnsupportedBlobEnvelopeVersionError`)
and reported typed, so keys stay stable across revisions and stale
entries simply age out rather than needing a hand-rolled namespace prefix.

The decoded body is a genuine copy, never a view over the frame's own
buffer — it must not alias the source bytes, or a caller mutating the
returned body would corrupt the envelope it was read from.

`GitHubCacheBlobStore`'s Twirp `version` field is a **constant hash**
rather than `ActionCache`'s path-derived version — a blob store has no
archived paths to hash, so every key maps to one reproducible Twirp slot,
and a **format** change stays inside the envelope (`UnsupportedBlobEnvelopeVersionError`)
rather than becoming a second version channel that can disagree with the
real one.

The stage-then-swap discipline that keeps a partial write from ever
looking like a hit belongs to `ToolInstaller`'s tool cache, not the blob
services above — see `references/installers.md` for the full mechanism;
the same "never let a partial write pass as complete" instinct applies
here too, enforced instead by the envelope's own truncation detection on
read.
