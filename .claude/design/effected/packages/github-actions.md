---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-08-16
last-synced: 2026-08-16
completeness: 95
related:
  - ../effect-standards.md
  - ../github-action-canon.md
  - github-actions-runtime.md
  - github-actions-storage.md
  - github-actions-reporting.md
  - github-actions-attestation.md
  - github.md
  - commands.md
  - sbom.md
  - templates.md
  - memfs.md
---

# @effected/github-actions design

## Overview

`@effected/github-actions` is the **GitHub Actions runtime** for the kit: the services an action needs to talk to the runner it is executing inside.

The line against [`@effected/github`](github.md) is sharp and worth stating first, because the package this replaced blurred it: **`github` talks to the GitHub API, `github-actions` talks to the runner.** Nothing here reads a `GITHUB_*` variable on `github`'s behalf, and nothing there imports a workflow command. The two meet at exactly two seams — the token bridge and the `Logger` that maps Effect logs onto workflow commands — and both live here.

The package covers four subsystems, each with its own doc:

- **[The runner runtime](github-actions-runtime.md)** — environment, inputs, outputs, state across the phase boundary, the workflow-command protocol, logging, the dry-run guard, the secret declassification seam, the App-token bridge and detached-process lifecycle. This is what `Action.run` composes.
- **[Storage and provisioning](github-actions-storage.md)** — the Actions cache and artifact protocols, the blob store and its envelope, cache-key derivation, and tool and package-manager installation. Everything Azure-touching lives here.
- **[The reporting suite](github-actions-reporting.md)** — check state, the managed document, the GitHub-flavored markdown writer and the check-run reconciler: the living-document surfaces an action reports progress into.
- **[The attestation seam](github-actions-attestation.md)** — OIDC tokens, and the two adapters that close [`@effected/sbom`](sbom.md)'s inverted contracts without sbom ever depending on the Actions runtime.

## Tier and dependencies

**Integrated tier by construction, and the one place in the kit where `@effect/platform-node` is a required peer.** A GitHub Action always compiles into a Node process on a GitHub-provided runner; there is no second platform to abstract over, and pretending otherwise would cost every consumer a layer it can only satisfy one way.

Two consequences are licences the rest of the kit does not have:

- **A direct `node:` import is sanctioned here.** The [require-in-R default](../effect-standards.md#the-consolidated-core-and-the-require-in-r-default) calls one a code smell *most of the time*; the documented exception is a Node-only overlay, and this package is one. It is used for what core cannot do: SHA-256 and HMAC, signalling a bare pid, the fd-level detached spawn, and the compression and stream codecs in the cache and artifact paths.
- **The platform layer may be composed here**, rather than left to the consumer. That is the point of `Action.run`.

**Core `Crypto` covers digests but not HMAC** — it exposes random primitives, UUIDs and SHA digests, and no HMAC, signing or key derivation. So file hashing, the S3 request signer and cache-key derivation all use `node:crypto`, and **no AWS SDK dependency is needed for request signing**. Recorded because "put it on core `Crypto`" is the obvious wrong guess.

**No `@actions/*` package is a dependency.** The cache, artifact and tool-cache protocols are implemented directly against their HTTP APIs, because the official cache client alone drags a dependency tree larger than this package.

Kit edges — `@effected/github`, `glob`, `markdown`, `npm`, `sbom` and `templates` — plus the one heavy external dependency, the Azure blob client. Which modules may import which is the reachability invariant below.

## Bundle reachability: confining the heavy edges

The requirement is structural: **a consumer that imports only an outputs accessor must be unable to link the Azure client.** Three rules make the confinement hold, and one measures it:

- **Azure is imported by the three protocol modules that need it, and nowhere else** — the cache, the artifact store and the GitHub-cache blob backend. The Actions cache's own protocol hands back an Azure blob URL for the payload, which is why it is three modules rather than the two an outside reading suggests. **No shared helper in `internal/` may import it**, because an internal helper is exactly how a heavy import leaks into a light module's graph.
- **The three are separate named exports, never gathered into a namespace object.** The [codec hazard](../effect-standards.md#no-barrel-re-exports) applies verbatim: a `Stores` object would make every one of them reachable from any of them.
- **`@effected/markdown` is confined the same way**: the markdown writer is the only module allowed to import the engine, and every other reporting module composes *strings*. `@effected/npm` joined the confined set on the same terms — the package-manager installer is its only importer, it is not reachable from the composed runtime layer, and taking it costs the consumer one explicit layer line.
- **`@effected/templates` and `@effected/sbom` are deliberately not confined.** Both are small, pure-or-contract-shaped kit packages whose presence in an import graph costs nothing worth measuring, and pretending otherwise would make the reachability suite a ritual rather than a defense.

**Checked, not promised — and precise about which graph.** `__test__/reachability.test.ts` walks the **runtime import graph of `src`** statically (type-only imports skipped, because they are erased), asserting that no module outside the permitted set reaches the heavy dependency **and** that the permitted modules do reach it. Without the second assertion the first can pass for the wrong reason — which is not hypothetical here, since an earlier walker stripped block comments before line comments and reported a module importing Azure as importing nothing at all. It fails **silently in the safe direction**, which for a confinement test is the worst direction there is.

**What that test does not prove, stated so nobody reads it as more than it is:**

- **It constrains the import graph, not the resolver graph.** Every heavy edge here — the Azure client, `@effected/markdown`, `@effected/npm`, and through `@effected/sbom` the Sigstore stack — is a **declared dependency of this package**, so it is installed for every consumer and a bundler's resolver still walks it. Import-graph confinement is not resolver-graph absence, and only a consumer that actually bundles finds the difference. **The [seam adapters](github-actions-attestation.md) are the sharpest case**: they are two small modules, and taking that edge for them puts `@effected/sbom`'s runtime dependencies in the install graph of every action that never signs anything.
- **Whether an unreferenced module is dropped is the bundler's decision**, resting on `"sideEffects": false` (which the suite asserts) plus the module-per-file output the builder emits. That is the part we do not control; the edge set is the part we do.

The honest claim is therefore: **no import edge exists, the package declares itself side-effect free, and a tree-shaking bundler can therefore drop the module** — not that a consumer's dependency tree is free of the package.

The same rule shapes composition, not just imports: the composed runtime layer deliberately **excludes the cache, artifact and blob services**, because folding them in would put the Azure client in the bundle of every action that merely sets an output. Their requirements are all satisfied by the runtime, so a consumer that wants one passes it as `Action.run`'s layer option and writes nothing else.

## Module topology

Module-per-concept, no barrels, `src/index.ts` re-exports only. See `src/`, and the four subsystem docs for what each module decides. The shape of the growth is worth recording: the modules that were *added* rather than ported — the blob envelope, cache-key derivation, the secret seam, detached-process lifecycle, and the whole reporting suite — were all **consumer-side hand-rolls** found by surveying real actions, not new inventions.

`internal/` holds the request signer, the Twirp client and the results-backend reader, and is import-restricted by the reachability rule above.

## Errors

One typed error per concept module, each carrying a `reason` literal union plus the one or two fields a caller branches on, with ergonomic statics for construction and foreign failures wrapped structurally rather than stringified. Input failures are **`ConfigError`**, not a bespoke error class, because inputs are `Config`-backed — one fewer error class and a strictly better message, since `ConfigError` names the missing key.

**Audit every ported error channel for whether it can actually fire.** The package this replaced had at least two structurally unreachable channels — a pure body wrapped in `Effect.try`, so the catch arm was dead. A channel that cannot fire is worse than no channel: it forces every caller to handle a case that does not exist and makes the type a lie about the operation. When porting a member, either demonstrate the failure path with a test or delete it from the signature.

## Shared vocabulary with `@effected/github`

Recorded per concept rather than defaulted:

- **The repo coordinate, installation tokens, bot identity and the client are canonical in `github` and consumed here.** This package depends on `github`, so duplicating them is the failure mode the rule warns about.
- **The GitHub and runner *contexts* are canonical here.** They describe the runner — run id, attempt, workflow, job, runner OS and temp directory — and `github` has no use for them; taking them there would invert the dependency.
- **The workflow-command protocol is canonical here and duplicated nowhere.**
- **The check-run *conclusion* literals are canonical in `github` and mirrored here structurally** — the one deliberate exception. A check state is a reporting vocabulary an action holds while it works, and importing the API client to name a string would put octokit on the graph of every module that reports progress. The mirror is **pinned by a test against the real union**, so it is a duplication with an alarm on it rather than one on trust.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards):

- **Named spans on every public fallible member of every service, uniformly.** Partial coverage reads as signal to whoever is tracing.
- **Annotations are stable identifiers only** — a cache or blob key, a tool and version, a pid, an input or output name. **Never a value, never a secret, never a payload.** This package handles tokens by definition, and a span annotation is the easiest place to leak one.
- **The pure modules carry no spans**, per the Result-parity rule: a sync primitive is not an `Effect` and does not get instrumented.
- The package emits Effect logs and ships the `Logger` that renders them as workflow commands. It composes **no** OpenTelemetry — an action that wants it composes it in its own entry point.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`. **No `./testing` subpath**, and none of the predecessor's behaviour-reimplementing doubles is ported.

- **Every service ships `makeTest(overrides?)` and `layerTest(overrides?)`,** with unstubbed members dying loudly and naming themselves. This is the direct fix for a predecessor double that returned **exit 0 for unregistered commands**, leaving consumer tests green on a documented lie.
- **Honest-default exceptions are recorded rather than assumed.** Three doubles get real defaults because dying would make them useless: the environment double seeds the standard context variables (a block a survey found duplicated byte-identically across six consumer test files), the logger double defaults to silent, and the dry-run double defaults to *on* — the safe direction. Every other member dies.
- **Real IO where the claim is about the filesystem**, and **opt-in integration** for the two network protocols, skipped-not-green without credentials.
- **The runner-file doubles are a real in-memory volume** ([`@effected/memfs`](memfs.md), a devDependency) — the shape `ActionEnvironment`'s own TSDoc points consumers at. `ActionOutputs` and `ActionState` both write with `flag: "a"`, and the previous `Map` stubs were **re-implementing append by concatenation**: filesystem behaviour hand-modelled inside the test of something else, where any disagreement with the real semantics would read as a passing test. The volume appends; the fixture only seeds the runner-file directory, because a write needs its parent.
- **Mutate the edges before declaring green.** The subsystem docs each name the mutants that discriminate.

Four testing facts have bitten repeatedly and are worth carrying: **interleaving tests must use a `Latch`, never `Effect.sleep`** (a sleep under the virtual clock hangs to the vitest timeout); **a two-latch interleaving is load-bearing**, because a single-latch version passes against a deliberately wrong save-and-restore implementation, which is LIFO-correct whenever two overrides nest properly; **a spy on a process global must be released on the failure path** with `acquireUseRelease`, since a try/finally inside `Effect.gen` leaks when an assertion fails and a leaked spy produces a false *green* in a later test; and **a test that sets the process exit code must restore it**, or a green suite fails the vitest process instead.

## What the dogfood rounds actually asked for

Adoption against real actions added modules and options to a package declared complete, and the *shape* of that feedback is the useful part: **not one round was a service gap.** Every one was a **projection** a consumer had to write between two things this kit already owned, and got wrong in a way that typechecked — an eleven-field claim rename, GFM escaping, a step-summary shape, a table's columns respelled per call site.

That is the class this package should keep absorbing, and the reason the reporting suite's formatters are type-*required* rather than defaulted: the defect these modules delete is never "no API for it", it is **"the obvious spelling is silently wrong"**.

Two standing rulings came out of the same rounds without code. A reported footgun in core's noop filesystem traced back to a consumer's own override, and the residual composability ask belongs **upstream**, not here. And `optionalDependencies` was rejected outright for the heavy dependencies: all of them are hard static imports that throw at module load rather than degrade, and several sit on the common reporting path, so the easy subpath split does not work.

## Deliberately not here

- **The `./testing` subpath and every behaviour-reimplementing double.**
- **A command runner** — superseded by [`@effected/commands`](commands.md), which this package consumes.
- **A glob engine** — the kit owns [`@effected/glob`](glob.md); only file hashing lands here, and [conditionally](github-actions-storage.md#cache-keys-and-where-file-hashing-lives).
- **A config-file loader** — that dissolves into [`@effected/config-file`](config-file.md); the environment service is what stays.
- **SBOM assembly and signing** — [`@effected/sbom`](sbom.md)'s, with only the [seam adapters](github-actions-attestation.md) here.
- **Workspace discovery, package-manager adapters and changeset analysis** — the kit already owns all three.
