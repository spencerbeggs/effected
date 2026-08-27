# `ToolInstaller` and `PackageManagerInstaller`

## The tool cache only ever contains complete tools

`ToolInstaller`'s cache write **stages into a temp directory under the
cache root, then renames into place** — never copies straight to the
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

Copying straight to the destination leaves a **partial** tool behind on
failure, and a directory-presence cache-hit check would report that
partial directory as a **hit**. Every later run then uses a broken
toolchain and never re-downloads it — the worst kind of cache failure,
because it is silent and it compounds.

**The staging directory must stay under the cache root:**

```ts
// `directory: root` matters: a rename across filesystems is not atomic
// (and on many platforms not permitted at all), so the staging area has
// to live under the cache root rather than in the system temp directory.
yield* fs.makeDirectory(root, { recursive: true });
const staging = yield* fs.makeTempDirectory({ directory: root, prefix: ".staging-" });
```

The system temp directory is a different filesystem on most CI images, so
a rename from there would silently degrade to a copy — exactly the
naive-and-wrong implementation this discipline exists to rule out.
Staging is removed on the **failure path only**: on success it has
already been renamed away, so nothing is left to clean up.

`ToolInstaller.cachePath` is the layout contract with the runner —
`<root>/<tool>/<version>/<arch>`, using Node's own architecture spelling
(`x64`), not the runner's differently-cased one — and it is pure,
exported, and tested on its own, because a tool cached at any other path
is invisible to every other step in the workflow.

## `PackageManagerInstaller`: exact-version npm/pnpm/yarn/bun over `ToolInstaller`

`PackageManagerInstaller.install(pin, options?)` answers an
`InstalledPackageManager` — a `Schema.Union` discriminated on `source`:
`AmbientPackageManager` (the runner's own toolchain already had the exact
pinned version — nothing downloaded, nothing cached, `bins` are bare
command names resolved through `PATH`, and there is **no `binDir`**) or
`CachedPackageManager` (found in or installed into the runner's tool
cache — carries an `addPath`-able `binDir`, with shims written into the
staged entry for the npm-registry managers, bun's own directory for bun).

**A consumer that always reads `binDir` breaks on the ambient answer** —
branch on `source` first. `options.allowAmbient` (default `true`)
suppresses the ambient probe entirely when the run is about to replace the
runner's Node with a pinned one, so a stale ambient npm never shadows it.

`install`'s `pin` argument is `@effected/npm`'s package-manager-pin type —
a plain `Schema.Class`, not a service, so it costs nothing in `R`. The
dependency this module takes on that package is confined to importing that
one type, on the same confinement terms as the Azure adapters — not
reachable from `ActionRuntime.layer` or any light module — so taking
`PackageManagerInstaller` costs a consumer one explicit layer line, same
as `ActionCache`.

`ToolInstaller` answers "is this tool cached, and can I install it" for an
arbitrary toolchain; `PackageManagerInstaller` answers the narrower,
sharper question "give me an exact npm/pnpm/yarn/bun" and is what you
reach for when a workflow needs a specific package-manager version rather
than a generic download.

## `node:` imports, and no `@actions/*`

`node:crypto` is sanctioned throughout this tier — hash-based version
derivation for `ActionCache` and `GitHubCacheBlobStore`, a streamed digest
over a stored artifact zip rather than buffering it, and an S3 signer's
HMAC chain — because core's cryptography contract at this Effect version
exposes digests but no HMAC. `node:zlib` and `node:stream` back the cache
and artifact codecs for the same reason. This is the one package in the
kit licensed for a direct `node:` import; see `effect-v4-services-layers`'s
platform-capabilities section for why every other package requires-in-`R`
instead.

**No `@actions/*` dependency anywhere in this tier.** `@actions/cache` and
`@actions/artifact` are each implemented directly against their HTTP
protocols; `@actions/tool-cache` is reproduced as a directory layout
contract (`ToolInstaller.cachePath`) rather than imported. Reaching for
one of these packages to "save time" is the wrong instinct here — the
point of this tier is that the protocol is small enough to own directly,
and owning it is what makes every trap above testable.

**Sanctioned is not unlimited — everything that can go through a core
contract does.** `ToolInstaller.download` runs over core `HttpClient`,
streaming the response body to disk rather than buffering it, retried up
to twice with exponential backoff, gated on a retryable classification
(`5xx`/`408`/`429`, never a `404`, which is the server saying "never"
rather than "later"). Extraction and every archive step in `ActionCache`
and `Artifact` run over core `ChildProcessSpawner` in `R`, never a
hand-rolled process spawn — the same subprocess discipline
`running-commands-and-tools` documents for the rest of the kit applies to
this tier exactly as it does everywhere else. `CacheKey` reads file
contents over core `FileSystem`. The `node:` license here covers what core
genuinely cannot do — HMAC, gzip framing — not a blanket exemption from
requiring platform capabilities in `R`.
