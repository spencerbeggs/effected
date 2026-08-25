---
status: current
module: effected
category: architecture
created: 2026-07-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../consumers/reposets.md
  - schemastore.md
  - github-rest.md
  - github-errors.md
  - github-auth.md
  - github-resources.md
  - github-graphql.md
  - github-references.md
  - github-actions.md
  - git.md
  - semver.md
---

# @effected/github design

## Overview

`@effected/github` is the kit's **typed GitHub API layer**: one client over GitHub's REST and GraphQL endpoints, plus the resource services that turn raw endpoints into domain operations. It owns the octokit runtime so that `@effected/github-actions` and the consumer repos never take an octokit edge themselves.

Three properties define the package, and each corrects a measured failure in the package it replaces:

1. **Nothing is `unknown`.** octokit ships a complete, generated, **types-only** description of every GitHub endpoint. A predecessor that took an operation string plus an untyped callback threw all of it away and pushed the typing burden onto consumers, who paid it in sixteen cast sites across four repos and dozens more inside the library itself. Here [the endpoint route **is** the key](github-rest.md), and both the parameters and the response data come from it.
2. **A light consumer cannot reach a heavy engine.** A predecessor put octokit, an OAuth arm, an SBOM library and a signing stack behind one entry point, which is why one consumer shipped a hand-written bundler ignore list for XML libraries it never invoked. Here the split is structural and [measured](#bundle-reachability).
3. **Errors are sized to what consumers read.** A read census across six repos found consumers reading a reason string, a status, an operation name and a tag — and nothing else, against eighteen error classes demanding up to five mandatory fields each. Here it is [four errors with a structural discriminant](github-errors.md).

Scope is closed by the consumer repos, not by GitHub's API. An endpoint earns a resource method when a consumer needs it typed; everything else is reachable through the typed request surface without a cast, so "not modelled" never means "not usable".

The subsystems have their own docs:

- **[The typed REST surface](github-rest.md)** — the route-is-the-key mechanism, the client shape, the escape hatch for routes outside the generated map and the pagination model.
- **[Errors and resilience](github-errors.md)** — one classification step, the structural `kind` and the single retry policy driven by GitHub's own headers.
- **[App authentication](github-auth.md)** — the JWT engine, the token lifecycle and the seam `@effected/github-actions` builds its bridge on.
- **[The resource services](github-resources.md)** — what each resource owns and the decisions that shaped it, including the hazards a consumer lost production data to.
- **[GraphQL](github-graphql.md)** — typed documents, and which documents this package owns.

## Tier and dependencies

**Integrated tier**, by [R1/R2](../effect-standards.md#dependency-policy) — it owns the octokit runtime. That is the whole reason the package exists: interpreting GitHub's API is a concern that should exist once, typed, in a package named for it.

The dependency set is **deliberately smaller than the package it replaces**, and each line is decided against measured weight:

| Dependency | Why |
| --- | --- |
| `@octokit/core` | the `Octokit` class: a route-keyed, fully typed `request`, plus `graphql` |
| `@octokit/plugin-paginate-rest` | the composable paginator that works against a **bare core instance**, plus the type that lets us statically reject paginating a non-paginating route |
| `@octokit/types` | the generated endpoint map. **Ships no JavaScript** — types only. Its v17 ids are a `number`/`bigint` union, [narrowed once at the projection boundary](github-rest.md#resource-ids-come-off-the-wire-as-number--bigint) |
| `universal-github-app-jwt` | signs the App JWT; zero dependencies, and the exact leaf the official auth package uses |
| `tweetnacl` + `blakejs` | the libsodium **sealed box** GitHub's secrets API requires, reachable only from `RepositorySecret` |
| [`@effected/semver`](semver.md) | semver-aware tag selection. Pure tier, so the edge is free under [R3](../effect-standards.md#dependency-policy) |
| [`@effected/github-references`](github-references.md) | the issue-reference grammar. Pure tier, free under R3, and the edge exists **only** to keep the [six-name compat re-export](github-resources.md#the-closing-reference-grammar-lives-in-effectedgithub-references) working |

**The crypto pair is not a free-hand choice, and `node:crypto` is not an alternative.** A sealed box is `crypto_box` under an ephemeral keypair with a nonce **derived** as `blake2b(ephemeral_pk ‖ recipient_pk, 24)`; Node ships neither X25519 `crypto_box` nor blake2b, so the options were these two leaves or a full libsodium build. They are the only non-octokit runtime dependencies here and the tier does not move — the package is already integrated and nothing depends on it but `github-actions`, itself integrated — but **treat a third addition as a fresh decision** rather than a free ride on this one, the same guardrail [`schemastore`](schemastore.md#the-validation-gate-ajv-ships-closed) carries. See `src/internal/crypto.ts`, whose header records the CommonJS trap that bit here: Node's `cjs-module-lexer` detects `blakejs`' `blake2b` as a named export and not its siblings, so a named import works for one function and throws for its neighbour.

**Two dependencies a predecessor had are deliberately dropped, and must not be reintroduced.**

`@octokit/rest` is a convenience wrapper bundling two plugins: a request-log plugin the predecessor immediately neutralized with a silencing sink, and **megabytes of generated types** that are a second spelling of what the types package already carries. Route-keyed typing needs **neither** — the core client's `request` is already typed against the generated endpoint map — so dropping it removes the log plugin, the duplicate types and the value-level namespace surface that made every consumer hand-write an interface to describe it.

`@octokit/auth-app` re-exports an OAuth user-auth factory, which makes **hundreds of kilobytes of OAuth app, user and device-flow machinery reachable** from a package that only ever mints installation tokens. What is actually needed from it is an RS256-signed App JWT and one token endpoint — the endpoint is a **typed route on the client we already have**, and the JWT is the same zero-dependency leaf that package itself depends on. So this is not a re-implementation of crypto: it is taking the same leaf directly and leaving the OAuth arm behind. Two consequences: the auth-wrapper service **disappears entirely** (it existed only to make a factory mockable, had no test double and had exactly the non-effectful shape the kit bans), and the App path **loses its HTTP-client requirement**, because its calls route through the same octokit transport as everything else — one HTTP path, one error taxonomy, one retry policy, one rate-limit reader and a hand-rolled link-header pager deleted.

## Bundle reachability

The tree-shakability invariant is measured and paying:

| A consumer that imports… | links | does **not** link |
| --- | --- | --- |
| the client, the repo coordinate, the route vocabulary, any resource service but `RepositorySecret` | octokit core and the paginator | the JWT signer, the crypto pair |
| the App service or its client layer | the above plus the JWT signer | the crypto pair |
| `RepositorySecret` | the above plus `tweetnacl` and `blakejs` | the JWT signer |
| the pure classes | nothing but `effect` | all octokit |

Three mechanisms carry it, in order of weight:

1. **Module-per-layer-variant.** The token and config client layers live in the client module, which imports only octokit core and the paginator; the App-authenticated client layer lives in the App module, the only module importing the JWT signer. A consumer that is a pure token-only REST reader reaches none of it.
2. **No namespace object, anywhere.** A predecessor's `{ fromEnv, fromToken, fromApp }` object is precisely what defeats mechanism 1: a namespace object is a single live binding, so referencing it retains every member's whole module graph ([effect-standards](../effect-standards.md#no-barrel-re-exports)). The entry point re-exports by name only.
3. **The pure surface is genuinely pure.** The permission comparator, bot identity, the repo reference, the comment marker, the check-run output budgeter and the retry policy are schema classes in modules importing nothing but `effect`. A consumer that only compares token permissions bundles a few hundred bytes. **Pure-but-GitHub-shaped belongs in the kit rather than in a consumer**: a vendor rule a consumer re-derives is exactly the duplication this package exists to end. The closing-reference grammar was the case without the classes — plain functions over strings — and it lives in [`@effected/github-references`](github-references.md), because "in the kit" turned out not to mean "in this package": hosting it here cost `github`'s own consumers nothing and cost the octokit-free ones the whole client tree. `github` keeps a six-name compat re-export and nothing else.

The crypto pair rides mechanism 1 as well: `internal/crypto.ts` is imported by `RepositorySecret` and by nothing else, so the row above is a property of the module graph rather than a hope. It carries the same positive-and-negative pair the signer does, and its negative arm **derives the module list from the directory** rather than hardcoding one — a new module that imported the crypto would otherwise pass until someone remembered to add it to a list, which is the failure mode a confinement assertion exists to remove.

**This invariant gets a test, not a promise**, and the test is precise about which graph it constrains: it walks the **runtime import graph of `src`** statically (type-only imports skipped, since they are erased), asserting the token-only client does not reach the JWT signer **and** that the App module does. Without the control, the first assertion can pass for the wrong reason — an earlier walker in a sibling package stripped comments in the wrong order and reported a module as importing nothing at all, failing silently in the safe direction. The suite also asserts that every imported package is declared and that the manifest is `"sideEffects": false`.

**It constrains the import graph, not the resolver graph.** The signer is a declared runtime dependency, so it is installed wherever this package is and a bundler's resolver walks it; whether an unreferenced module is dropped is then the bundler's decision, resting on the side-effect declaration plus the module-per-file output the builder emits. The supported claim is "no edge exists, so a tree-shaking bundler can drop it" — not "it is absent from the consumer's tree". A predecessor's failure mode was an edge that genuinely existed and was invisible until someone measured a bundle; that half is now a red suite.

## Module topology

Module-per-concept, no barrels, `src/index.ts` re-exports only. `src/` holds the route vocabulary and the client, the App module, the repo coordinate, resilience, GraphQL, one module per resource service and the pure permission comparator; `src/internal/` holds the octokit factory, the one pagination engine, the crypto leaf, the id funnel and header parsing.

Three predecessor services are simply **gone**: a rate-limit state cell and a rate limiter, both folded into the client, and the auth wrapper. One more became a pure class, the permission comparator. Two modules have no predecessor at all — the route vocabulary and the repo coordinate.

**Repository settings live on `GitHubRepository`, not in a service of their own**, because the endpoint a settings service would want is one `GitHubRepository` already owns — the module-per-*concept* rule biting, not a size judgement. The attempt that established it cost a failure worth remembering: the candidate module's name collided with the `RepositorySettings` **type alias** the entry point already exported, and nothing said so. A collision with an existing export of the same name is silent through `tsc`, the bundler and API Extractor alike, since a valid export by that name exists — a green suite, zero warnings and a module no consumer could import. `__test__/reachability.test.ts` therefore asserts every module in `src/` is re-exported from the entry point, which is the only check that could have caught it: the per-module suites could not, because nearly every test file imports its module path directly rather than through the entry point.

## The repo coordinate

A predecessor read the repository slug from the environment in three places, which is what coupled the GitHub client to the Actions runtime. Here it is a first-class value (`RepoRef`) behind its own context service (`Repo`), with layers taking a value, a slug, or reading through the ambient config provider — the env-driven variant **named for being env-driven**.

**Every resource method takes `Repo` in its `R` and no method takes owner and repo arguments.** That is what makes a resource call a single expression, and what makes the scoped override work:

```ts
yield* Effect.forEach(targets, (target) => syncOneRepo.pipe(Repo.provide(target)), { concurrency: 4 });
```

**Resolving it per call rather than once at layer construction is a correction the build produced.** Built the designed way — resources resolving both the client and the repo at construction — **the scoped override silently does nothing**, because the resource already holds the repository it was built with, so the multi-repository story would have been decorative. A test caught it. The client stays resolved at construction; the coordinate is read per call. The general rule this refines: **resolve a dependency once when it is stable, per call when varying it is the point.**

**The scope of a method follows the API, never the consumer's call pattern.** The rule above has an obvious-looking exception — a route that is not `/repos/{owner}/{repo}` — and the exception is narrower than it appears. An org-scoped route still sources its org from `Repo.owner` when the org *is* the repository's owner (`ArtifactMetadata.createStorageRecord` is the worked example, annotating the span as `org` to say which meaning is in play). Only a method needing an org that is **not** the repository's owner takes an explicit argument, because there `Repo` would be lying about its scope.

The case worth recording is one that *looked* like the exception and was not. `GitHubRepository.ownerType` calls an account route, and its first consumer calls it once per run outside their repository loop — which argues for an owner argument, or an eighth owner-scoped module, until you notice that **"my call site is outside the loop" is a property of that consumer's engine, not of the API**. Encoding it in the signature would freeze one program's control flow into a shared service, and the next consumer calling it per repository would find an argument they have to thread for no reason. It is `Repo`-scoped like everything else. The consumer who raised the exception tested it against this rule and withdrew it, then found that moving the call *inside* the loop makes every repository in a fleet share one request, because their cache keys on owner alone.

The generalisation, which is not GitHub-specific: **a service's shape is determined by the contract it wraps and the axis its consumers vary, never by where any one consumer happens to call it.** A speculative owner-scoped module for a single caller is surface the kit does not need; the same reasoning rejected it.

`Repo` is also **a deliberate, recorded exception to "no non-effectful members on a service shape"**: its entire shape is one immutable value class. It is data, not an IO contract — `Layer.mock` is meaningless for it, `Layer.succeed` is the correct double, and no pure helper hides inside an IO API. The rule exists to stop a sync member from silently degrading a *mixed* shape's mock, and a value-only service has no mock to degrade. The boundary to hold: this is legitimate only while the shape is **entirely** one value with no methods. The moment a method appears, it is a service and the rule applies.

## Actions decoupling

Three places where Actions-runtime knowledge leaked into a predecessor's GitHub layer, and what replaces each:

| Leak | Replacement |
| --- | --- |
| rerouting octokit's request log into a workflow command | octokit's log is silenced (the plugin left with the rest wrapper), and **the client logs its own retries** with `Effect.logDebug`. [`@effected/github-actions`](github-actions.md) maps Effect logs onto workflow commands through a `Logger` — the correct seam, and one that works for every kit package |
| reading the repository slug from the environment | [the repo coordinate](#the-repo-coordinate), with the env-driven layer variant named for what it does |
| reading the token from the environment | the config-provider client layer, over a redacted config |

Plus: **no token masking** here (that is an Actions output command), **no state persistence** (an installation token is merely *encodable* so the Actions package can persist it), and **no workflow-command import of any kind**. After this, the package reads no environment variable except through a `Config` in a layer variant named for being env-driven, and is otherwise runnable anywhere — which is what makes it testable and what makes a non-Actions consumer possible.

## Shared vocabulary

Recorded per concept rather than defaulted:

- **One canonical semver model, edge taken.** [`@effected/semver`](semver.md) is pure tier, so the edge is free, and returning a real semver value is what lets a consumer compare without re-parsing. The alternative — return strings and let consumers sort — is what produced a thirty-five-line selection loop in one consumer with an effect round trip per comparison.
- **The repo reference, pull-request info, installation tokens, check-run output and release data are canonical here**, and [`@effected/github-actions`](github-actions.md) consumes rather than duplicates them.
- **A digest is a small deliberate duplication.** An attestation subject digest and a lockfile integrity hash are different concepts wearing similar clothes, and taking an edge across a seam to share a branded string is not worth it. This package declares its own.
- **The release-tag format authority stays in `@effected/workspaces`.** This package's tag-name-to-version extraction is a *parsing convention*, not the tag-format authority; a consumer that needs to *produce* tags uses that package. If a third consumer needs both directions in one place, inverting a contract is the recorded escalation — not an edge from here to an integrated package.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`; tests in `__test__/`. **No `./testing` subpath**, and none of the predecessor's behaviour-reimplementing doubles is ported.

- **Every service ships `makeTest(overrides?)` and `layerTest(overrides?)`**, with unstubbed members dying loudly and naming themselves. This deletes, in one move, a consumer's seven dying-stream stubs and six whole-service reimplementations in test files.
- **Tests drive the *real* client through octokit's documented `fetch` option**, not a double of our own service, so classification, header capture, retry and link-following pagination are all genuinely exercised. Two harness facts to know first: a hand-built response has an empty URL, and octokit's paginator constructs a URL from it for any payload carrying a total count — so the harness must define that property or you get an invalid-URL failure classified as a transport fault. And octokit percent-encodes path parameters, so assert against the recorded decoded path rather than the URL.
- **One recorded-fixture client double exists, and it reimplements nothing.** It pages recorded arrays through **the same pagination engine the live layer uses** and records the page requests it issued, which is what makes truncation testable at all — a predecessor's double ignored both page options and never invoked the callback, so "did the caller ask for page N?" was unanswerable. That shared engine is why this is the narrow exception to the no-behaviour-reimplementing-doubles ban.
- **`GitHubFixtures.requested` records every call, not only the paginated ones**, as a `RecordedCall` carrying kind and params. Recording only pages answered which route a method hit and nothing about what it *sent*, which is the question [a normalising write](github-resources.md#the-configuration-write-half) turns on — and it is why a consumer hand-rolled a parallel harness. It is also the probe that found the silent settings drop recorded there, against the built artifact rather than the source.
- **An unstubbed fixture route dies; a recorded `GitHubError` is a stubbed failure.** Both defaults were changed once a consumer showed what the old ones cost. A missing fixture is test wiring, not a domain outcome, so the fiber dies naming the route — matching what an absent GraphQL fixture always did. Failing typed instead was only loud in code that does not catch: a consumer catching `GitHubError` per resource turned a missing stub into a *different execution path*, and the assertions then failed for a new reason with nothing naming a fixture. The advice this replaces — "stub the 404 explicitly" — was unactionable until a recorded error value could *be* the failure, which it now can. `unstubbed` opts back into the typed not-found, or serves an empty value for a suite whose subject is decisions rather than endpoints.
- **Pure classes get pure tests, with no layer at all**, and the byte budget gets a **property test** over multi-byte and four-byte code points, because a counterexample there is a production rejection.
- **A pagination-forwarding test per paginating method**, which is what makes "no method hard-codes its page options" a checked property rather than a review item.
- **The App suite generates a real RSA key and signs for real**, so the JWT path is exercised rather than described.
- **Mutate the edges before declaring green**: flip the page bound, the byte budget, the already-exists classification and the retry predicate, and confirm the suite goes red.

Run subset suites root-relative with coverage disabled.

## Observability and build

Per the [observability standards](../effect-standards.md#observability-standards): named spans on every public fallible boundary, **stable identifiers only** in annotations — the route, the coordinate, the resulting status, the page count, the failure kind — and **never a token, never a private key, never a request or response body, never GraphQL variables**, which routinely carry node ids and comment bodies. **Retries log at debug**, one line per retry, and that is the only logging in the package. **No metrics**: a library should not decide cardinality for the consumer paying the bill, and the spans are there to derive counters from.

Build through `pnpm build --filter @effected/github`. Naming third-party generic types on a public signature is **fine** — API Extractor resolves a declared dependency's types as externals and emits real imports — so the only suppressed entries are the synthesized schema-class bases; never widen that suppression. Three TSDoc-link rules the build enforces: a link resolves only to symbols **the entry point exports**, under **the name it exports them by**; a schema-declared field is not a linkable member (use backticks); and a module-local const is not linkable at all.

Two smaller build-taught facts, both now comments at their sites: **a `static readonly layer` must wrap its factory in an arrow** or it throws an access-before-initialization error at import time while typechecking clean, and a commit's author can arrive as an empty record rather than null.
