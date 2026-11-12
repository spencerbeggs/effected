---
type: Project
title: effected
description: What this project is, its boundaries, and its non-goals.
status: stable
tags:
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-11-12T23:05:46Z
integrity:
  generated:
    body: 53bbb01850ca6d38
---

# effected

## Purpose

effected (GitHub `spencerbeggs/effected`, npm org `@effected`) is a pnpm monorepo building an **Effect v4 app kit**: a coherent set of libraries designed v4-first rather than a grab-bag of utilities that happen to share a repo. It replaces per-repo development of a family of predecessor `*-effect` libraries that suffered cross-repo release loops and dependency-interaction bugs surfacing only after publishing. The unit of design is the kit, not the package — packages are carved along the seams real applications press on, and a capability with no named consumer is not built. Scope is closed by five consuming applications (below), not by how much surface an ecosystem could have. All `@effected/*` packages target Effect v4, now stable: the `effected` pnpm catalog holds it and every satellite to one minor with tilde ranges, and plugin overrides derived from it pin the whole graph to that version (see [the effect catalog holds one minor](decisions/effect-catalog-minor-lock.md)). Everything published is `0.x` and unstable; Effect v4 being stable makes a kit `1.0.0` possible, not automatic, and the kit takes it when it chooses to. Releases are changeset-driven: CI builds the changesets present on a branch and releases the packages they name, whether that is the whole kit behind a catalog advance or a single package on a patch — both are ordinary outcomes of the same mechanism, not different processes.

## Design posture

The developer-experience exemplar is the [`semver`](modules/semver.md) package, for its class-based API: static and instance methods on domain classes, no floating functions. In Effect v4 the domain-model class and the schema are the same artifact (`Schema.Class`), so this class-based DX is the ecosystem norm the kit follows, not a house deviation from it.

## Boundaries

The repository holds **libraries, their companions, and one tool**. Standalone tools and applications built on these libraries stay in their own repos and consume published `@effected` packages: a repository with an entry point a user runs, rather than an API a program imports, does not belong here. There are two admitted exceptions. The first is the **`effected` tool** — a command, an MCP server and the carrier that installs both, four packages that are the kit applied and release with it, and the home of the schemastore commands (`effected schema`); see [one tool beside the libraries](decisions/one-tool-beside-the-libraries.md) and [the schema commands](interfaces/schema-commands.md). The second is a **companion** that ships configuration rather than code (`pnpm-plugin-effected`): it carries no library tier — see [companion package](glossary/companion-package.md). Package membership is the `packages/` directory listing.

| Package | Tier | Provenance |
| --- | --- | --- |
| `semver` | pure | port of `semver-effect`; the DX exemplar |
| `jsonc` | pure | port of `jsonc-effect` |
| `yaml` | pure | port of `yaml-effect`; the largest package in the repo |
| `package-json` | boundary | port of `package-json-effect`; SPDX validity delegated to `spdx` |
| `npm` | boundary (was pure) | extraction from `package-json`; resolver contracts plus registry/publish services |
| `pnpm` | pure | extraction; everything pnpm owns alone (settings, versioning block, overrides grammar, workspace file editor, lockfile document) |
| `bun` | pure | extraction; bun's lockfile document and `BunExtension` |
| `config-file` | boundary | port of `config-file-effect`; the four config codecs as free-standing named exports |
| `walker` | boundary | extraction from `config-file`; upward path traversal |
| `glob` | pure | invention; a vendored minimatch dialect as pure string→predicate schemas |
| `toml` | pure | invention; a from-scratch, full-parity TOML engine |
| `lockfiles` | pure | extraction from `workspaces`; bun/npm/pnpm/yarn parsers |
| `store` | integrated | extraction from `xdg`; migrated SQLite `Store` and TTL `Cache` |
| `xdg` | boundary | port of `xdg-effect`; does not depend on `store` |
| `files` | boundary | invention; `AtomicFile.write`, the atomic single-file write adopted across the kit, and `AtomicDirectory.write`, whole-directory replacement, over core `FileSystem` and `Path` in `R` |
| `workspaces` | integrated | port of `workspaces-effect`; discovery, dependency graph, catalogs, change detection |
| `runtimes` | boundary | port of `runtime-resolver`'s library half |
| `tsconfig-json` | boundary | invention; zero `typescript` imports |
| `git` | boundary | invention; typed git introspection over core's `ChildProcessSpawner` |
| `spdx` | pure | invention; vendored SPDX license expressions as pure schemas |
| `app` | integrated | invention; thin composition over `xdg` + `config-file` + `store` |
| `kit` | pure | invention; platform-free primitives shared across front ends (distribution identity, remediation, launch context, and transport-neutral process crash guards on the import-free `./guard` subpath) |
| `env` | boundary | invention; who is running a program and in what terminal (`RuntimeEnv`, `TerminalEnv`, `Audience`, `EnvOverride`) read through `Config`, with no `node:` import; a required peer of `cli-kit`, so an MCP server or engine detects without a CLI dependency |
| `cli-kit` | boundary (`./ui` integrated on opt-in) | invention; the CLI presentation boundary over `effect/cli`: audience, theme and messages, the document IR and its renderers, links, failure reports, logging and prompts in a React-free root; interactive Ink screens and the live view behind `./ui` (`ink` and `react` optional peers) and their harness behind `./ui/testing` |
| `mcp-kit` | boundary | invention; the MCP boundary (stdio wiring, tool-failure shaping, strict-input walkers) over `effect/ai`, plus `./testing` clients |
| `lsp` | boundary | invention; LSP base-protocol framing (byte-counted `Content-Length` encode, an incremental decoder and a `Stream` transform) as pure functions, plus `LspProbe`, the packed-install boot proof for a Language Server bin, behind `./testing` |
| `markdown` | pure | invention; CommonMark + GFM as pure schemas |
| `markdown-lint` | pure | invention; a markdownlint-compatible `LintRule` defined once over `markdown` trees, run by `MarkdownLint`, a pure programmatic host, or by `MarkdownlintAdapter` as a markdownlint custom rule, with no markdownlint import; one regular dependency, `markdown` |
| `shell` | pure | invention; a tolerant shell-syntax lexer and segmenter (`ShellSyntax.parse`, `ShellCommand.fromSegment`) that reports which simple commands an untrusted command string would run, never failing and never evaluating; `effect` is its only peer and it has no dependency at all |
| `commands` | boundary | part-port of `@savvy-web/silk-effects`' `ToolDiscovery` plus invention |
| `templates` | boundary | port of `@savvy-web/silk-effects`' `ManagedSection` |
| `memfs` | pure | invention; a virtual POSIX volume behind core's `FileSystem` key — carries **no `@effected/*` edge, ever** |
| `github` | integrated | port-with-redesign of `@savvy-web/github-action-effects`'s GitHub half |
| `github-references` | pure | extraction from `github`; the issue-reference grammar as pure functions |
| `github-commands` | pure | extraction from `github-actions`; the workflow-command grammar (`WorkflowCommand`, and `CommandNeutralizer`, the runner's two-parser rule) as pure functions; a regular dependency of `github-actions` and `cli-kit` |
| `source` | pure | extraction of the line/character conversion `jsonc`, `yaml`, `toml` and `markdown` each hand-rolled; `LineIndex` (offset to LSP-style zero-based `{ line, character }` and back) and the structural `SourcePosition`/`SourceRange`/`SourceSpan`/`SourceLocation`/`SourceDiagnostic` shapes, no dependency at all; a regular dependency for its adopters |
| `github-actions` | integrated | port-with-redesign of the same package's Actions half |
| `sbom` | integrated | port-with-redesign of the same package's `Attest` knot |
| `schemastore` | boundary (integrated 2026-08-04 → 2026-09-15) | invention; SchemaStore-shaped JSON Schema documents from Effect Schema sources; its commands are `effected schema` in the tool |
| `schema-org` | pure | invention; schema.org vocabulary as Effect Schema classes |
| `jsonl` | boundary | invention; append-only schema-validated JSONL journals |
| `images` | boundary | invention; image facts (format, MIME, dimensions) from bytes and a generated-image cache behind a backend port store satisfies structurally |
| `jwt` | boundary | invention; JWS, JWT, JWK and JWKS sign and verify over WebCrypto, with no `node:` import and `@effected/crypto` (also WebCrypto-only) as its only runtime dependency, so it runs on Cloudflare workerd; the signer under `github`'s App auth and its Actions OIDC verifier |
| `oidc` | boundary | invention; the OIDC vocabulary over `jwt`: the `IdentityToken` issuer contract (moved from `sbom`), ID-token claims, an unverified decode and an audience-guarded verify |
| `crypto` | boundary | extraction from `github-actions` and `savvy-web/build` intake; HMAC, constant-time comparison and AWS SigV4 over core `Mac` and `Digest` in `R`, no `node:` import |
| `webhooks` | boundary | extraction from `savvy-web/build` intake; inbound webhook signature verification presets (Standard Webhooks, GitHub, Stripe, Sanity, HMAC header, shared secret) over `crypto` |
| `s3` | boundary | invention, generalized from `savvy-web/build` intake's hand-rolled archive; a minimal client for one bucket of an S3-compatible store (conditional `put`, `get`, `head`, `delete`, a strict ListObjectsV2) over core `HttpClient`, `Digest` and `Mac` in `R`, signing with `crypto`'s `SigV4`, no `node:` import |
| `changesets` | boundary | invention; a parser for changeset files and `.changeset/config.json` and a release planner, with `@changesets/get-release-plan` kept as a test oracle only |
| `manifest` | pure | extraction from `bundler`, which took it from `@tsdoctor/manifest`; the `bundle.json` spec-1 schema, its encode and decode boundaries and the `ManifestSource` authoring shape, with `effect` its only peer so a doc-site reader never installs the build toolchain; a regular dependency of `bundler`, which re-exports every name |
| `bundler` | integrated | port of `@savvy-web/tsdown-plugins` and `@savvy-web/bundler`, the `bundle.json` schema from `@tsdoctor/manifest`, and a rolldown rewrite of `@savvy-web/github-action-builder`; a `typescript` peer shared only with the tool's `cli`, `mcp` and `plugin` |
| `pnpm-plugin-effected` | companion — no tier | invention; the one `effected` catalog (the Effect family on one minor, and the kit) plus the graph-wide Effect pins, and the public hoist of `@effected/plugin`; renamed from `pnpm-plugin-effect` |
| `plugin` | tool — no tier | invention; the `effected` tool's carrier, the one package a consumer installs (a root devDependency through `catalog:effected`): declares the `effected` and `effected-mcp` bins as shims passing its own distribution identity, re-exports `defineSchemastore`, ships the tsconfig presets as `./tsconfig/*`, and pins the chain below it exactly |
| `cli` | tool — no tier | invention; the `effected` command (`package build`, `action build`, `action init`, `schema build`, `check` and `validate`, `--version`, `--help`) over `effect/cli`, `cli-kit` and `engine`; the name was `cli-kit`'s before [the rename](decisions/carrier-libraries-take-kit-names.md) |
| `mcp` | tool — no tier | invention; the `effected-mcp` stdio server with the `identity` tool and the `package_build`, `action_build`, `action_init`, `schema_build`, `schema_check` and `schema_validate` tools over `effect/ai`, `mcp-kit` and `engine` |
| `engine` | tool — no tier | invention; the tool's shared logic that both front ends report through: `Identity.report`, and the `./schema` subpath (config loader, runner, report classes, version check, the two shipped ajv engines), and the `./build` subpath (`BuildRun`, `ActionRun` and their result classes), built on `kit`, `schemastore` and `bundler` |

The roster is **55 packages**: 50 libraries, one companion (`pnpm-plugin-effected`) and the four packages of the `effected` tool (`plugin`, `cli`, `mcp`, `engine`), which are an application and carry no library tier. `cli-kit`, `mcp-kit`, `kit`, `plugin`, `changesets`, `bundler`, `manifest`, `shell`, `s3` and `markdown-lint`, `pnpm` and `bun` are new npm names, not yet published. `cli`, `mcp` and `engine` published before as the old kit libraries, and their next release is the tool package under the same name. `pnpm-plugin-effected` is already published.

### Consumers

The kit's scope is closed by the applications that consume it, surveyed read-only from outside this repository.

| Consumer | Register entry |
| --- | --- |
| savvy-web/silk-release-action | [silk-release-action](consumers/silk-release-action.md) |
| savvy-web/silk-update-action | [silk-update-action](consumers/silk-update-action.md) |
| savvy-web/silk-runtime-action | [silk-runtime-action](consumers/silk-runtime-action.md) |
| savvy-web/silk-sync-action | [silk-sync-action](consumers/silk-sync-action.md) |
| savvy-web/silk-router-action | [silk-router-action](consumers/silk-router-action.md) |
| spencerbeggs/claude-code-marketplace-manager | [claude-code-marketplace-manager](consumers/claude-code-marketplace-manager.md) |
| savvy-web/systems | [systems](consumers/systems.md) |
| spencerbeggs/reposets | [reposets](consumers/reposets.md) |
| spencerbeggs/tsdoctor | [tsdoctor](consumers/tsdoctor.md) |
| spencerbeggs/okfit | [okfit](consumers/okfit.md) |
| spencerbeggs/vitest-agent | [vitest-agent](consumers/vitest-agent.md) |

Two named applications resolved the "library wearing app clothing" question differently rather than joining the kit outright: `type-registry-effect` stays entirely outside, in its own repo, because it carries `typescript` / `@typescript/vfs` peers the kit refuses; `runtime-resolver`'s library half ships from the kit as `runtimes`, while its CLI ships from the external `runtime-resolver` repo against the published package, so the library's consumers never install `@effect/platform-node`. Further external consumers — `rolldown-pnpm-config`, `rspress-plugin-api-extractor`, and `soda3js/tools` via `@soda3js/config` — take published packages without a register entry of their own in this bundle.

The repository's monorepo tooling and layout are documented in [the workspace module](modules/workspace.md); the agent plugin, the probe workspace and the docs site each have their own Module: [ai-plugin](modules/ai-plugin.md), [scratchpad](modules/scratchpad.md), [website](modules/website.md).

## Non-goals / out of scope

- **Applications.** Anything with a user-run entry point rather than an importable API stays in its own repo, even when it started life here or shares packages with the kit. The one exception is the `effected` tool ([why](decisions/one-tool-beside-the-libraries.md)); the website stays frozen for it.
- **`@effected/json-schema`.** Off the roadmap entirely: its core value is superseded by Effect v4's `Schema.toJsonSchemaDocument`, and the one internal dependency on it (from `xdg`) was a dead facade that has been cut. It would be revisited only if a consuming application appeared.
- **`ts-vfs`.** Lives in the external `type-registry-effect` repo; carries the `typescript` / `@typescript/vfs` peers the kit's "no `@effected/*` package imports `typescript`" posture excludes.
- **The `runtime-resolver` binary.** Ships from the external `runtime-resolver` repo against the published `runtimes` package, so the library's own consumers never need `@effect/platform-node`.
- **Importing `typescript`.** No `@effected/*` package imports the `typescript` package [except `bundler`, and only it and the tool's `engine`, `cli`, `mcp` and `plugin` peer it](conventions/typescript-stays-in-the-bundler.md); version-coupled facts another package would otherwise need (such as `tsconfig-json`'s enum mappings) are carried as data instead.
