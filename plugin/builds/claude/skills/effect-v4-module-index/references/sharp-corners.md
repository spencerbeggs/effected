# Sharp corners in core

The traps the module index surfaced that no other skill covers, each with the
source line that settles it. The `SKILL.md` lists each as one line; this is the
detail.

## Data types and runtime knobs

- `Queue` is `Queue<A, E>` in v4 — it carries an error channel and can
  `fail`/`done`, not just hold values.
- `Optic` is in core (there is no `@effect/optic` to install) and is Schema-aware.
- Transactional state is the `Tx*` family: `TxRef` + `Effect.tx`, with a core
  module per collection. There is no `STM`/`TRef`/`TMap`/`TQueue`.
- Runtime knobs (logging and tracing settings) live in `References` as
  `Context.Reference` keys; scheduling internals in `Scheduler`. There is no
  concurrency key: concurrency is a per-call `{ concurrency }` option.
- `UndefinedOr` exists for `A | undefined` ergonomics — not every optional
  needs `Option`.
- Testing utilities live in core under `effect/testing/*` — no separate
  test-support package.

## Crypto

- **`effect/crypto` is where crypto lives, and nothing in the platform bundles
  provides it.** Each family (`Digest`, `SecureRandom`, `Mac`, `Signature`,
  `Aead`, `Cipher`, `Kdf`, `KeyAgreement`, `KeyWrap`) is a `Context.Service`
  you require in `R`. `NodeServices.layer` carries none of them: provide
  `NodeCrypto.layer` (every family) or one family layer such as
  `NodeCrypto.layerDigest` from `@effect/platform-node`, or the core
  `<Family>.layerWebCrypto` on any runtime with WebCrypto (Workers included).
  In a test, provide the real `layerWebCrypto` or `Layer.mock(Digest.Digest,
  { digestHex })`; there is no `TestCrypto`.
- **`Digest` cannot fail typed, so a missing `crypto.subtle` is a defect.** Both
  members return `Effect<…>` with a `never` error channel (`crypto/Digest.ts:135-144`).
  `Digest.layerWebCrypto` builds even where `crypto.subtle` is absent (a
  browser's insecure context), and then every SHA digest **dies**; MD5 keeps
  working because it is pure TypeScript (`crypto/Digest.ts:151-153`). Never
  model "digest failed" as a domain error reason — there is nothing to catch.
- **`Digest.digest` is one-shot, and that is a dependency decision.** The
  signature is `digest(algorithm, data: Uint8Array)` — it takes the whole
  payload at once and there is **no incremental/streaming form**. So hashing a
  file, a tarball or any input without a known upper bound means buffering all
  of it in memory, where `node:crypto`'s `createHash(...).update(chunk)` walks a
  stream at constant cost. Digesting a key, a token or a short manifest is a
  fit; digesting an artifact is not. That is why
  `@effected/github-actions`' `Artifact` and `PackageManagerInstaller` stay on
  `node:crypto`: both fold a `Stream` chunk-by-chunk on purpose.

## `Cache`

- **Core `Cache` is interrupt-clean, like `Effect.cached`.** Interrupting the
  only awaiter **discards** the in-flight entry and the next `get` re-runs the
  lookup; concurrent gets still de-dupe to one lookup. Neither primitive stores an interrupt, so the
  hazard they share is the failed lookup, below.
- **…but a default-TTL `Cache` memoizes a FAILED lookup for the process
  lifetime.** `defaultTimeToLive` is `Duration.infinity` (`Cache.ts:332`), and
  the cache "stores successful **and failed** lookup results" (`Cache.ts:4`).
  One transient network blip is therefore permanent. Wherever failures are
  transient, make the TTL exit-dependent — the `timeToLive` option takes
  `(exit, key)` for exactly this (`Cache.ts:206`; the same two-argument shape on
  the cache's own field at `Cache.ts:118`). Note `Cache.make`'s `timeToLive` is
  a plain `Duration.Input` with no exit access (`Cache.ts:307`) — the
  exit-dependent form requires `makeWith`:

  ```ts
  Cache.makeWith(lookup, {
   capacity: 1000,
   timeToLive: (exit) => (Exit.isSuccess(exit) ? "1 hour" : Duration.zero),
  })
  ```

## HTTP

- `HttpClientRequest.bearerToken` accepts a **`Redacted` directly**
  (`token: string | Redacted.Redacted`, `http/HttpClientRequest.ts:468`;
  `basicAuth` likewise). A runtime token flows into request construction with **no
  declassification step at all** — which is what lets a package keep its
  secret-handling seam to one module instead of granting every request builder an
  exception to it. Do not reach for `Redacted.value` here.

## `HttpClientError`: the `reason` tags are not the type names

A client failure is one `HttpClientError` whose top-level `_tag` is always
`"HttpClientError"`, so branch on `error.reason._tag`. The values are the trap.
The reason type is declared in two layers, and **both layer names are
themselves unions, so neither ever appears as a `_tag`** (verified against
`http/HttpClientError.ts:435,444,453`):

```ts
export type RequestError = TransportError | EncodeError | InvalidUrlError
export type ResponseError = StatusCodeError | DecodeError | EmptyBodyError
export type HttpClientErrorReason = RequestError | ResponseError
```

So `error.reason._tag` is exactly one of **six** values: `"TransportError"`,
`"EncodeError"`, `"InvalidUrlError"`, `"StatusCodeError"`, `"DecodeError"`,
`"EmptyBodyError"`. A retry policy written `error.reason._tag === "ResponseError"`
(or `=== "RequestError"`) **never matches**, so it silently retries nothing —
a live-looking branch that is dead code, and green tests will not catch it.

What makes the wrong guess feel confirmed: `ResponseError` *is* a real tagged
class elsewhere, at `http/HttpServerError.ts:210`. Same name, different
module, and it is a server error rather than a client one. Timeouts are separate
again — `Cause.isTimeoutError`, not a `reason`.
