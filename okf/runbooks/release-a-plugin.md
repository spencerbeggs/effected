---
type: Runbook
title: Release a plugin
description: Cut a version of the effected plugin through @effected/ai-plugin's changeset, ending in one git tag and GitHub release for both host builds and no npm publish.
status: stable
resource: ../../.changeset/config.json
tags:
  - release
sources:
  - id: changeset-config
    resource: ../../.changeset/config.json
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T04:19:44Z
  body_sha256: 6e3a98e6f061c95fda60076b36b7fdbbe90f3b5863e5f080bc56662214e62c5a
---

# Release a plugin

## Trigger

A change under `plugin/` is ready to ship as a new plugin version — a
skill, agent, hook or `pluginfinity.config.ts` change, with
`plugin/builds/` already rebuilt and committed per
[author the plugin once in plugin/](../conventions/author-the-plugin-once.md).

## Steps

1. Confirm the builds are current: from `plugin/`, run
   `pnpm exec pluginfinity build --check` and expect empty `added`,
   `changed` and `removed` lists for both targets.
2. Add a changeset naming `@effected/ai-plugin`. A changeset naming any
   other package does nothing for the plugin — see
   [one tracking package versions both plugin builds](../decisions/ai-plugin-versions-both-builds.md).
3. When the release runs, CI bumps `plugin/package.json` and both built
   manifests, `plugin/builds/claude/.claude-plugin/plugin.json` and
   `plugin/builds/copilot/plugin.json`, in lockstep through the
   `versionFiles` mapping.[^changeset-config]
4. CI cuts a git tag named `@effected/ai-plugin@<version>` and a GitHub
   release. The tracking package has no `publishConfig`, so **no npm
   publish** happens.
5. Confirm both `spencerbeggs/bot` marketplace entries now point at the
   release commit, and at `plugin/builds/claude` and
   `plugin/builds/copilot` respectively. The marketplace lives in another
   repository; change it only with the owner's go-ahead.

## End state

`plugin/package.json` and both built manifests carry the new version, a
single `@effected/ai-plugin@<version>` tag and GitHub release exist, no
npm package was published, and both marketplace entries are pinned to
the release commit at the matching build path.

[^changeset-config]: `.changeset/config.json` — two `versionFiles` globs
    under `@effected/ai-plugin`, each at `$.version`.
