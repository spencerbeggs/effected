---
type: Module
title: github-actions
description: The GitHub Actions runner runtime — environment, inputs/outputs/state, workflow commands, storage, reporting and the sbom attestation seam.
status: stable
kind: package
resource: ../../packages/github-actions
tags:
  - architecture
  - bundle
generated:
  by: "okfit/claude-code"
  at: 2026-09-28T18:00:23Z
  body_sha256: 815f7e93174fd12eaa3c6b1ce6ebe67af29ec68ab7cbdc56ee3ddea68269eb4d
---

# github-actions

## Purpose

`@effected/github-actions` is the GitHub Actions runtime for the kit: the
services an action needs to talk to the runner it is executing inside. The
line against [`github`](github.md) is sharp: `github` talks to the GitHub
API, `github-actions` talks to the runner. Nothing here reads a `GITHUB_*`
variable on `github`'s behalf, and nothing in `github` imports a workflow
command. The two meet at exactly two seams, both living here: the App-token
bridge and the `Logger` that maps Effect logs onto workflow commands.

The package covers four subsystems, each with its own contract doc: the
runner runtime ([`actions-runtime`](../interfaces/actions-runtime.md)),
storage and provisioning ([`actions-storage`](../interfaces/actions-storage.md)),
the reporting suite ([`actions-reporting`](../interfaces/actions-reporting.md))
and the attestation seam ([`actions-attestation`](../interfaces/actions-attestation.md)).

## Tier and dependencies

Integrated tier by construction, and the one package in the kit where
`@effect/platform-node` is a required peer — see
[the platform-node peer decision](../decisions/platform-node-peer-in-one-package.md).
A GitHub Action always compiles into a Node process on a GitHub-provided
runner, so there is no second platform to abstract over.

Two consequences follow from that tier that the rest of the kit does not
get: a direct `node:` import is sanctioned here, and the platform layer is
composed here rather than left to the consumer, which is the point of
`Action.run`. **Sanctioned is not unlimited** — the list is closed and
small. `node:crypto` in `internal/digest.ts` (every `createHash`, spelled
once, including the streamed file digest a multi-gigabyte archive needs)
and `internal/sigv4.ts` (the HMAC core's `Crypto` does not offer — core
exposes random primitives, UUIDs and SHA digests, no HMAC or key
derivation); `node:child_process` and `node:fs` in `DetachedProcess.ts`
for the fd-level detached spawn, plus `process.kill` for reaping a bare
pid. Everything else goes through a core contract: `ToolInstaller`
downloads over `HttpClient` and extracts over `ChildProcessSpawner` in
`R`, the cache and artifact archives are `tar`/`zip` commands spelled in
`internal/archiveCommands.ts` and run through the same spawner, and
`CacheKey` reads over `FileSystem`. No `@actions/*` package is a
dependency: the cache, artifact and tool-cache protocols are implemented
directly against their HTTP APIs, because the official cache client alone
drags a dependency tree larger than this package; globbing is
[`glob`](glob.md), never `@actions/glob`.

Kit edges: [`github`](github.md), [`glob`](glob.md), [`markdown`](markdown.md),
[`npm`](npm.md), [`sbom`](sbom.md), [`templates`](templates.md) and
[`walker`](walker.md), plus one
heavy external dependency, the Azure blob client
(`@azure/storage-blob`).

## Bundle reachability

A consumer that imports only an outputs accessor must be unable to link the
Azure client. Three rules hold the confinement and one measures it:

- The Azure client is imported by exactly three modules —
  `ActionCache.ts`, `Artifact.ts` and `BlobStore.githubCache.ts` (three,
  not the two an outside reading suggests, because the Actions cache's own
  protocol hands back an Azure blob URL for the payload) — and nowhere
  else. No shared helper under `internal/` may import it. See
  [Azure is confined to three modules](../decisions/azure-blob-confined-to-three-modules.md).
- The three are separate named exports in `index.ts`, never gathered into
  a namespace object — see
  [no barrel re-exports](../conventions/no-barrel-re-exports.md).
- `@effected/markdown` is confined the same way: `GitHubMarkdown.ts` is the
  only module allowed to import the markdown engine, and every other
  reporting module composes strings. `@effected/npm` is confined to
  `PackageManagerInstaller.ts` on the same terms; it is not reachable from
  the composed runtime layer, so taking it costs a consumer one explicit
  layer line. `@effected/templates` and `@effected/sbom` are deliberately
  **not** confined — both are small, pure-or-contract-shaped kit packages
  whose presence in an import graph costs nothing worth measuring.
- The confinement is checked, not promised, by
  [the bundle-reachability suite](../conventions/bundle-reachability-suite.md)
  at `packages/github-actions/__test__/reachability.test.ts`.

What that test does **not** prove: it constrains the runtime *import*
graph of `src`, not the *resolver* graph. Every heavy edge here — Azure,
`markdown`, `npm`, and through `sbom` the Sigstore stack — is a declared
dependency of this package, so it is installed for every consumer and a
bundler's resolver still walks it; only a consumer that actually bundles
and tree-shakes sees the benefit. The composed runtime layer
(`Action.run`) deliberately excludes the cache, artifact and blob
services for the same reason: folding them in would put the Azure client
in the bundle of every action that merely sets an output.

## Module topology

Module-per-concept, no barrels; `src/index.ts` re-exports only. `internal/`
holds the request signer, the Twirp client, the results-backend reader,
the archive commands and the digests, and is import-restricted by the
reachability rule above. The blob envelope, cache-key derivation, the
secret declassification seam, the detached-process lifecycle and the
whole reporting suite each absorb a consumer-side hand-roll found in real
actions rather than a new invention.

Two properties of the source tree are pinned structurally rather than
followed by convention: `ActionEnvironment` is the only reader of ambient
process state ([invariant](../invariants/ambient-process-state-read-once.md)),
and `Secret.ts` is the only module that unwraps a `Redacted`
([invariant](../invariants/redacted-value-only-in-secret.md)). A new
default that must read `process.env` goes on the first test's allowlist
with its reason; a new reason to hold plaintext is a new `Secret` member.

## Errors

Typed errors per concept module, with foreign failures wrapped
structurally rather than stringified. Input failures surface as
`ConfigError` — not a bespoke error class — because inputs are
`Config`-backed, which gives a strictly better message naming the missing
key for one fewer error class.

`ActionOutputError`, `BlobEnvelopeError`, `CacheKeyError` and
`DetachedProcessError` are **per-reason tagged unions**, not one class
carrying a `reason` field. Every exported name survives as a union type
alias, so no signature changed when the shape moved. Every error channel
is audited for whether it can actually fire — a pure body wrapped in
`Effect.try` has a dead catch arm, and a channel that cannot fire forces
every caller to handle a case that does not exist.

## Shared vocabulary with `github`

Recorded per concept rather than defaulted: the repo coordinate,
installation tokens, bot identity and the API client are canonical in
[`github`](github.md) and consumed here. The GitHub and runner *contexts*
(run id, attempt, workflow, job, runner OS and temp directory) are
canonical here, since `github` has no use for them. The workflow-command
protocol is canonical here and duplicated nowhere. The check-run
*conclusion* literals are canonical in `github` and mirrored here
structurally — the one deliberate exception, pinned by a test against the
real union, because importing the API client to name a string would put
octokit on the graph of every module that reports progress.

## Observability

Named spans on every public fallible member of every service, uniformly —
partial coverage reads as signal to whoever is tracing. Annotations are
stable identifiers only (a cache or blob key, a tool and version, a pid,
an input or output name), never a value, a secret or a payload, since this
package handles tokens by definition and a span annotation is the easiest
place to leak one. The pure modules carry no spans. The package emits
Effect logs and ships the `Logger` that renders them as workflow commands;
it composes no OpenTelemetry itself.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect` — tests live in
`__test__/`. No `./testing` subpath, and no behaviour-reimplementing
doubles. Every service ships `makeTest(overrides?)` and
`layerTest(overrides?)`, with unstubbed members dying loudly and naming
themselves; three doubles carry an honest-default exception because dying
would make them useless (the environment double seeds the standard
context variables, the logger double defaults to silent, the dry-run
double defaults to on). Real IO is used where the claim is about the
filesystem (`ToolInstaller` runs under `NodeServices.layer` against real
`tar`), HTTP is tested through `FetchHttpClient.Fetch` so request
construction, status mapping and body decoding all execute, and the two
network protocols get opt-in integration tests, skipped rather than green
without credentials.

The doubles worth knowing before writing a test:

- `ActionEnvironment.makeTest(overrides?, payload?)` / `layerTest` take
  the webhook payload as a **second argument** and serve it directly.
  `layerTest` hard-provides `FileSystem.layerNoop({})` and `make`
  captures the filesystem at construction, so seeding `GITHUB_EVENT_PATH`
  through `overrides` sends the read to a noop filesystem; `undefined`
  means *not served*, so an unarranged payload still fails typed naming
  the variable.
- The runner-file doubles are a real in-memory volume from
  [`memfs`](memfs.md) (a devDependency). `ActionOutputs` and
  `ActionState` both append (`flag: "a"`), and the `Map` stubs they
  replaced were re-implementing append by concatenation — filesystem
  behaviour hand-modelled inside the test of something else. Build the
  pair eagerly (`makeInspectableWith` + `Layer.succeed`, never the
  re-seeding `layer*` form, per memfs's isolation contract) so the
  assertions read the volume the run wrote to, and seed the runner-file
  directory, since a write needs its parent.
- `OidcTokenIssuer.layerFor(claims)` answers a **real, decodable**
  unsigned JWT built from the same claims `claims()` reports, which is
  what makes the provenance path reachable under test.
- `BlobStore.layerMemory` runs the real envelope framing, so a round trip
  through it proves metadata survives storage rather than asserting the
  double.

Disciplines the suite holds itself to: a concurrency test over
`withEnv` needs **two** latches minimum, because a single-latch
interleaving passed against a deliberately wrong save/restore (nested
overrides are LIFO-correct by accident) — the order must force one fiber
to read while the other's override is applied and unrestored; a spy on a
process global is released with `acquireUseRelease`, never
`try`/`finally` inside `Effect.gen`, since a failing assertion leaves
through the error channel and leaks the spy into the next test; the pid
guard, the envelope magic, the `INPUT_` mangling, the `withEnv` scoping,
the hex-vs-binary digest and the tool-cache swap all carry recorded,
discriminating mutants. Two structural suites — the ambient-read
allowlist and the `Redacted.value` scan — are described under module
topology; the reachability suite additionally asserts exact edge sets
for the light modules (`CheckState.ts` reaches `effect` alone and in
particular not `github`, `ManagedDocument.ts` and `CheckDocument.ts` reach
`templates` and `effect` only, `ChildEnv.ts` reaches nothing, `Action.ts`
reaches `@effect/platform-node`, `effect` and `effect/http`).

## The class of feedback this package absorbs

What adoption against real actions asks for is almost never a missing
service — it is a projection a consumer had to write between two things
the kit already owned and got wrong in a way that typechecked (a
many-field claim rename, GFM escaping, a step-summary shape, a table's
columns respelled per call site). That is why the reporting suite's
formatters are type-required rather than defaulted: the defect these
modules delete is never "no API for it", it is "the obvious spelling is
silently wrong". `optionalDependencies` is rejected for the heavy
dependencies and stays rejected — all of them are hard static imports
that throw at module load rather than degrade, and several sit on the
common reporting path.

## Deliberately not here

- The `./testing` subpath and every behaviour-reimplementing double.
- A command runner — superseded by [`commands`](commands.md), which this
  package consumes.
- A glob engine — the kit owns [`glob`](glob.md); only file hashing lands
  here, and conditionally.
- A config-file loader — that dissolves into
  [`config-file`](config-file.md); the environment service is what stays.
- SBOM assembly and signing — [`sbom`](sbom.md)'s, with only the seam
  adapters here (see
  [`actions-attestation`](../interfaces/actions-attestation.md)).
- Workspace discovery, package-manager adapters and changeset analysis —
  the kit already owns all three.

See also [the github-split glossary entry](../glossary/github-split.md)
and [the GitHub Action canon convention](../conventions/github-action-canon.md).
