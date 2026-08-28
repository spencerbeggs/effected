---
name: release-and-publish
description: >-
  Use when publishing a package to npm, reading the npm registry from Effect v4, checking whether
  a version is already published, cutting a release tag or GitHub release from an action, applying
  a release-age gate, or deriving tracking tags for GitHub Actions distribution.
---

# Release and publish

Cutting and publishing a release from Effect v4 spans three packages:
`@effected/npm` reads and writes to a registry, `@effected/workspaces`
decides what versions and tags a release needs, `@effected/github` cuts the
tag and the release. General Effect v4 rules — service shapes, layer
composition, `Schema.Class`, testing idioms — live in
`effect-v4-services-layers`, `effect-v4-schema`, `effect-v4-testing`,
`effected-packages`; this skill states only what these packages do for a
release pipeline.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `NpmRegistry` | `import { NpmRegistry } from "@effected/npm"` | Reading a package's published versions, dist-tags or publish times |
| `PackagePublish` | `@effected/npm` | Setting up auth, packing a tarball, or publishing it |
| `NpmExecutor` | `@effected/npm` | Choosing between the ambient npm and a pinned `dlx`-fetched one |
| `classifyRegistry` | `@effected/npm` | Deciding whether a registry is public npm, GitHub Packages, JSR or custom |
| `ReleaseAgeGate` | `@effected/npm` | Holding a version back until it has aged past a minimum |
| `VersioningStrategy`, `ReleaseTag` | `import { VersioningStrategy } from "@effected/workspaces"` | Classifying a workspace's release shape and formatting its tags |
| `TrackingTag` | `@effected/workspaces` | Deriving the floating `v1`/`v1.2` GitHub Actions distribution aliases |
| `PublishabilityDetector` | `@effected/workspaces` | Wiring or overriding which packages publish, and to where |
| `GitTag`, `GitHubRelease` | `import { GitTag, GitHubRelease } from "@effected/github"` | Cutting the actual git tag and GitHub release — see `github-api` |

## Standards

- **Treat the registry as a per-call argument, never a layer-baked one.** A
  single program can legitimately probe two registries for one package —
  don't collapse `NpmRegistry` to a fixed registry at construction.
- **Route a 404 through `Option.none()`, never through stderr-wording
  matching.** Absence is decided on response status structurally, so it
  survives an npm version bump that reworded its error text.
- **Compare `integrity` as the typed brand it is, not a bare string.** A
  string-equals comparison between an SRI hash and something that merely
  looks like one is a defect waiting on a format change.
- **Send the auth token to a caller-supplied npmrc path, never argv.**
  Masking the token in a CI log is the caller's job — `PackagePublish` has
  no opinion about log output and no `ActionOutputs` edge to have one.
- **Never swap `pack`'s two digests.** `integrity` compares against the
  registry's own SRI hash; `sha256Hex` — read back off the packed tarball,
  not derived from npm's report — is the attestation subject. They are both
  strings; getting them backwards is silent.
- **Let `dlx` fail typed when there's no project-local launcher — never let
  it silently fall back to the ambient npm.** A silent fallback would
  reintroduce exactly the OIDC-publishing failure the pinned version
  exists to avoid.
- **Match a registry's subdomain with a leading dot.** A bare suffix match
  would classify a look-alike hostname as the public registry, and that
  classification gates both token-sending and `--provenance`.
- **Clamp a release-age gate only through `ReleaseAgeGate.combine`, never
  in isolation.** `combine` is the single authority: strictest age wins,
  exclude sets union — route every contribution through it, even a lone
  one, so the clamping logic stays in one place.
- **Give `PublishabilityDetector` no ambient default.** Every composite
  that decides workspace versioning requires it explicitly in `R` — ship
  named policies (`.layerNpm`, `.layerNone`) rather than letting a merge
  silently pick a default no type error would catch.
- **Prefer `GitTag.upsert`/`GitHubRelease.create` over a hand-rolled
  exists-then-create sequence** when cutting a release — see `github-api`.

## Footguns

- **GitHub's macOS runner images ship a partly root-owned npm cache, and
  `npm pack` hard-fails against it with an unrecoverable permission
  error.** This is deterministic on every macOS run until the cache is
  redirected — not a flaky retry candidate. **The redirect must be visible
  at the publish call site** — an explicit cache-directory option passed
  alongside the pack/publish call itself — **never an invisible environment
  variable** set once, far from the call it protects. See
  [`references/publish-pipeline.md`](references/publish-pipeline.md).
- The scoped/unscoped `v` prefix asymmetry in `ReleaseTag` is deliberate,
  reproducing production byte for byte — don't "normalize" it to look more
  consistent.
- Tracking tags (`v1`, `v1.2`) derive nothing for a prerelease by default —
  re-pointing `owner/repo@v1` at a beta with no signal would ship it to
  every consumer depending on the newest stable 1.x.
- `ReleaseAgeGate`'s glob dialect is pnpm's `*`-crosses-`/` matcher, **not**
  `@effected/glob`'s minimatch dialect — routing exclude patterns through
  the wrong engine silently changes which packages a gate exempts.
- `NpmRegistry.layerTest()` with no overrides dies loudly by design on the
  first read — reach for `NpmRegistry.layerSeeded({ registries: {} })` when
  a test wants a real, working empty registry instead.

## Additional resources

- [references/publish-pipeline.md](references/publish-pipeline.md) — the
  full `NpmRegistry`/`PackagePublish`/`NpmExecutor` surface, registry
  classification, and the macOS npm-cache hazard in detail. Load when:
  reading the registry, packing/publishing a tarball, or debugging a
  publish step that only fails on macOS.
- [references/versioning-strategies.md](references/versioning-strategies.md) —
  `VersioningStrategy`, `ReleaseTag` formatting, `TrackingTag` derivation,
  and `PublishabilityDetector`'s no-ambient-default rule. Load when:
  classifying a workspace's release shape or formatting/deriving tags.
- [references/tags-and-gates.md](references/tags-and-gates.md) — the
  `ReleaseAgeGate` clamping and exclude-matching rules, plus the
  `GitTag`/`GitHubRelease` call sequence for cutting a release. Load when:
  gating a resolver against too-young releases, or cutting the tag and
  release once a version is chosen.

## Elsewhere

- `@effected/commands`' `Run` and `LocalExec` in full (the combinators
  `PackagePublish` runs through, the argv-prefix table) →
  `running-commands-and-tools`.
- `GitBranch`/`GitTag`/`GitHubRelease`'s full member catalogue,
  `GitHubError` classification, pagination, retry policy → `github-api`.
- GitHub App authentication and token lifecycle → `github-app-tokens`.
- Sigstore signing and CycloneDX SBOM generation over `PackedTarball`'s
  `sha256Hex` → `supply-chain-attestation`.
- `Action.run`'s `ActionServices` and why a publish layer's `R` collapses
  to just `LocalExec` inside an action → `actions-runtime`.
- The scripted-spawner and seeded-registry test harnesses this surface is
  built to be testable against → `testing-actions`.
