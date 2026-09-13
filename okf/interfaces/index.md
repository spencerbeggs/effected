# Interface

* [@effected/github App authentication](github-app-auth.md) - The App JWT, installation-token lifecycle, and the seam the GitHub Actions runtime bridges on.
* [@effected/github GraphQL](github-graphql.md) - Typed GraphQL documents over the same client, errors and spans as REST.
* [@effected/github REST client](github-rest-client.md) - The route-keyed REST client, its escape hatch, and the pagination model over octokit.
* [@effected/github errors and retry](github-errors-and-retry.md) - Four error classes, one classification step, and one retry policy driven by GitHub's own headers.
* [@effected/github resource services](github-resources.md) - One context service per GitHub noun, turning typed endpoints into domain operations.
* [@effected/jsonl journal service](jsonl-journal.md) - The write half of @effected/jsonl — append, atomicity, publish ordering, shutdown, and the cooperative-writer process model with its watcher.
* [@effected/jsonl read surfaces](jsonl-slice.md) - Slice, the one filter shape every read surface takes; the consumption model built on it; and the read economy that motivates the whole package.
* [@effected/markdown MDX vocabulary](markdown-mdx.md) - A construction-and-serialization-only extension of the node model for MDX, shaped to three vendored oracle packages, with no MDX parse support.
* [@effected/markdown frontmatter](markdown-frontmatter.md) - The frontmatter capture node, its read/write codec contract, the $schema declaration grammar and resolver seam, and the string-level split/join facade.
* [@effected/schema-org validate entrypoint](schema-org-validate.md) - The offline conformance validator and vocabulary read API over the vendored schema.org dataset, exposed only from the ./validate subpath.
* [@effected/workspaces catalogs and the config-dependency seam](workspaces-catalogs.md) - WorkspaceCatalogs and CatalogSet assembly, the release-age gate, and the ConfigDependencyHooks opt-in replay seam over pnpm config dependencies.
* [@effected/workspaces dependency graph](workspaces-graph.md) - The pure DependencyGraph value class over the discovered package list — the edge index, cycle detection, topological levels, and Mermaid rendering.
* [@effected/workspaces discovery and detection](workspaces-discovery.md) - Root finding, the packages: enumerator, the WorkspacePackage located-member model, and package-manager detection.
* [@effected/workspaces duplicate-copy checking](workspaces-duplicate-check.md) - DuplicateCheck — a lockfile-only report of every package resolving at two or more versions and who pulls each copy, with the kit predicate that names the Layer-mismatch trap.
* [@effected/workspaces peer-dependency checking](workspaces-peer-check.md) - PeerCheck — a lockfile-only reproduction of pnpm peers check, returning a report rather than an array and failing closed on what it cannot verify.
* [@effected/workspaces release surface](workspaces-release.md) - PublishabilityDetector, VersioningStrategy, and ReleaseTag — the release-shaped questions the workspace model already holds the facts for.
* [@effected/workspaces snapshots](workspaces-snapshots.md) - WorkspaceSnapshots and WorkspaceStateSnapshot — point-in-time workspace reads at a git ref or in the worktree, and the at/worktree hook-catalog asymmetry.
* [@effected/yaml comment model](yaml-comment-model.md) - The per-node comment fields, their attribution rules, one-string storage with its spaces-only escape, and the recorded divergences from the reference implementation.
* [@effected/yaml lint system](yaml-lint.md) - The yamllint-class rule engine, public token stream, autofix, config schema and config-inference surface built on the yaml engine.
* [@effected/yaml stringify options](yaml-stringify-options.md) - The emitter's optional presentation and compatibility behaviours -- indentSequences, explicit-key spill, lineWidth folding, requoteScalars and quoteCompat.
* [The catalog:sync / catalog:check CLI](catalog-sync-cli.md) - Two root package.json scripts over lib/scripts/catalog-sync.ts that resolve every catalogued @effected/* package's next-release version, rewrite the effected catalog literal in packages/pnpm-plugin-effect/savvy.build.ts, and gate on both catalog membership and version drift.
* [The package-json decode-free text path](package-json-text.md) - PackageJsonFormat's formatter and surgical mutator work on manifest text without ever decoding it — the formatter matching sort-package-json's byte order exactly, and the mutator preserving every untouched byte around an edit — so both work on legal manifests the strict Package decode rejects.
* [Vendored repos manifest](vendored-repos-manifest.md) - The .repos/config.json shape the silk repos tooling reads to manage every vendored submodule.
* [actions-attestation](actions-attestation.md) - OidcTokenIssuer, ActionsIdentityToken and ActionsProvenance — the runner-shaped adapters that close sbom's inverted contracts.
* [actions-reporting](actions-reporting.md) - CheckState, ManagedDocument, GitHubMarkdown and CheckDocument — the living-document surfaces an action reports progress into.
* [actions-runtime](actions-runtime.md) - The runner runtime a GitHub Action composes through Action.run — environment, config-backed inputs, logging, outputs/state, secrets and the App-token bridge.
* [actions-storage](actions-storage.md) - The Actions cache and artifact protocols, the blob store envelope, cache-key derivation and the tool/package-manager installers.
