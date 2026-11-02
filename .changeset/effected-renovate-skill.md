---
"@effected/ai-plugins": minor
---

## Features

### `/effected-renovate`

A new user-invoked skill that moves a repository onto a new `@effected` release. It bumps the catalog plugin and the other config dependencies, regenerates the lockfile, checks that one `effect` resolves, then builds, tests and aligns the remaining dependencies.

* **The upgrade ledger.** Each release now ships one entry per change a consumer must act on: a break, a behaviour change, a security fix, a tooling change or a surface worth adopting. `applicable.mjs` compares the pre-upgrade lockfile with the new one, lists only the entries the upgrade crossed, and shows the files where each one meets your code. A repository several releases behind gets the earlier rounds too, fetched from the plugin's release tags.
* **The first round** covers the move to Effect 4.1.1 and the matching kit release, in 47 entries.
* **Renamed config dependencies** declared in the ledger are applied by `bump-config-deps.mjs`, for example `@effected/pnpm-plugin-effect` to `@effected/pnpm-plugin-effected`.

The session briefing lists the new skill.

## Maintenance

* The tracking package is renamed from `@effected/ai-plugin` to `@effected/ai-plugins`, so plugin release tags now read `@effected/ai-plugins@<version>`.
