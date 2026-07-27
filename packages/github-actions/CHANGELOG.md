# @effected/github-actions

## 0.2.0

### Features

* ### Sigstore identity token adapter for Actions

  `ActionsIdentityToken.layer` implements `@effected/sbom`'s `IdentityToken`
  contract over this package's `OidcTokenIssuer`, so an action can sign
  attestations without either package depending on the other:

  ```ts
  import { ActionsIdentityToken, OidcTokenIssuer } from "@effected/github-actions";
  import { SigstoreSigner } from "@effected/sbom";
  import { Layer } from "effect";

  const signing = SigstoreSigner.layer.pipe(
    Layer.provide(ActionsIdentityToken.layer),
    Layer.provide(OidcTokenIssuer.layer),
  );
  ```

  ### Discardable log buffers

  `ActionLogger.withBuffer` takes a new options argument,
  `{ onSuccess: "flush" | "discard" }`, defaulting to `"flush"`. A step that
  should stay quiet on a clean run passes `{ onSuccess: "discard" }`; a
  failure, defect or interruption always flushes the transcript regardless of
  the setting.

  ```ts
  yield* logger.withBuffer("install", installEffect, { onSuccess: "discard" });
  ```

  ### GitHub-surfaces markdown suite

  A new set of services for building and maintaining GitHub-rendered
  documents — PR comments, PR descriptions, check-run summaries:

  * **`CheckState`** — a check-lifecycle vocabulary (`running`, `pass`, `fail`,
    `warn`, `user_interaction_required`, `skipped`, `timeout`) wider than
    GitHub's own check-run conclusions, with `projectCheckState` mapping it onto
    GitHub's wire vocabulary.
  * **`ManagedDocument`** — marker-delimited named regions inside text a human
    may also edit, built on `@effected/templates`' section engine. Regions are
    replaced from current state, never appended, so re-rendering the same state
    is idempotent.
  * **`GitHubMarkdown`** — a fluent, escaping-safe markdown writer for GitHub
    surfaces (tables, headings, links, code, lists, `<details>` blocks), plus
    `tableFor(schema, options?)`: a GFM table whose columns are defined once by
    a row schema — headers from `title` annotations with field-name fallback,
    column order from field declaration order, cells encoded through each
    field's own codec, and a per-column `format` that the types require exactly
    where a field's encoded side is not a string. The only module in this
    package that imports `@effected/markdown`.
  * **`CheckDocument`** — an in-process reconciler that turns a stream of
    `report` calls into a debounced (trailing, 500ms quiet / 3s max-wait),
    byte-identical-render-skips-the-write update to a managed document:

  ```ts
  import { CheckDocument, CheckReport, GitHubMarkdown } from "@effected/github-actions";

  const layer = CheckDocument.layer({
    namespace: "my-action",
    key: "release-validation",
    render: (checks) => [
      ["header", GitHubMarkdown.table(["Check", "Outcome"], [...checks].map(([key, c]) => [key, c.outcome ?? c.state]))],
    ],
    sink: (rendered) => Effect.log(rendered),
  });
  ```

  This package adds `@effected/templates`, `@effected/markdown` and
  `@effected/sbom` as workspace dependencies.

  ### SLSA provenance capture from OIDC claims

  `ActionsProvenance.capture(audience?)` reads the runner's OIDC claims and
  `GITHUB_SERVER_URL` and returns a `SlsaProvenance`, replacing an eleven-field
  snake-case-to-camelCase rename every attesting consumer previously wrote by
  hand — a hazardous mapping where transposing the repository and owner ids
  compiles clean and produces a validly signed wrong attestation:

  ```ts
  import { ActionsProvenance } from "@effected/github-actions";

  const provenance = yield* ActionsProvenance.capture();
  ```

  The typed `OidcTokenError` passes through untouched, so skip-versus-mandatory
  attestation stays the caller's decision. A missing `GITHUB_SERVER_URL`
  defaults to `https://github.com` rather than failing — only GHES runners set
  it.

### Documentation

* `Secret.forSigning`'s TSDoc now scopes what it's for: any in-process use that
  needs a secret's raw value without writing it to a runner file, not only
  signing — the dividing line is where the value goes, not what it's for. [#191][#191]

### Dependencies

| Dependency         | Type       | Action  | From  | To    |
| ------------------ | ---------- | ------- | ----- | ----- |
| @effected/github   | dependency | updated | 0.1.0 | 0.2.0 |
| @effected/markdown | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/sbom     | dependency | updated | 0.1.0 | 0.2.0 |

* | Dependency          | Type       | Action | From | To    |                                                                       |
  | ------------------- | ---------- | ------ | ---- | ----- | --------------------------------------------------------------------- |
  | @effected/markdown  | dependency | added  | —    | 0.3.0 |                                                                       |
  | @effected/sbom      | dependency | added  | —    | 0.1.0 |                                                                       |
  | @effected/templates | dependency | added  | —    | 0.1.0 | [#191][#191] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

* First release. The GitHub Actions runtime — the services an action needs to
  talk to the runner it is executing inside. The one package in the kit with
  `@effect/platform-node` as a required peer, because a GitHub Action always
  runs as a Node process on a GitHub-provided runner.

  ### `Action.run` — the default runtime

  ```ts
  import { Action, ActionCache } from "@effected/github-actions";

  // The default runtime covers inputs, outputs, state, logging and HTTP.
  // Cache/Artifact/BlobStore are opt-in — they are the only modules that reach
  // Azure, so pulling one in costs exactly one line:
  Action.run(program, { layer: ActionCache.layer });
  ```

  `ActionRuntime.layer` installs an input-aware `ConfigProvider`, so a bare
  `Config.string("dry-run")` resolves correctly instead of silently taking a
  default. `ActionInput` owns the `INPUT_` name mangling and the absence
  contract: a missing input and an input set to `""` are both treated as
  missing data.

  ### Inputs, outputs, state, logging

  `ActionInput`, `ActionOutputs`, `ActionState`, `ActionLogger` (mapping
  `Effect.log*` onto workflow commands and structured annotations),
  `ActionEnvironment` (`GitHubContext` / `RunnerContext`), and `WorkflowCommand`
  for the raw runner protocol.

  ### Cache, artifacts and the blob store

  `ActionCache`, `Artifact`, `BlobStore` / `GitHubCacheBlobStore`, and
  `CacheKey.hashFiles` implement the Actions cache and artifact protocols
  directly over HTTP — no `@actions/*` dependency. `Secret` is the only place a
  secret ever becomes a plain string (declassification and masking are the same
  call).

  ### Auth, OIDC and process control

  `GitHubToken` bridges an installation token from `@effected/github` into the
  runner; `OidcTokenIssuer` reads the runner's OIDC claims; `ToolInstaller`
  downloads and stages a tool atomically into the tool cache; `DetachedProcess`
  manages a spawned child that must outlive the current step. [#180][#180]

### Dependencies

| Dependency       | Type       | Action  | From  | To    |
| ---------------- | ---------- | ------- | ----- | ----- |
| @effected/github | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
