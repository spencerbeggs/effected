---
"@effected/app": minor
---

## Features

### `structuring-an-action`: the canonical GitHub Action repository shape

A net-new, fourteenth skill teaching the annotated action-repo tree, structural standards as positive imperatives, and structural footguns for laying out a GitHub Action repository. Six references — `entries-and-layers`, `program-and-steps`, `services-and-shims`, `schema-state-and-format`, `tests`, `scaffolding` — carry demonstrative generic code shapes and cite the `github-action-template` repository as the living worked example. `designing-an-action` cross-links it to distinguish build order (that skill) from build shape (this one).

### `action-engineer` preloads the full 14-skill Actions suite

`action-engineer` now preloads every skill in the Actions suite instead of loading a subset on demand: `actions-cache-and-artifacts`, `supply-chain-attestation`, `running-commands-and-tools`, `release-and-publish` and the new `structuring-an-action` join the ten it already carried, so an agent building or extending a GitHub Action always has the whole suite in context.

## Documentation

### Actions skill suite rewritten to a lean index-plus-references architecture

Every skill in the suite — `building-a-github-action`, `designing-an-action`, `structuring-an-action`, `actions-runtime`, `actions-inputs-outputs`, `actions-reporting`, `actions-state-and-secrets`, `actions-cache-and-artifacts`, `github-api`, `github-app-tokens`, `running-commands-and-tools`, `release-and-publish`, `supply-chain-attestation`, `testing-actions` — is now a lean index over roughly 40 self-contained reference files: a construct-to-import table, standards stated as positive imperatives, one-line footguns pointing at the reference that explains each, and explicit `Load-when`-guarded links carrying the deep mechanism, written in a timeless, consumer-repo-facing voice rather than narrating this kit's own history.

Frontmatter across the suite now separates a trigger-only `description` from a dedicated `when_to_use` trigger-phrase catalog, so a skill's listing stays short while its full set of trigger phrases stays discoverable.
