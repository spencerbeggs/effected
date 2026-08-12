# Cache, artifacts and tools — @effected/github-actions

Child context file for the cache, artifact, blob-store and tool-installation
services. The rules live in the parent; this file is why they are shaped that
way.

**Parent:** [CLAUDE.md](./CLAUDE.md)
**Design depth:** `@../../.claude/design/effected/packages/github-actions-storage.md`

---

## The tool cache only ever contains complete tools

`ToolInstaller` stages under the cache root and **renames** into place. Copying
straight to the destination leaves a partial tool behind on failure, and `find`
reports a partial directory as a hit — so every later run uses a broken toolchain
and never re-downloads it. The staging directory must stay under the cache root:
a cross-filesystem rename is not atomic.

`ToolInstaller.provisionFile` (2026-08-02) packages the one composition with no
per-tool variation — a single bare binary: `find` → `download` → chmod `0o755`
(skipped when `RUNNER_OS` is Windows, and BEFORE caching, so the cache never
holds a non-executable tool) → `cacheFile`, answering `{ directory, binDir }`
where `binDir` IS the cached directory. A hit **missing the named binary** is a
foreign/partial entry and is reinstalled over, not answered. The bun path in
`PackageManagerInstaller` deliberately does not route through it — integrity
verification and zip extraction sit between its download and chmod.

`PackageManagerInstaller` (exact-version npm/pnpm/yarn/bun provisioning over
`ToolInstaller`, consuming `@effected/npm`'s `PackageManagerPin`) answers a
discriminated union on `source` (`AmbientPackageManager` | `CachedPackageManager`);
every tool-cache answer carries an `addPath`-able `binDir` — shims written into
the **staged** entry for the npm-registry managers (never a post-swap mutation;
regenerated best-effort on a foreign cache hit), bun's own directory for bun.

## Cache keys and save resolution

`ActionCache.save` (2026-08-02) resolves its `paths` as glob patterns before
`tar`, with `actions/cache` parity: matched directories archive recursively,
non-matching patterns (including absent literals) drop silently, an empty
resolution fails typed, and `versionOf` hashes the **literal** pattern list on
both save and restore — exactly as the toolkit's `getCacheVersion` does — so
restore resolves nothing and the versions agree for free. Resolved paths stay
absolute for the `-P` posture (a documented divergence from the toolkit's
workspace-relative entries). The engine is `@effected/glob`, never
`@actions/glob`.

`CacheKey.withRestoreDepths` (2026-08-02) lets a key carry an explicit
restore-key ladder — each depth is the number of leading segments a rung keeps,
emitted in the order given — because the default every-prefix ladder drops digest
segments a five-segment key must never lose. `ActionCache.restore` picks the
policy up through the same typed-key path; depths outside
`1..segments.length - 1` are refused at construction. `withoutRestoreKeys()`
(2026-08-02) is the third point in the policy space — the same field carrying
**zero rungs**, so an exact-match-only restore sends an empty `restore_keys` and
never falls back; only *absence* means the default every-prefix ladder.

`CacheKey.digest(input, length = 8)` (2026-08-02) is the segment-safe short digest
for **non-file** key segments (a version list, a branch name) — sha256, lowercase
hex, truncated, guaranteed to satisfy the segment grammar, so it drops into
`CacheKey.of` unchecked. A length outside `1..64` (or a fractional one) is wiring,
not data, and throws a `RangeError`. File content stays with `hashFiles`.

## The results backend is only reachable from a `uses:` step

`ActionCache`, `Artifact` and `GitHubCacheBlobStore` all speak the Twirp v2
protocol at `ACTIONS_RESULTS_URL` with `ACTIONS_RUNTIME_TOKEN`. The runner
injects both into **action** execution contexts and **not** into `run:` shell
steps, so identical code works from a bundled action and fails when a workflow
invokes it with `node ./main.js`. Every one of the three reports that as
`misconfigured` **naming the absent variable**, because nothing else
distinguishes the two cases.

The runtime token is wrapped in `Redacted` at the read and leaves only through
`HttpClientRequest.bearerToken`, which accepts a `Redacted` directly — so the
declassification seam is never involved and `Redacted.value` still appears only
in `Secret.ts`. The artifact backend ids come from that token's own `scp` claim,
decoded from the plaintext it arrives as, before it is wrapped.

## The transport seam

The three Azure modules take their transport as an argument: `FileBlobTransfer`
(whole files, for the cache and artifacts) and `DataBlobTransfer` (buffers, for
the blob store), with `layerWith(transfer)` beside each `layer`. The protocol —
the RPC sequence, conflict handling, version derivation, retry policy and framing
— is what this package owns and what the tests execute; the pre-signed `PUT` is
not. Same shape as `@effected/sbom`'s `SigstoreSigner.layerWith`, and it is also
how an integration test points the real protocol at a local endpoint.

Twirp retry lives **inside** `internal/twirp.ts`, keyed on a *structured* failure
(`transport` / `status` / `malformed`), so no protocol can ship without it and a
reworded message is not a silent policy change. Both field spellings
(`signedUploadUrl` and `signed_upload_url`) are read: the backend's two halves
disagree, and guessing wrong presents as "the cache silently never hits".

## Why each Azure module carries its own adapter

No shared helper in `internal/` may import `@azure/storage-blob` — an internal
helper is exactly how a heavy import leaks into a light module's import graph.
That is why each of the three carries its **own** ~15-line Azure adapter instead
of sharing one: the duplication *is* the invariant. The three are separate named
re-exports in `index.ts`, never gathered into a namespace object.

Folding the cache into `ActionRuntime.layer` would put a blob-storage client in
the import graph of every action that merely sets an output. Their requirements
are all satisfied by the runtime, so taking one costs one line:
`Action.run(program, { layer: ActionCache.layer })`.

---

**Related context:** [CLAUDE.testing.md](./CLAUDE.testing.md) for how the
confinement is measured and the real-IO rules for these modules.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
