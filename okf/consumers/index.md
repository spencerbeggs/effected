# Consumer

* [claude-code-marketplace-manager](claude-code-marketplace-manager.md) - A single-purpose GitHub Action outside the savvy-web org that edits a Claude Code marketplace manifest's comment-preserving JSONC and lands the change directly or via pull request.
* [savvy-web/systems](systems.md) - Savvy's tooling monorepo — CLI, MCP server, bundler, changesets/changelog engines, templates and plugin — the source the kit's GitHub and Actions code came from and now one of the kit's heaviest consumers.
* [silk-release-action](silk-release-action.md) - The kit's supply-chain and GitHub-write-surface consumer: detects release phase, publishes to npm/JSR/GitHub Packages, builds and attests SBOMs, and cuts GitHub releases.
* [silk-router-action](silk-router-action.md) - The smallest action consumer: decides a workflow run's release phase from the event payload and pending changesets, and is the cleanest evidence of the kit's floor cost.
* [silk-runtime-action](silk-runtime-action.md) - The kit's only consumer of the runner-local half of github-actions: toolchain provisioning, dependency-cache restore, and an embedded Turbo remote-cache server.
* [silk-sync-action](silk-sync-action.md) - A GitHub-API-only consumer that syncs labels, settings and ProjectV2 membership across a repository fleet, and the register's test of partial kit adoption.
* [silk-update-action](silk-update-action.md) - The kit's widest consumer of its monorepo half: resolves registry versions, rewrites catalogs and manifests, upgrades runtimes, and opens dependency-update PRs.
* [spencerbeggs/reposets](reposets.md) - A declarative GitHub repository management CLI — a committable TOML config names settings, secrets, variables, rulesets, deployment environments and CodeQL setup across groups of repositories, applied by one \`sync\` command.
* [spencerbeggs/tsdoctor](tsdoctor.md) - A library monorepo generating API documentation from TypeScript API Extractor models — loads api.json models, resolves external types into a virtual TypeScript environment for Twoslash, fetches versioned documentation bundles, and renders into an RSPress site.
