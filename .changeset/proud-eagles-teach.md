---
"@effected/github-actions": minor
---

## Features

### Sigstore identity token adapter for Actions

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

- **`CheckState`** — a check-lifecycle vocabulary (`running`, `pass`, `fail`,
  `warn`, `user_interaction_required`, `skipped`, `timeout`) wider than
  GitHub's own check-run conclusions, with `projectCheckState` mapping it onto
  GitHub's wire vocabulary.
- **`ManagedDocument`** — marker-delimited named regions inside text a human
  may also edit, built on `@effected/templates`' section engine. Regions are
  replaced from current state, never appended, so re-rendering the same state
  is idempotent.
- **`GitHubMarkdown`** — a fluent, escaping-safe markdown writer for GitHub
  surfaces (tables, headings, links, code, lists, `<details>` blocks), plus
  `tableFor(schema, options?)`: a GFM table whose columns are defined once by
  a row schema — headers from `title` annotations with field-name fallback,
  column order from field declaration order, cells encoded through each
  field's own codec, and a per-column `format` that the types require exactly
  where a field's encoded side is not a string. The only module in this
  package that imports `@effected/markdown`.
- **`CheckDocument`** — an in-process reconciler that turns a stream of
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

## Documentation

`Secret.forSigning`'s TSDoc now scopes what it's for: any in-process use that
needs a secret's raw value without writing it to a runner file, not only
signing — the dividing line is where the value goes, not what it's for.
