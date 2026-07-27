---
"@effected/app": patch
---

## Documentation

Reconciles the plugin's action-building skills with the current
`@effected/github-actions` behavior:

- `building-a-github-action`'s bare-`Config.*` warning now reflects that
  `ActionRuntime.layer` installs `ActionInput.layerDefault`, so a bare read
  under `Action.run` does resolve the runner's `INPUT_` derivation in
  production — the false green is specifically in test suites that bypass the
  runtime with their own `ConfigProvider`. Adds a "call sequences" reference
  table for multi-service flows (signing and storing an attestation,
  publishing an integrity-checked package, holding a token across the three
  action phases, emitting and attesting an SBOM).
- `testing-actions` documents a `NodeServices.layer` / `ChildProcessSpawner`
  merge-order gotcha found while dogfooding: `NodeServices.layer` also
  provides `ChildProcessSpawner`, and in a `Layer.merge`/`Layer.mergeAll` the
  last provider of a duplicate service wins — so
  `Layer.mergeAll(scriptedSpawner, NodeServices.layer)` silently replaces a
  test's scripted spawner with the real one. It now also documents two
  round-2 findings: an unstubbed test double must die **lazily**
  (`() => Effect.sync(() => { throw ... })`, never a bare `throw`) so a
  consumer's `Effect.exit`/`Effect.flip` assertion sees the failure instead of
  a raw thrown error; and `ActionEnvironment.layerTest()` seeds
  `GITHUB_SERVER_URL` with the same value production defaults to, so testing
  an absence path needs `ActionEnvironment.layerFrom({})` instead.
- `effect-api-extractor-bases` documents a fifth `{@link}` link-resolution
  failure: a re-exported cross-package `Schema.Class` referenced from a file
  that only `import type`s it fails with a distinct resolver message
  ("not supported yet by the resolver") and can attribute the diagnostic to
  the wrong line — backticks are the only fix.
- `supply-chain-attestation` stops teaching the hand-rolled Sigstore identity
  adapter its worked example predated, pointing instead at the shipped
  `ActionsIdentityToken.layer`, and routes Actions consumers building SLSA
  provenance to `ActionsProvenance.capture` instead of hand-mapping OIDC
  claims.
