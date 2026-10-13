---
type: Glossary
title: The github-split (program name)
description: "\"The github-split\" names the joint program that carved five packages — commands, templates, github, github-actions and sbom — out of @savvy-web/github-action-effects and the mechanism half of @savvy-web/silk-effects, replacing both wholesale across six consumer repos."
status: stable
tags:
  - architecture
sources:
  - id: github-actions-package
    resource: ../../packages/github-actions/package.json
  - id: commands-package
    resource: ../../packages/commands/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 72a725d0fc21d10c
---

# The github-split (program name)

"The github-split" is this repository's name for the joint program that
introduced five packages together, as one unit rather than five
independent ports: `@effected/commands`, `@effected/templates`,
`@effected/github`, `@effected/github-actions` and
`@effected/sbom`.[^github-actions-package] The name refers to the
program, not to any one package — a reader who hears "the github-split
five" should understand all five packages, and a reader who hears "the
github-split program" should understand the whole migration effort, not
a single extraction.

## The three structural facts

Three structural facts about the program's design recur across the five
packages' own decisions:

- **`github-actions` is the one package with a required
  `@effect/platform-node` peer**, and the only one licensed to import
  `node:` directly — see [the platform-node peer decision](../decisions/platform-node-peer-in-one-package.md).
  `@azure/storage-blob` is confined to three of its modules, so a
  consumer importing `ActionOutputs` alone cannot link it.
- **`commands` stays boundary tier only because the workspaces edge
  inverts** — a direct `commands` → `workspaces` dependency edge would
  have made four packages integrated, a pure one (`lockfiles`) among
  them, under the dependency policy's tier-propagation rule. See
  [contract inversion is the default](../decisions/contract-inversion-default.md).
- **`sbom` declines `@cyclonedx/cyclonedx-library` and owns its own
  CycloneDX emitter** — the library weighs 6.6 MB with seven optional
  peers, and its `spdx-expression-parse` peer is the exact engine
  `@effected/spdx` exists to replace.

## The five extended packages

The program also extended five already-published packages rather than
adding new ones: `@effected/npm` (retiered to boundary, guardrailed),
`@effected/workspaces` (release and tracking tags, a versioning strategy,
the `LocalExec` layer, the publishability seam), `@effected/config-file`,
`@effected/package-json` and `@effected/markdown`.

## The three in-kit edges dogfood added

After the initial split, consumer dogfooding added three in-kit
dependency edges onto `@effected/github-actions`: `@effected/templates`,
`@effected/markdown` and `@effected/sbom`.[^commands-package] None of the
three changes `github-actions`' own tier — it was already integrated and
nothing depends on it — and each edge stays confined to the modules that
actually need it, pinned by the same bundle-reachability test suite that
confines `@azure/storage-blob`. One of the three closes the inverted
contract described above: `sbom` declares the `IdentityToken` contract
and `github-actions` ships the layer implementing it. Read this as the
general shape consumer dogfood takes against an already-shipped
program: the requests were projections between packages the kit already
had, not requests for new capability, so every edge it produced points
from the integrated overlay downward to packages it already depended on
transitively.

[^github-actions-package]: `packages/github-actions/package.json:36-41`
    — `@effected/github`, `@effected/glob`, `@effected/markdown`,
    `@effected/npm`, `@effected/sbom` and `@effected/templates` under
    `dependencies`, the five-plus-one shape the split program produced.
[^commands-package]: `packages/commands/package.json` — the sibling
    package in the same program, whose own dependency surface stays
    narrow under the contract-inversion pattern described above.
