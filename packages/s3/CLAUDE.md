# CLAUDE.md — @effected/s3

A minimal client for one bucket of an S3-compatible store (S3, R2, MinIO, Spaces): conditional `put`, `get`, `head`, `delete`, and a strict ListObjectsV2 (`list`, and `listAll` as a `Stream`), signed with `@effected/crypto`'s `SigV4`.

**Design doc:** `@../../okf/modules/s3.md` — load before changing behaviour; it is the contract this package implements. Why a package of its own and why the listing is strict: `okf/decisions/s3-object-client-package.md`.

## Tier: boundary

`effect` is the only peer; `@effected/crypto` (`workspace:^`) is the only dependency. **No `node:` import anywhere under `src/`** (Workers-safe); `__test__/entrypoints.test.ts` walks the import graph and fails on one, and on any bare import other than `effect`, `effect/*` and `@effected/crypto`. Core `HttpClient.HttpClient`, `Digest.Digest` and `Mac.Mac` are required in `R` when the client is made and resolved once there, so every method's `R` is `never`.

## Rules that are load-bearing

- **A listing never reads as empty by accident.** A `200` `<Error>` root is `S3RequestFailed`; every other root that is not `ListBucketResult`, and anything core's decoder refuses, is `S3MalformedResponse`. `internal/documents.ts` requires `IsTruncated`, each entry's `Key`/`Size`/`LastModified`, a token on a truncated page, and a matching `KeyCount` when present. Never relax one of these into a default: that is the bug the package exists to fix.
- **XML goes through `src/internal/xml.ts` only.** It is the one seam over core `effect/encoding/Xml`, which is `@stability experimental`; re-verify it when the installed `effect` moves. Never add a hand-written XML reader or a regex over the body.
- **Send exactly what was signed.** The URL is `${origin}${signed.path}?${signed.query}` from `SigV4.sign`, never re-encoded; every header the client sets goes into the signed `headers`. The test fake re-signs every request it receives and answers `403 SignatureDoesNotMatch` on a mismatch.
- **Drain every body before reading the status**, and keep every HTTP cause through `HttpRedaction.cause`.
- **Validate before signing.** Keys, metadata names, header values and `maxKeys` fail as `S3InvalidRequest` with nothing sent. Bad options die in `resolveAddress` at construction.
- **Only `NoSuchKey` is a missing object** on `get` or `delete`: read the error document's `Code`. A `404` with `NoSuchBucket`, an HTML page, plain text or an empty body is `S3RequestFailed` (a misrouted endpoint answers `404` for every key). `head` has no body, so its `404` is `S3NotFound`.
- **Timestamps are checked before they are parsed** (`src/internal/dates.ts`): shape, then calendar. `Date` and `DateTime.make` read `"1"` as 2001 and roll `30 Feb` over to March.
- **No trace context to the store** (`HttpClient.TracerPropagationEnabled` off). Signing time is `DateTime.now`, so `TestClock` drives it.
- **No timeout or retry inside the client.** Callers compose them.
- Module-per-concept: `S3Client.ts`, `S3Error.ts`, `S3Object.ts`, `S3ListPage.ts`; pure engines in `src/internal/`; only `index.ts` re-exports.

```bash
pnpm vitest run packages/s3        # from the repo root
pnpm build --filter @effected/s3
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`), and play the store with `__test__/utils/fake-s3.ts`, a scripted `HttpClient` over `HttpClient.make` with WebCrypto `Digest` and `Mac`. The listing corpus is `__test__/fixtures/listing/`, hand-authored, with a provenance README; `listing.test.ts` asserts the file count first and fails on a fixture with no outcome row.
