# Services — @effected/npm

The IO surfaces: registry reads, tarball reads, the publish flow, and the
executor that runs npm. Surfaces and evidence only — the rules that govern them
live in the parent.

**Parent:** [@effected/npm context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/npm.md`

## `NpmRegistry` (`src/NpmRegistry.ts`)

Registry reads over core `HttpClient`, replacing every shelled `npm view`:
`version` / `versions` / `distTags` / `publishTimes`, each taking a **per-call**
`RegistryTarget` (`{ registry?, credential? }`). `credential` replaced a bare
`token` (2026-08-23); the old field survives one minor typed `never`, so the
conditional spread that would have dropped it silently fails to compile
instead.

Four things are load-bearing:

- The registry is per-call because a publish flow probes two registries for one
  package in one program.
- A **404 is `Option.none()`**, decided on the status rather than by matching
  npm's stderr wording.
- `integrity` is typed as this package's `IntegrityHash`.
- **`version` reads a `github-packages` target through the packument** — that
  registry answers the per-version endpoint with 405 whatever the credentials,
  so the kind routes there up front, and any other registry answering 405 falls
  back the same way.

Version selection uses `Object.hasOwn`: the version number is caller input, and
a key like `constructor` must not read the prototype. `RegistryReadError` routes
on `kind: transport | status | decode`.

Two doubles: `layerTest(Partial<Shape>)` (unstubbed members die) and
`layerSeeded(RegistrySeed)` — a working fake keyed
**`registries[registry][name][version]`**, which is the shape the v3 double
lacked (it keyed by package name alone and broke two consumer suites).

## `PackageTarball` (`src/PackageTarball.ts`)

The inbound half: `extract(publishedVersion)` fetches a published `.tgz`, checks
it, unpacks the fixed `package/` root and yields the directory — `Scope`d, so
the caller never owns cleanup. Extraction shells out to `tar` through core's
`ChildProcessSpawner`; a tarball-reader dependency would make this package
integrated (parent, "the escalation").

Ordering is the claim under test, and the suite asserts it against
`@effected/memfs`: a digest mismatch fails **before** anything is written, and a
non-2xx never reaches `tar` (a 404 error page piped into the extractor reports
"could not extract", naming the wrong failure). The compare is
padding-insensitive — SRI permits an unpadded value — and an integrity form
naming no algorithm logs that it could not verify rather than passing quietly.
`TarballError.reason` is `notFound | http | integrityMismatch | extractFailed`;
`notFound` is load-bearing, because a consumer that cannot separate "no such
version" from "the fetch broke" handles both the same and reports success.

**Loading the extracted file is not part of this surface** — a dynamic
`import()` of a computed path becomes a bundler context module. Pair it with
`@effected/package-json`'s pure `resolveEntryPoint` and let the consumer load.

## `RegistryCredential` (`src/RegistryCredential.ts`)

A closed union, `{ kind: "token" }` or `{ kind: "basic" }`, taken by both the
read probe and `setupAuth` so a probe and a publish cannot authenticate
differently against the same registry. The basic arm holds the
**already-encoded** blob npm stores in `_auth`, never a user/password pair;
`basicCredentialFromPair` mints one and refuses a username containing `:`. The
kind picks the npmrc key (`_authToken` vs `_auth`) and the header scheme; it is
span-annotated, the value never is.

## `PackagePublish` (`src/PackagePublish.ts`)

`setupAuth` / `pack` / `publishTarball` / `dryRun` over `@effected/commands`'
`Run`. `setupAuth` takes a `RegistryCredential` and writes it to a
caller-supplied npmrc path; masking is the caller's job (no `ActionOutputs`
edge).

`pack` reports both digests and they are **not interchangeable**: `integrity` is
npm's sha512 SRI (compares to the registry), `sha256Hex` is a local hex sha256
(the attestation subject). A failed `dryRun` is a **result**, not an error.

## `NpmExecutor` (`src/NpmExecutor.ts`)

`ambient` or `dlx(spec)`, replacing v3's five repeated `packageManager?:`
options. `dlx` runs through `LocalExec.applyDlx` (`pnpm dlx npm@11 …`) because
OIDC trusted publishing needs npm ≥ 11.5.1 and runners ship 10.x.

`withCacheDir` and `withExtraArgs` are copy-returning. The cache redirect is
named API because GitHub's macOS runner images ship a partially root-owned
`~/.npm/_cacache` and npm hard-fails `EACCES` on sight of it — an environment
variable fixes it identically and invisibly, which is how the fix gets lost in a
port. `withExtraArgs` **replaces** rather than accumulates.

## `PublishError` (`src/PublishError.ts`)

Its own module because both `NpmExecutor` and `PackagePublish` raise it.
`kind: auth | pack | publish | output | digest | executor`. `"digest"` exists
because npm succeeding while the tarball cannot be read back is not "npm pack
failed".

## `RegistryKind` / `classifyRegistry` (`src/RegistryKind.ts`)

`npm | github-packages | jsr | custom`, replacing four v3 predicates with one
exhaustive classification. Three label projections ship
beside it (2026-08-23, reversing an earlier refusal: the two spellings are two
projections, wanted in different places by the same consumer) —
`registryShortLabel` (`npm`/`github`/`jsr`, else the host), `registryDisplayName`
(`npm`/`GitHub Packages`/`JSR`, else the host) and the shared `registryHost`
fallback, which **keeps the port**, unlike the hostname the classifier compares.
They are functions over the registry string, not a kind lookup, so the
leading-dot domain guard covers the labels too. `registryDisplayName` accepts
absent-or-empty and answers `npm`; `registryShortLabel` takes a plain `string`,
so a nullish value is a compile error.
