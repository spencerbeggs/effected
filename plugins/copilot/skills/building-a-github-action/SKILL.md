---
name: building-a-github-action
description: >-
  Use FIRST when building, extending or reviewing a GitHub Action, a release/publish pipeline, or
  any Effect v4 program that talks to the GitHub API, to decide which @effected package owns a
  capability and which skill teaches it. Answers which service handles a capability, whether the
  kit already ships it, and what the modern @effected equivalent of a legacy Actions toolkit call
  is.
---

# Building a GitHub Action

The routing map for the five `@effected` packages an action-shaped program uses: `@effected/github-actions` (the runner), `@effected/github` (the GitHub API), `@effected/commands` (subprocesses and tool discovery), `@effected/npm` (registry reads and publishing), and `@effected/sbom` (SBOM, in-toto, SLSA, Sigstore). Rows route to a skill; they do not teach the pattern themselves.

**The design boundary that matters most**: `@effected/github` talks to the GitHub API; `@effected/github-actions` talks to the runner it executes inside. Nothing in `github-actions` reads `process.env.GITHUB_REPOSITORY` on `github`'s behalf, and nothing in `github` imports a workflow command. The two meet at exactly two seams, both living in `github-actions`: the token bridge (`GitHubToken`) and the `Logger` that maps `Effect.log*` onto workflow commands (`ActionLogger.logger`).

For a capability outside these five packages — globs, semver, lockfiles, JSONC/YAML/TOML, XDG paths, git introspection, managed file sections — consult `effected-packages` before hand-writing it.

## Designing or structuring a new action? Start elsewhere first

This table routes a capability to the package and skill that own it; it does not sequence a build or lay out a repository. For a new action, a wholesale rebuild, or a port where more than one pipeline step changes, load `designing-an-action` first: recon → frozen parity contract → API dossier → contracts-first walking skeleton → TDD fill. For where a piece of code belongs — an entry point, a step, a shared service, a shim — load `structuring-an-action`: `designing-an-action` owns the order you build in, `structuring-an-action` owns the shape you build into. Return to this table during either sequence to look up which package and skill owns each piece as you build it.

## I need to… → reach for…

| I need to… | Reach for | Skill |
| --- | --- | --- |
| turn a fresh copy of the template into my action | the interview: identity, phases, access, inputs, outputs, capabilities, reporting, self-dogfood → a plan file | `bootstrapping-an-action` |
| decide where a piece of code belongs in the repo | the canonical tree: entries, `program.ts`, `steps/`, `services/`, `shims/`, `schema/`, `state.ts`, `format.ts` | `structuring-an-action` |
| write `main.ts` / `pre.ts` / `post.ts`, wire layers | `Action.run`, `ActionRuntime.layer`, `ActionServices` | `actions-runtime` |
| read an input, validate it, apply a default | `ActionInput` + Effect `Config` | `actions-inputs-outputs` |
| set an output, export a variable, add to PATH | `ActionOutputs` | `actions-inputs-outputs` |
| emit a machine-readable output contract | `ActionOutputs.setJson` + the same `Schema` codec | `actions-inputs-outputs` |
| publish and drift-test that contract's JSON Schema | `@effected/schemastore`: `SchemaTarget`, `SchemaPipeline.run` / `.check` | `actions-inputs-outputs` |
| make the run log readable | `ActionLogger` (`group`, `withBuffer`, `notice`, `annotated`) | `actions-reporting` |
| write the job summary | `ActionOutputs.summary` | `actions-reporting` |
| read a published package's contents before installing it | `PackageTarball.extract` (scoped) + `resolveEntryPoint` | `release-and-publish` |
| create a check run or annotate a PR | `CheckRun`, `CheckRun.withCheckRun` | `actions-reporting` |
| post or update a sticky PR comment | `PullRequestComment.upsert` + `CommentMarker` | `actions-reporting` |
| write GitHub-flavored markdown / a findings table | `GitHubMarkdown`, `GitHubMarkdown.tableFor` | `actions-reporting` |
| maintain a sticky-comment or PR-description document | `ManagedDocument` (marker-delimited regions) | `actions-reporting` |
| reconcile check state onto a living document | `CheckDocument` + `CheckState` / `projectCheckState` | `actions-reporting` |
| read the webhook event payload | `ActionEnvironment.payload` | `actions-runtime` |
| pass a value from `pre` to `main` to `post` | `ActionState` | `actions-state-and-secrets` |
| handle a secret without leaking it | `Secret`, `Redacted`, `Redaction` | `actions-state-and-secrets` |
| decide whether a failure should fail the run | `Action.run`'s contract, `DryRun` | `actions-state-and-secrets` |
| kill a background process started in `main` | `DetachedProcess.reap` | `actions-state-and-secrets` |
| safely prepend a directory to a spawned child's PATH | `ChildEnv.prependPath` | `actions-state-and-secrets` |
| call any GitHub REST or GraphQL endpoint | `GitHubClient.request` / `.graphql` / `.paginate` | `github-api` |
| create a branch, tag, release, commit, PR | the resource services (`GitBranch`, `GitTag`, …) | `github-api` |
| write an Actions / Dependabot / Codespaces / environment **secret** | `RepositorySecret` — encrypts client-side with a sealed box; the value is `Redacted` and GitHub never returns it | `github-api` |
| read or write an Actions or environment **variable** | `RepositoryVariable` | `github-api` |
| create or update a repository **ruleset** | `Ruleset.upsert` — matches on name **and** `source_type`, so a repository-scoped write cannot overwrite an inherited organization ruleset | `github-api` |
| manage deployment **environments** | `DeploymentEnvironment` | `github-api` |
| toggle vulnerability alerts, automated fixes, private reporting | `RepositorySecurity` — each has its own endpoint | `github-api` |
| configure CodeQL default setup, or read repository languages | `CodeScanning` | `github-api` |
| change repository settings | `GitHubRepository.updateSettings` (the typed PATCH) or `applySettings` (an open map routed across REST **and** the GraphQL mutation, returning the fields it actually sent) | `github-api` |
| ask whether a repository owner is a user or an org | `GitHubRepository.ownerType` | `github-api` |
| ask whether a repository has **workflows** | `WorkflowDispatch.list` — repository *languages* come from linguist and can never report `actions`, which GitHub validates against workflow files | `github-api` |
| render a DCO sign-off trailer on a bot commit | `BotIdentity.signoff` | `github-api` |
| authenticate as a GitHub App | `GitHubApp`, `GitHubApp.clientLayer` | `github-app-tokens` |
| mint a token in `pre` and revoke it in `post` | `GitHubToken` provision → read → dispose | `github-app-tokens` |
| cache a directory between runs | `ActionCache` | `actions-cache-and-artifacts` |
| upload or download a workflow artifact | `Artifact` | `actions-cache-and-artifacts` |
| store a blob (Actions cache or S3-compatible) | `BlobStore`, `GitHubCacheBlobStore`, `BlobEnvelope` | `actions-cache-and-artifacts` |
| install a toolchain on the runner | `ToolInstaller` | `actions-cache-and-artifacts` |
| pin and install an exact npm/pnpm/yarn/bun | `PackageManagerInstaller` | `actions-cache-and-artifacts` |
| compute a cache key from file contents | `CacheKey` | `actions-cache-and-artifacts` |
| run a subprocess and get a typed result | `Run.collect` / `text` / `lines` / `json` | `running-commands-and-tools` |
| ask whether a CLI tool is installed | `ToolDiscovery` | `running-commands-and-tools` |
| run a local binary in a workspace or a bare repo | `LocalExec` | `running-commands-and-tools` |
| read a registry: latest version, dist-tags, times | `NpmRegistry` | `release-and-publish` |
| pack and publish a package | `PackagePublish`, `NpmExecutor` | `release-and-publish` |
| derive a release tag or a tracking tag | `ReleaseTag`, `VersioningStrategy` | `release-and-publish` |
| hold a release back by age | `ReleaseAgeGate` | `release-and-publish` |
| emit an SBOM | `Sbom.generate` / `toJson` / `write` | `supply-chain-attestation` |
| sign an artifact and attest a build | `SigstoreSigner`, `SlsaProvenance`, `Attestation.upload` | `supply-chain-attestation` |
| get an OIDC token from the runner | `OidcTokenIssuer` | `supply-chain-attestation` |
| capture SLSA provenance from the runner's claims | `ActionsProvenance.capture` | `supply-chain-attestation` |
| serve `sbom`'s identity contract from the runner | `ActionsIdentityToken.layer` | `supply-chain-attestation` |
| test any of the above | `makeTest` / `layerTest` on every service | `testing-actions` |

## Call sequences — when the capability is a chain, not one service

| I need to… | Call sequence | Packages |
| --- | --- | --- |
| sign and store an attestation | `SlsaProvenance.forGitHubWorkflow` → `InTotoStatement.forSubject` → `SigstoreSigner.sign` → `Attestation.upload` | `sbom` + `github` |
| publish a package, integrity-checked | `NpmRegistry.version` (already-published probe) → `PackagePublish.setupAuth` → `PackagePublish.pack` → `PackagePublish.publishTarball` | `npm` |
| read a config dependency before install runs | `NpmRegistry.version` → `PackageTarball.extract` (scoped) → `resolveEntryPoint` | `npm` + `package-json` |
| hold a token across the three phases | `GitHubToken.provision` (pre) → `GitHubToken.read` (main) → `GitHubToken.dispose` (post) | `github-actions` |
| emit an SBOM and attest it | `Sbom.generate` → `Sbom.toJson` → `InTotoStatement.forSubject` → `SigstoreSigner.sign` → `Attestation.upload` | `sbom` + `github` |

## Standards

- **Resolve an API claim in order**: the package's own `CLAUDE.md`, then its source — the source wins on disagreement. For Effect core itself, load `effect-v4-source-lookup`: the vendored source settles existence and signature, a probe settles semantics.
- **The route is the key.** `client.request("GET /repos/{owner}/{repo}", …)` types the parameters and response from the literal alone; a cast in GitHub API code is a defect, not a shortcut.
- **Every service ships `makeTest`/`layerTest`**, and an unstubbed member dies loudly, naming itself. A handful of recorded exceptions each carry a stated reason.
- **Errors are `Schema.TaggedError`, in one of two shapes — check which before writing a handler.** Most carry a discriminant field and are matched on it: `kind` (`GitHubError`, `PublishError`, `RegistryReadError`, `CommandFailedError`, `CheckDocumentError`, `ManagedDocumentError`, `TokenPermissionError`, `GitHubAppError`) or `reason` (`ActionEnvironmentError`, `GitHubTokenError`, `BlobTransferError`). Four in `@effected/github-actions` are instead **per-reason tagged unions**: `ActionOutputError`, `BlobEnvelopeError`, `CacheKeyError` and `DetachedProcessError` are `type` aliases over one exported class per failure, matched on `error._tag`, with `Effect.catchTag` recovering from one arm rather than all of them. Every name still appears in the same signatures, so a union is invisible until you reach for `.reason` — which no longer type-checks on those four. Every error reason has a test that fires it; when porting a channel, demonstrate its failure path or delete it from the signature.
- **Read an input through `ActionInput`, never a bare `Config.*` read spelled by hand.** `ActionInput` carries the parsing and the typed `ConfigError`s a bare read cannot, and a test suite that injects its own `ConfigProvider` around a bare read can silently diverge from the runner's own key derivation.
- **A consumer program never mentions the platform.** `ActionRuntime.layer` composes the platform and HTTP client internally with no requirements of its own, and an extra layer handed to `Action.run` may require anything the runtime already provides.
- **`@effected/github-actions` is the one package in the kit with a required Node platform peer, and the only one where a raw `node:` import is sanctioned** — for digests and HMAC, reaping a bare pid, a file-descriptor-level detached spawn, and the cache/artifact codecs. Sanctioned is not unlimited: everything that can go through a core contract does.
- **Heavy engines stay confined, and it is measured, not promised.** Azure to a handful of modules, Sigstore to one, octokit to `@effected/github`, each with a reachability test carrying a control. Never gather a heavy engine into a namespace object, never route it through a shared internal helper, and never fold it into a default runtime.
- **The bundler and the scaffold are a separate concern.** This suite teaches the code an action is made of, not how it is bundled or scaffolded — a template repository owns that layer.

## What the kit deliberately does not ship

- No `@actions/core`, `@actions/cache`, `@actions/artifact`, or any `@actions/*` package — the protocols are implemented directly against their own APIs.
- No `MainLive`/`PreLive`/`PostLive` exports — those are an action's own naming convention for its per-entry layers, built from `ActionRuntime.layer` plus each service's `static readonly layer`; the kit ships no such consts.
- No standalone inputs service or a distinct input-error type — inputs are `Config`-based, and input failures are `ConfigError`.
- No rate-limiter subsystem or proactive throttling — one `RetryPolicy` lives inside the client, and `client.rateLimit` exposes the headers for a caller that wants to pace itself.
- No per-resource error classes — one `GitHubError` carries a `kind` discriminant.
- No separate GraphQL client construct — GraphQL is a member of the client.
- No report-shaping construct — but **`GitHubMarkdown` does ship the GFM writer** (`table`, `tableFor(schema)`, `heading`, `link`, `code`, `codeBlock`, `list`, `details`, `raw`), from `@effected/github-actions`, and `ManagedDocument` / `CheckDocument` ship the document surfaces. "Shaping" means the arrangement of a report — which facts, in which order — not the primitives. Never hand-roll a markdown writer: compose `GitHubMarkdown` pieces, or reach for `@effected/markdown` for a document you build as a tree. See `actions-reporting`.
- No fan-out-and-accumulate construct — `Effect.partition(items, f)` returns `[failures, successes]` and never fails; `Effect.all(effects, { mode: "result" })` is the per-effect form.
- No ANSI/colour API — GitHub's log viewer colours the workflow commands itself; do not invent one.
- No shared `*Test` module family or a `./testing` subpath — every service ships its own `makeTest`/`layerTest`. Grep the installed packages for `makeTest` to see the current set; it is large, not a handful.
- No named log-level resolver — `ActionEnvironment.isDebug` (`Effect.Effect<boolean>`, reads `RUNNER_DEBUG === "1"`) is what a program reaches for instead.

## Present, and easy to miss

These exist, and each one has been mistaken for a gap at least once. A capability filed under the absence list above when it actually ships is the expensive misreading — one build planned a hand-rolled markdown writer off exactly that mistake.

- **`GitHubMarkdown` (capital H)** — the GFM writer: `table`, `tableFor(schema)`, `heading`, `link`, `code`, `codeBlock`, `list`, `details`, `raw`.
- **`ActionInput.string("x")`** — the accessor owns the `INPUT_` derivation; you never spell it yourself.
- **`Service.makeTest` / `Service.layerTest`** — on the service itself, not on a `/testing` subpath.
- **`ActionRuntime.layer`** — the composed runtime; never hand-compose a `MainLive`.

## The suite

| Skill | Owns |
| --- | --- |
| `actions-runtime` | entry points, `Action.run`, layer wiring, failure rendering |
| `actions-inputs-outputs` | `ActionInput`, `ActionOutputs`, output contracts |
| `actions-reporting` | logs, annotations, summaries, check runs, PR comments |
| `actions-state-and-secrets` | `ActionState`, `Secret`, `DryRun`, `DetachedProcess`, `ChildEnv` |
| `actions-cache-and-artifacts` | `ActionCache`, `Artifact`, `BlobStore`, `ToolInstaller`, `PackageManagerInstaller`, `CacheKey` |
| `github-api` | the client, routes, pagination, resilience, the error taxonomy, resources |
| `github-app-tokens` | `GitHubApp`, the client constructors, the `GitHubToken` bridge |
| `running-commands-and-tools` | `Run`, `ToolDiscovery`, `LocalExec`, `Redaction`, `Retry` |
| `release-and-publish` | `NpmRegistry`, `PackagePublish`, tags, versioning, release gates |
| `supply-chain-attestation` | SBOM, NTIA, in-toto/SLSA, OIDC, Sigstore, `Attestation` |
| `testing-actions` | the doubles convention, the octokit harness, the domain's mutants |
| `designing-an-action` | the build sequence: recon, frozen parity contract, API dossier, walking skeleton, TDD fill |
| `bootstrapping-an-action` | the user-invoked interview that turns the template into a planned action and hands off to `designing-an-action` |
| `structuring-an-action` | the canonical repo tree, structural standards, where a piece of code belongs |

For the general Effect v4 rules these all sit on — schema design, service and layer form, core idioms, observability, testing — load `effect-v4-schema`, `effect-v4-services-layers`, `effect-v4-idioms`, `effect-v4-observability` and `effect-v4-testing`. This suite carries only the GitHub-specific instances.
