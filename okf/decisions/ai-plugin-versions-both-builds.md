---
type: Decision
title: One tracking package versions both plugin builds
description: "@effected/ai-plugin, a private never-published workspace package, versions the Claude Code and Copilot builds together, so one changeset releases both at one version."
status: stable
supersedes: plugins-version-via-private-tracking-packages.md
tags:
  - release
sources:
  - id: ai-plugin-package-json
    resource: ../../plugin/package.json
  - id: changeset-config
    resource: ../../.changeset/config.json
generated:
  by: "claude-code/opus-5.5"
  at: 2026-10-03T04:19:44Z
  body_sha256: f792fc75c3637483d64a57fa843854cc2609714b82ef9c4e2c4d925632c776df
verified:
  - by: human:spencer
    at: 2026-10-03T04:58:31Z
---

# One tracking package versions both plugin builds

## Context

The plugin needs a version and a release cadence independent of the
`@effected` library waves, but it never publishes to npm, and changesets
versions workspace members by acting on their `package.json`. The plugin
used to be two hand-maintained trees, `plugins/claude-code/` and
`plugins/copilot/`, each with its own tracking package and its own
version (0.27.0 and 0.15.0 at the cut-over). pluginfinity now builds
both hosts from one source in `plugin/`, so the two no longer carry
different content to version separately.

## Decision

`plugin/package.json` is the private tracking package
`@effected/ai-plugin`.[^ai-plugin-package-json] It is `"private": true`
with no `publishConfig`, so by the publishability rule
(`publishConfig.access === "public"`) it never publishes to npm. It is a
workspace member solely because changesets versions workspace members.

`.changeset/config.json` gives it two `versionFiles` entries,
`plugin/builds/claude/.claude-plugin/plugin.json` and
`plugin/builds/copilot/plugin.json`, both at `$.version`.[^changeset-config]
A changeset naming `@effected/ai-plugin` therefore bumps `package.json`
and both built manifests in lockstep, then CI cuts a git tag and a
GitHub release with no npm publish. Both hosts always share one version.
See [release a plugin](../runbooks/release-a-plugin.md) for the
procedure.

The plugin releases independently of any kit wave: a changeset for a
library moves nothing in `plugin/`, and a plugin release never waits on
one.

## Alternatives rejected

- **Keep one tracking package per host.** Rejected: both builds come
  from one source and one build, so separate versions would only record
  which marketplace someone remembered to bump. Carrying the Claude Code
  line forward (0.27.0) keeps that channel's version monotonic.
- **Tie the plugin's version to `@effected/app`.** Rejected and retired
  long before this decision: it coupled the plugin's release cadence to
  a kit wave.

## Consequences

To version the plugin, add a changeset naming `@effected/ai-plugin`; a
changeset for any other package does nothing for it. The Copilot channel
jumps from 0.15.0 to the shared line on its first release.
`pluginfinity.config.ts` sets no `version`, so a build stamps both
manifests with `package.json`'s; the release bump writes all three to
the same value, so `pluginfinity build --check` stays clean after it.

[^ai-plugin-package-json]: `plugin/package.json` —
    `"name": "@effected/ai-plugin"`, `"private": true`, no
    `publishConfig`.
[^changeset-config]: `.changeset/config.json` — the `@effected/ai-plugin`
    entry under `@savvy-web/changelog`'s `packages`.
