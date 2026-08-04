---
"@effected/app": minor
---

## Features

### Designing-an-action wired into action-engineer

The `action-engineer` agent now preloads the `designing-an-action` skill, closing a gap where the skill sequenced a full action build but was never named by either the agent or the `building-a-github-action` router. Agents building or extending a GitHub Action now have a direct path to it, with the greenfield/rebuild loop distinguished from the extend/review loop and an upstream-migration protocol ruling for missing kit surfaces.

## Documentation

### GitHub Actions skill suite completeness pass

Fixes gaps and duplication found by cross-checking every Actions skill against each package's actual exports:

- Documents three previously-unmentioned exports: `PackageManagerInstaller` (with its `PackageManagerPin`/`PackageManagerCache` dependencies), `ChildEnv`, and `ScriptedSpawner`
- Adds the `MinimumLogLevel` recipe wiring `ActionEnvironment.isDebug` to Effect's debug logging, so `RUNNER_DEBUG=1` alone is no longer assumed to enable `Effect.logDebug`
- States the `OptionFromNullOr`/`GITHUB_STATE` round-trip rule directly where `ActionState` is documented, and clarifies `Secret.forChildEnv`'s single-entry case
- Adds the App-auth token lifecycle recipe to `github-app-tokens`: provision with scope verification, envelope persistence, `clientLayer` readback, double-netted revoke, and the add/remove recipe both directions
- Dedupes `Action.run` failure-rendering guidance to `actions-runtime`, now its canonical home
- Folds cross-phase state, failure-posture, layer-minimalism and bundle-truth checkpoints into `designing-an-action`
- Corrects stale counts in `effected-packages` (reference-file gap count, test-double count) and adds cross-references from the package rows to the Actions suite that covers their depth
