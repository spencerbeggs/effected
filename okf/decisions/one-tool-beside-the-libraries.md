---
type: Decision
title: The monorepo holds one tool, effected, beside its libraries
description: "The repository ships the effected tool (the effected command, the effected-mcp server, and the @effected/plugin carrier that installs both) in the same monorepo as the kit's libraries, because the tool is built from the kit and its agent plugin must release in step with it; applications otherwise stay in external repos, libraries stay the rest of the repo, and the website stays frozen."
status: stable
tags:
  - architecture
  - release
sources:
  - id: design
    resource: ../../docs/superpowers/specs/2026-11-02-effected-plugin-design.md
    title: "The design this Decision records"
  - id: issue-1147
    resource: https://github.com/spencerbeggs/effected/issues/1147
    title: "@effected/plugin: the tool, tracked as a whole"
  - id: issue-1223
    resource: https://github.com/spencerbeggs/effected/issues/1223
    title: "This branch's slice of 1147"
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-02T00:00:00Z
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: 9ad424b71a2f60e6
  verified:
    by: human:spencer
    at: 2026-11-02T17:04:46Z
    content: 323683fd638ae344
verified:
  - by: human:spencer
    at: 2026-11-02T17:04:46Z
---

# The monorepo holds one tool, effected, beside its libraries

## Context

The [project](../project.md) said the repository held "libraries only" and that anything with a user-run entry point stayed in its own repo. The kit is now about to ship a tool: `effected`, a command and a stdio MCP server that a consumer installs as one root devDependency and that the [agent plugin](../modules/ai-plugin.md) launches. The tool will grow to bundle packages, build GitHub Actions and export tsconfig presets, and already runs the schemastore functions (`effected schema`), all of which are kit libraries applied. Issue 1147 required the exception to be recorded rather than assumed.

## Decision

The monorepo holds **one tool**, `effected`, as four packages beside the libraries: [engine](../modules/engine.md) (shared logic), [cli](../modules/cli.md) (the `effected` command), [mcp](../modules/mcp.md) (the `effected-mcp` server) and [plugin](../modules/plugin.md) (the carrier that declares both bins as shims). They are an application, not libraries: no library tier applies, and they follow the kit's dependency and peer conventions. They publish in the `effected` catalog like every other package, and a consumer installs only `@effected/plugin`.

The tool lives here because it is made of the kit and releases with it: the catalog, the agent plugin that launches it, and the upgrade ledger that tells consumers about it all change in the same pass, and a separate repo would restore the cross-repo release loops the kit exists to remove.

## Boundaries that still hold

- **Applications other than this one tool stay in external repos.** The exception is the tool, not a licence for others; a consumer application is still surveyed from outside under `consumers/`.
- **Libraries are everything else.** The kit's libraries keep their tiers and their closed scope; the tool takes no capability a library should own, and shared logic lives in `engine`, built on the kit's libraries.
- **The website is frozen.** No docs pages, navigation or website content for the tool packages.
- **Companions stay a separate category.** A [companion package](../glossary/companion-package.md) ships configuration, not a program; the tool is not a companion.

## Alternatives rejected

- **A separate `effected` tool repo.** Rejected: the tool's every command is the kit applied, the catalog and agent plugin release with it, and the repo split is the cross-repo loop the kit was built to end.
- **Treating the tool as a companion.** Rejected: a companion ships configuration, while the tool is programs that front the whole kit.

## Related

- [The carrier libraries take kit names](carrier-libraries-take-kit-names.md) frees the names the tool's packages use.
- [The schemastore commands live in the tool](schema-commands-live-in-the-tool.md) is the first builder to move in, and the pattern later ones follow.
- [Carrier-only bins](carrier-only-declares-bins.md) is the pattern; the tool uses its supported shared-bin alternative because the agent plugin's one-off fallback runs `@effected/mcp`, and a one-off runner cannot choose between two bins of one package.
