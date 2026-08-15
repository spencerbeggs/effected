# @effected/github-actions

[![npm](https://img.shields.io/npm/v/@effected%2Fgithub-actions?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/github-actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The GitHub Actions runtime for [Effect](https://effect.website) v4: the services an action needs to talk to the runner it is executing inside. `Action.run` composes the runtime, runs your program, renders a failure as an `::error::` annotation and sets the exit code. `ActionInput` reads workflow inputs as typed `Config` values — string, boolean, integer, redacted secret, multiline list, `key=value` pairs, or a schema-decoded JSON blob — with one absence rule shared by every accessor: unset and `""` are both missing data. `ActionOutputs`, `ActionState`, `ActionLogger` and a fiber-local `ActionEnvironment` round out the runner surface, alongside `ActionCache`, `Artifact`, a metadata-carrying `BlobStore` (S3-compatible or the runner's own cache), `OidcTokenIssuer` and `ToolInstaller` for the heavier protocols. A reporting suite — `GitHubMarkdown`, `ManagedDocument`, `CheckState` and `CheckDocument` — covers the other direction: rendering what a run did onto a pull request comment, a check run or the job summary. No `@actions/*` dependency anywhere — the cache, artifact and tool-cache protocols are implemented directly against their HTTP APIs.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/github-actions

`@actions/core` and its siblings (`@actions/cache`, `@actions/artifact`, `@actions/tool-cache`) are the standard way to write an action, and each one owns its own ad hoc contract: inputs are read with `getInput`, which returns `""` for both "unset" and "set to empty" with no way to tell them apart at the type level; outputs, masking and workflow commands are separate globals; and the cache and artifact clients bring their own HTTP stacks. This package answers the same questions as one coherent set of Effect services instead, with the absence rule stated once (`Config.withDefault` is the idiom for every optional input) and every mutation running through the same `R`-typed services a test can swap out.

It is also the **one place in the kit** where `@effect/platform-node` is a required peer, deliberately: a GitHub Action always compiles into a Node process on a GitHub-provided runner, so there is no second platform to abstract over. Everything that *can* go through a core contract still does — `ToolInstaller` downloads over `HttpClient` and extracts over `ChildProcessSpawner`, `CacheKey` reads over `FileSystem` — and the four sanctioned `node:` imports (`node:crypto` for digests, `process.kill` for reaping a bare pid, `node:child_process` for a detached spawn, and `node:zlib`/`node:stream` in the cache and artifact codecs) cover exactly what core cannot do yet.

The line against [`@effected/github`](https://www.npmjs.com/package/@effected/github) is exact: that package talks to the GitHub API, this one talks to the runner. They meet at two seams — the token bridge (`GitHubToken`) and the `Logger` that maps `Effect.log*` onto workflow commands — and nothing here reads `process.env.GITHUB_REPOSITORY` on `github`'s behalf.

## Install

```bash
npm install @effected/github-actions effect @effect/platform-node
```

```bash
pnpm add @effected/github-actions effect @effect/platform-node
```

Requires Node.js >=24.11.0. `effect` v4 and `@effect/platform-node` are both peer dependencies.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

```ts
import { Action, ActionInput, ActionOutputs } from "@effected/github-actions";
import { Config, Effect } from "effect";

const program = Effect.gen(function* () {
  const name = yield* ActionInput.string("name").pipe(Config.withDefault("world"));
  const outputs = yield* ActionOutputs;
  yield* outputs.set("greeting", `Hello, ${name}!`);
});

await Action.run(program);
// exit code reflects success/failure; failures render as an ::error:: annotation
```

`Action.run` provides `ActionServices` (environment, logger, outputs, state, the Node platform and an `HttpClient`) by default. A capability with a heavier dependency — the cache, artifacts, the blob store — is one extra line: `Action.run(program, { layer: ActionCache.layer })`.

## Reading inputs

Every accessor shares one absence rule: the runner writes `""` for an input the workflow omitted, and this package reads that the same as unset — **missing data**, not an empty value. An optional input needs `Config.withDefault` (or `Config.option`) at the call site:

```ts
import { ActionInput } from "@effected/github-actions";
import { Config, Effect } from "effect";

const program = Effect.gen(function* () {
  const dryRun = yield* ActionInput.boolean("dry-run").pipe(Config.withDefault(false));
  const paths = yield* ActionInput.list("paths").pipe(Config.withDefault([]));
  return { dryRun, paths };
});
// dryRun: boolean; paths: readonly string[] — [] when the input was omitted
```

`list` accepts a JSON array, a bullet list, or comma- and newline-separated values, with full-line `#` comments dropped — whichever shape a workflow author reaches for first. A **present but malformed** value (`dry-run: yes` instead of a YAML 1.2 boolean) is a different class from an absent one: it fails carrying its `actual` and is never silently swallowed by a default.

## The token bridge

`GitHubToken` shapes GitHub App authentication like the three-phase workflow it runs inside: mint in `pre`, use in `main`, revoke in `post`. Nothing survives between phases except what `GITHUB_STATE` carries, so an installation token — which lives about an hour — is persisted rather than held in a `Scope`:

```ts
import { GitHubToken } from "@effected/github-actions";
import { Effect, Redacted } from "effect";

// pre:
const pre = GitHubToken.provision({
  appId: "123456",
  privateKey: Redacted.make(process.env.APP_PRIVATE_KEY as string),
  owner: "acme",
  required: { contents: "write", pull_requests: "write" },
});

// main: bind once — layers memoize by reference
const ClientLayer = GitHubToken.clientLayer();

// post:
const post = GitHubToken.dispose();
```

`GitHubToken.read` fails typed with `reason: "expired"` rather than handing back a token GitHub will answer with a bare 401 — the credential that could re-mint one is the app's private key, and persisting that through a plaintext `GITHUB_STATE` file would trade a one-hour token for a permanent one.

## Secrets

`Secret` is the only place in this package a `Redacted` value becomes a plain string, and masking and declassification are the same call — every member registers the value with the runner's `::add-mask::` filter *before* returning plaintext:

```ts
import { Secret } from "@effected/github-actions";
import { Effect } from "effect";

declare const token: import("effect/Redacted").Redacted<string>;

const program = Effect.gen(function* () {
  const env = yield* Secret.forChildEnv({ MY_TOKEN: token });
  // every value in `env` is already masked in the runner log
  return env;
});
```

## The runner's cache, artifacts and OIDC

`ActionCache` and `Artifact` speak the Actions Twirp v2 protocol directly — no `@actions/cache` or `@actions/artifact` dependency, and both are excluded from `ActionRuntime.layer` on purpose, so a consumer that only sets an output never links `@azure/storage-blob`:

```ts
import { ActionCache, CacheKey } from "@effected/github-actions";
import { Effect, Option } from "effect";

const program = Effect.gen(function* () {
  const cache = yield* ActionCache;
  const key = CacheKey.of("Linux", "pnpm-store", "abc123");
  const hit = yield* cache.restore(["~/.pnpm-store"], key);
  if (Option.isNone(hit)) {
    yield* cache.save(["~/.pnpm-store"], key);
  }
});

await Action.run(program, { layer: ActionCache.layer });
```

`CacheKey.hashFiles` is byte-compatible with `@actions/glob`'s `hashFiles`, and `OidcTokenIssuer.claims` decodes the runner's OIDC token for a SLSA provenance predicate without verifying its signature — the token arrived over TLS from the runner's own token service, so the transport is the trust boundary and nothing here branches on the claims for authorization.

`ActionsProvenance.capture` turns those claims into an `@effected/sbom` `SlsaProvenance` predicate, and `ActionsIdentityToken.layer` serves that package's narrow `IdentityToken` contract from the same issuer — the inversion that keeps the Actions runtime out of every consumer that only wants to emit an SBOM:

```ts
import { ActionsIdentityToken, ActionsProvenance, OidcTokenIssuer } from "@effected/github-actions";
import { SigstoreSigner } from "@effected/sbom";
import { Effect, Layer } from "effect";

const program = Effect.gen(function* () {
  const provenance = yield* ActionsProvenance.capture();
  return provenance.runDetails.builder.id;
});
// the builder id, derived from the workflow ref in the runner's own claims

const SigningLayer = SigstoreSigner.layer.pipe(
  Layer.provide(ActionsIdentityToken.layer),
  Layer.provide(OidcTokenIssuer.layer),
);
```

An `OidcTokenError` passes through `capture` untouched: whether an unattested publish is allowed is the action's policy, not this package's. `reason: "unavailable"` almost always means the workflow is missing `permissions: id-token: write`.

## Reporting on GitHub surfaces

The other half of an action's job is saying what happened — on a pull request comment, a check-run summary or the job summary. `GitHubMarkdown` writes those bodies. Every member takes pre-rendered markdown and returns a string, but the structure around it goes through `@effected/markdown`'s serializer rather than string joining, so a cell carrying `>=1 || <2` escapes its pipes instead of shifting every column after it. `tableFor` goes further and takes the table's whole shape from a row schema:

```ts
import { GitHubMarkdown } from "@effected/github-actions";
import { Schema } from "effect";

const Row = Schema.Struct({
  name: Schema.String.annotate({ title: "Check" }),
  detail: Schema.String,
});

console.log(GitHubMarkdown.tableFor(Row).render([{ name: "build", detail: "clean" }]));
// | Check | detail |
// | --- | --- |
// | build | clean |
```

Column order is field declaration order, each header is the field's `title` annotation, and each cell is the field's encoded form — so a typed field projects through its own codec, and a row cannot transpose columns because it is an object rather than a positional array.

`ManagedDocument` owns named regions inside text a human also edits: a sentinel HTML comment identifies the document, marker comments delimit each region, and everything outside them survives byte-for-byte. Regions are replaced from current state rather than appended, which is what makes a sticky comment safe to re-render. `CheckDocument` puts a debounced reconciler on top — report a check as its state changes, and a background fiber projects the registry onto the document and writes it through a narrow sink:

```ts
import { CheckDocument, CheckReport } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const doc = yield* CheckDocument;
  yield* doc.report("build", CheckReport.make({ state: "running" }));
  yield* doc.report("build", CheckReport.make({ state: "pass", outcome: "clean" }));
  yield* doc.flush;
});
// one write carrying the final state; a render byte-identical to the last one writes nothing
```

The debounce is trailing with a max-wait, so a burst of reports coalesces into one write carrying the *final* state while a steady stream still surfaces progress. `CheckState` is the vocabulary both of them speak, and it is deliberately wider than GitHub's conclusion set — `running` is a state rather than the absence of one, and `user_interaction_required` names a pipeline waiting on a human. `projectCheckState` maps each onto the wire form GitHub wants, as a status plus a conclusion exactly when the status is `completed`.

## Testing

Every service ships `makeTest(overrides?)` and `layerTest(overrides?)`, with unstubbed members dying loudly and naming themselves — three recorded exceptions state why they default instead: `ActionEnvironment.makeTest` seeds the twelve `GITHUB_*`/`RUNNER_*` variables, `ActionLogger.makeTest` defaults to silent, and `DryRun.makeTest` defaults to rehearsing, the safe direction. `ActionEnvironment.makeTest`/`layerTest` also take the webhook event payload as an optional second argument, serving it directly instead of routing it through a `GITHUB_EVENT_PATH` filesystem read the stubbed filesystem could never satisfy:

```ts
import { ActionEnvironment } from "@effected/github-actions";

const layer = ActionEnvironment.layerTest(
  { GITHUB_EVENT_NAME: "pull_request" },
  { pull_request: { number: 42 } },
);
```

```ts
import { ActionOutputs } from "@effected/github-actions";
import { Effect } from "effect";

const TestOutputs = ActionOutputs.layerTest({
  set: () => Effect.void,
});
```

`OidcTokenIssuer.layerFor(claims)` returns a real decodable unsigned JWT built from the same claims `claims()` reports, and `BlobStore.layerMemory` runs the real envelope framing — both exist because a synthetic double previously made the provenance path structurally untestable.

## Features

- `Action.run` / `ActionRuntime.layer` — the entry point and default runtime: environment, logger, outputs, state, the Node platform and an `HttpClient`.
- `ActionInput` — typed input accessors (`string`, `boolean`, `integer`, `redacted`, `lines`, `list`, `pairs`, `schema`) sharing one absence rule, plus the `INPUT_`-aware `ConfigProvider` `Action.run` installs by default.
- `ActionOutputs` — step outputs, JSON outputs, the job summary, exported variables, `PATH` additions, failure annotations and log masking.
- `ActionState` / `ActionEnvironment` — persisted `pre`/`main`/`post` state, and the fiber-local `GITHUB_*`/`RUNNER_*` context read once from `process.env`.
- `ActionLogger` — collapsible groups, buffered step transcripts (`withBuffer({ onSuccess: "discard" })` drops a green step's transcript entirely, while a failure, defect or interruption still flushes it), `withStep(name, effect, options?)` for the same buffering plus one summary line on success and a `❌ <name>` header above the transcript on failure, `::notice::` annotations, and the `Logger` that renders every `Effect.log*` as a workflow command.
- `DryRun` — the rehearsal guard every mutation goes through, driven by the `dry-run` input by default.
- `Secret` — the one declassification seam between a `Redacted` value and a plain string, masking before it returns plaintext.
- `GitHubToken` — the App-token lifecycle shaped like the `pre`/`main`/`post` workflow: mint, verify scopes, persist, read, revoke.
- `ActionCache` / `Artifact` — the runner's cache and artifact protocols over Twirp v2, excluded from the default runtime so a consumer that skips them never links Azure.
- `CacheKey` — cache keys and their restore-key ladder, plus `hashFiles`/`matchingFiles`/`hashMatching` byte-compatible with `@actions/glob`.
- `OidcTokenIssuer` — the runner's OIDC token service, with unverified claim decoding for provenance predicates.
- `ActionsIdentityToken` / `ActionsProvenance` — the `@effected/sbom` seam: `layer` serves that package's `IdentityToken` contract from the runner's issuer, and `capture` builds a `SlsaProvenance` predicate out of the runner's OIDC claims.
- `GitHubMarkdown` — the escaping-safe writer for GitHub surfaces: `table`, `tableFor(schema)`, `heading`, `link`, `code`, `codeBlock`, `list`, `details` and `raw`, and the package's only importer of `@effected/markdown`.
- `ManagedDocument` — marker-delimited named regions in text a human also edits, for a sticky comment or a managed pull request description; content outside the regions survives byte-for-byte.
- `CheckState` / `projectCheckState` — the kit's check vocabulary, wider than GitHub's conclusions, and its projection onto the check-run wire form.
- `CheckDocument` — the debounced check-to-document reconciler: report states as they change, and one write lands carrying the final one.
- `ToolInstaller` — download, extract and cache a toolchain in the runner's tool cache, with no `@actions/tool-cache` dependency.
- `BlobStore` — durable `get`/`put`/`has` over bytes plus a metadata channel, backed by `layerS3` (SigV4-signed, no `@aws-sdk/*` dependency) or `GitHubCacheBlobStore.layer` (the runner's own cache); `layerMemory` runs the real envelope framing for tests.

## License

[MIT](LICENSE)
