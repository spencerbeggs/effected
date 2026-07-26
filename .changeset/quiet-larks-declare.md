---
"@effected/app": minor
---

## Features

### GitHub Actions and API skill suite for the "effected" Claude Code plugin

The plugin ships a twelve-skill suite for building GitHub Actions, calling the
GitHub API, running commands, publishing releases and attesting supply-chain
artifacts — routed from a new `building-a-github-action` entry point that
directs to the right package and skill for a capability (and says plainly what
does *not* exist, so an agent doesn't reach for `@actions/*` or reinvent a
retired API). The eleven skills it routes to cover the action runtime
(`actions-runtime`), inputs/outputs (`actions-inputs-outputs`), logging and
reporting (`actions-reporting`), state/secrets (`actions-state-and-secrets`),
cache and artifacts (`actions-cache-and-artifacts`), the GitHub REST/GraphQL
surface (`github-api`), App token minting (`github-app-tokens`), running
commands and discovering tools (`running-commands-and-tools`), release and
publish mechanics (`release-and-publish`), SBOM/attestation
(`supply-chain-attestation`), and the test-double conventions for this domain
(`testing-actions`).

A new `action-engineer` specialist subagent carries this suite end to end for
whole action- and release-engineering tasks, joining the existing
`effect-developer` / `effect-reviewer` / `effect-migrator` specialists.

The existing Effect v4 skills (house style, module index, construct map,
schema, services/layers, testing, source lookup, the `effected-packages`
index, and `building-a-format-package`) were updated with findings from the
program's migration and probe passes, and the session-start orientation hook
now reflects the expanded skill and agent roster.

## Refactoring

`App`, `AppCache`, `AppConfig` and `AppStore` are now static classes with a
private constructor rather than `as const` namespace objects. Call syntax is
unchanged (`App.layer(...)`); each member's TSDoc now ships in the built
`.d.ts`, where an `as const` object's inferred member types previously
dropped it.
