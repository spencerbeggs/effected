---
type: Decision
title: Each plugin versions via its own private tracking package
description: Both plugins version and release independently of the kit's library waves, each through a private, never-published workspace package that exists only to give changesets something to version.
status: deprecated
tags:
  - release
sources:
  - id: claude-code-plugin-package-json
    resource: https://github.com/spencerbeggs/effected/blob/41327b9656d86db47749ee161e198c716853d391/plugins/claude-code/package.json
  - id: copilot-plugin-package-json
    resource: https://github.com/spencerbeggs/effected/blob/41327b9656d86db47749ee161e198c716853d391/plugins/copilot/package.json
  - id: plugins-claude-md
    resource: https://github.com/spencerbeggs/effected/blob/41327b9656d86db47749ee161e198c716853d391/plugins/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: f32557198fd122fe96ce9cda39b07d14198aa10e2a43c30764c9438fd4d8d655
verified:
  - by: human:spencer
    at: 2026-10-03T04:58:49Z
---

# Each plugin versions via its own private tracking package

## Context

Each plugin needs a version and a release cadence independent of the
`@effected` library waves, but neither `plugins/claude-code/` nor
`plugins/copilot/` publishes to npm, and changesets versions workspace
members by acting on their `package.json`. An earlier design tied the
Claude Code plugin's version to `@effected/app`'s changeset scope; that
coupling is dead.

## Decision

Each plugin carries a **private tracking package** whose only job is to
give changesets something to version:

| Tracking package | Directory | Manifest it drives |
| --- | --- | --- |
| `@effected/claude-code-plugin` | `plugins/claude-code/` | `plugins/claude-code/.claude-plugin/plugin.json` |
| `@effected/copilot-plugin` | `plugins/copilot/` | `plugins/copilot/plugin.json` |

Both are `"private": true` with no `publishConfig`, so by the
publishability rule (`publishConfig.access === "public"`), neither
publishes to npm, ever.[^claude-code-plugin-package-json][^copilot-plugin-package-json]
They are workspace members solely because changesets versions workspace
members.

`.changeset/config.json` wires the rest: `privatePackages` is `{ tag:
true, version: true }`, and each tracking package gets a `versionFiles`
entry mapping to its plugin manifest's `$.version`. The flow is: a
changeset naming the tracking package → CI bumps its `package.json` and
the plugin manifest in lockstep → a git tag → a GitHub release, no npm
publish. See [release a plugin](../runbooks/release-a-plugin.md) for the
mechanical procedure.

Each plugin releases independently of the other and of any kit wave: a
changeset for a library moves nothing in `plugins/`, and a plugin release
never waits on one.

## Alternatives rejected

- **Tie the Claude Code plugin's version to `@effected/app`.** Rejected
  and retired: it coupled the plugin's release cadence to a kit wave and
  left it no way to ship on its own.
- **Version both plugins from one shared tracking package.** Rejected:
  the two plugins release on different cadences and through different
  marketplace automation (see
  [copilot-plugin](../modules/copilot-plugin.md)'s hand-bumped ref versus
  the Claude Code plugin's automatic one), so a shared package would
  force one release to carry the other's changes.

## Consequences

To version a plugin, add a changeset naming `@effected/claude-code-plugin`
or `@effected/copilot-plugin` directly — a changeset for any other
package does nothing for either plugin. The resulting tag looks like
`@effected/copilot-plugin@0.1.0` and carries a GitHub release.

[^claude-code-plugin-package-json]: `plugins/claude-code/package.json` —
    `"name": "@effected/claude-code-plugin"`, `"private": true`, no
    `publishConfig`.
[^copilot-plugin-package-json]: `plugins/copilot/package.json` —
    `"name": "@effected/copilot-plugin"`, `"private": true`, no
    `publishConfig`.
