---
name: actions-cache-and-artifacts
description: >-
  Use when caching a dependency directory in a GitHub Action, uploading or downloading a workflow
  artifact, installing a toolchain or an exact package-manager version into the runner's tool
  cache, or storing a keyed blob against the Actions cache or an S3-compatible bucket.
---

# Actions cache and artifacts

The storage tier of `@effected/github-actions`: caches, artifacts, blobs, and installed tools. `@actions/cache` and `@actions/artifact` are both re-implemented directly against their own HTTP protocols rather than taken as dependencies — either one alone drags a tree larger than this whole package.

For the general Effect v4 service/layer rules this package follows — `Context.Service`, `provideMerge` vs `mergeAll`, memoization by reference — see `effect-v4-services-layers`; this skill carries only the storage-specific instance of each.

## What you have

| Need | Service | Layer | `R` (besides itself) | Error |
| --- | --- | --- | --- | --- |
| Archive and restore a dependency directory across jobs | `ActionCache` | `ActionCache.layer` | `ActionEnvironment \| HttpClient \| FileSystem \| Path \| ChildProcessSpawner` | `ActionCacheError` |
| Upload, list, get, download or delete a workflow artifact | `Artifact` | `Artifact.layer` | same five | `ArtifactError` |
| A keyed blob with caller-owned metadata, in the Actions cache | `BlobStore` over `GitHubCacheBlobStore.layer` | `GitHubCacheBlobStore.layer` | `HttpClient \| ActionEnvironment` | `BlobStoreError \| BlobEnvelopeError` |
| Same, in S3 / R2 / MinIO / Spaces | `BlobStore` over `BlobStore.layerS3(config)` | `BlobStore.layerS3(config)` | `HttpClient \| ActionOutputs` | same |
| A cache key, its restore-key ladder, and `hashFiles` | `CacheKey` | none — a pure `Schema.Class` with `Effect.fn` statics | `FileSystem` (`hashFiles`), `+ Path` (`matchingFiles`) | `CacheKeyError` |
| Download, extract and cache a toolchain | `ToolInstaller` | `ToolInstaller.layer` | `ActionEnvironment \| FileSystem \| Path \| HttpClient \| ChildProcessSpawner` | `ToolInstallerError` |
| Pin and install an exact npm/pnpm/yarn/bun on the runner | `PackageManagerInstaller` | `PackageManagerInstaller.layer` | `ActionEnvironment \| FileSystem \| Path \| ChildProcessSpawner \| ToolInstaller` | `PackageManagerInstallerError` |

`ActionRuntime.layer` provides none of the six services above by default — see `actions-runtime` for why, and for the one-line cost of taking one (`Action.run(program, { layer: ActionCache.layer })`).

## Standards

- **Take a storage service as an explicit one-line extra layer — never expect one from `ActionRuntime.layer`.** Their requirements are already satisfied by the runtime's own services; the runtime simply doesn't provide them by default.
- **Only reach the Actions results backend from a `uses:` step.** `ActionCache`, `Artifact` and `GitHubCacheBlobStore` all need `ACTIONS_RESULTS_URL`/`ACTIONS_RUNTIME_TOKEN`, which the runner injects only into action execution contexts, not `run:` shell steps. `BlobStore.layerS3` and `ToolInstaller` need neither and work identically from either.
- **Pass `ActionCache`'s literal glob pattern list to both `save` and `restore`.** `save` resolves patterns before archiving, but the cache *version* on both sides hashes the literal pattern list, not the resolved paths — a mismatched literal list makes a saved entry invisible on restore.
- **Never share a heavy-dependency adapter through an internal helper.** Each Azure-touching module carries its own small adapter rather than importing one from a shared module — a consumer that imports only a light service must be structurally unable to link the heavy dependency into its bundle.
- **Stage into a temp directory under the cache root, then rename into place — never copy straight to a tool's final destination.** A copy left partial by a failure looks like a completed install to a directory-presence check, and every later run then uses a broken toolchain silently.
- **Read both the camelCase and snake_case spelling of a field from an internal, reverse-engineered wire response**, and key retry on a structural `kind`, never a formatted message substring — a reworded error string must never become a silent policy change in what gets retried.
- **Let everything that can go through a core contract do so.** `HttpClient` for downloads, `ChildProcessSpawner` for archive extraction, `FileSystem` for reading file contents — `node:` imports in this tier are licensed only for what core genuinely cannot do yet (HMAC, gzip framing), never as a blanket substitute.

## Footguns

- `PackageManagerInstaller.install` can answer an ambient package manager with **no `binDir`** — a consumer that always reads `binDir` breaks on that branch. See `references/installers.md`.
- A hex-fed hash accumulator in `CacheKey.hashFiles` produces a plausible-looking digest that never matches any cache entry written by `@actions/glob`'s `hashFiles` — the per-file digest must feed the accumulator as binary. See `references/cache-and-keys.md`.
- Resolved cache paths reaching `tar` via argv instead of a manifest file blow past the OS argv limit on a large glob resolution. See `references/cache-and-keys.md`.
- A legacy, unframed blob decodes as a typed clean miss against `BlobEnvelope`, on purpose — treat it as "not cached yet," never as a corrupt read. See `references/blob-stores.md`.
- The Actions-cache Twirp protocol hands back an Azure blob URL for the payload, so the Azure-touching module count is three, not the two a casual read of the cache/artifact split suggests. See `references/blob-stores.md`.

## Additional resources

- [references/cache-and-keys.md](references/cache-and-keys.md) — `ActionCache`'s glob-vs-literal path handling in full, the manifest-file tar invocation, and `CacheKey`'s restore-key ladder, `hashFiles` byte-compatibility and `matchingFiles` discovery. Load when: designing a cache step, a restore-key fallback policy, or a file-hash-derived key.
- [references/blob-stores.md](references/blob-stores.md) — the results-backend confinement rule, `BlobEnvelope`'s wire format and error union in full, the Azure three-module confinement with its reachability test, the transport seam (`FileBlobTransfer`/`DataBlobTransfer`), and the Twirp field-spelling and retry discipline. Load when: storing a keyed blob, reviewing why a cache/artifact call reports `misconfigured`, or auditing the Azure import boundary.
- [references/installers.md](references/installers.md) — `ToolInstaller`'s stage-then-swap cache write, its layout contract with the runner, `PackageManagerInstaller`'s ambient-vs-cached branch, and the `node:`-import accounting for this tier. Load when: installing a toolchain or an exact package-manager version, or reviewing a `node:` import in this package.
