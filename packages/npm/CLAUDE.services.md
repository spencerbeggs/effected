# Services — @effected/npm

The Phase 5 (2026-07-25) IO surfaces: registry reads, the publish flow, and the
executor that runs npm. Surfaces and evidence only — the rules that govern them
live in the parent.

**Parent:** [@effected/npm context](./CLAUDE.md) ·
**Design doc:** `@../../.claude/design/effected/packages/npm.md`

## `NpmRegistry` (`src/NpmRegistry.ts`)

Registry reads over core `HttpClient`, replacing every shelled `npm view`:
`version` / `versions` / `distTags` / `publishTimes`, each taking a **per-call**
`RegistryTarget` (`{ registry?, token? }`).

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

## `PackagePublish` (`src/PackagePublish.ts`)

`setupAuth` / `pack` / `publishTarball` / `dryRun` over `@effected/commands`'
`Run`. The auth token is written to a caller-supplied npmrc path; masking is the
caller's job (no `ActionOutputs` edge).

`pack` reports both digests and they are **not interchangeable**: `integrity` is
npm's sha512 SRI (compares to the registry), `sha256Hex` is a local hex sha256
(the attestation subject). A failed `dryRun` is a **result**, not an error.

## `NpmExecutor` (`src/NpmExecutor.ts`)

`ambient` or `dlx(spec)`, replacing v3's five repeated `packageManager?:`
options. `dlx` runs through `LocalExec.applyDlx` (`pnpm dlx npm@11 …`) because
OIDC trusted publishing needs npm ≥ 11.5.1 and runners ship 10.x.

## `PublishError` (`src/PublishError.ts`)

Its own module because both `NpmExecutor` and `PackagePublish` raise it.
`kind: auth | pack | publish | output | digest | executor`. `"digest"` exists
because npm succeeding while the tarball cannot be read back is not "npm pack
failed".

## `RegistryKind` / `classifyRegistry` (`src/RegistryKind.ts`)

`npm | github-packages | jsr | custom`, replacing four v3 predicates with one
exhaustive classification. v3's `getRegistryDisplayName` was **dropped**:
consumers disagree on the strings (`"GitHub Packages"` vs `"github"` from the
same input), so they switch on the kind and choose their own.
