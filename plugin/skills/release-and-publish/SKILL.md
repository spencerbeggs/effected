---
name: release-and-publish
description: Use when publishing a package to npm, reading the npm registry from Effect v4, checking whether a version is already published, cutting a release tag or GitHub release from an action, deciding npm publish from CI, distinguishing GitHub Packages from the npm registry, applying a release-age gate before resolving a candidate version, tracking tags like v1/v1.2 for GitHub Actions distribution, or wiring @effected/npm, @effected/workspaces and @effected/github together for a release pipeline. Does not cover generic REST/GraphQL calls (github-api), subprocess execution (running-commands-and-tools), SBOM/attestation (supply-chain-attestation), the Actions runtime (actions-runtime), or test harnesses (testing-actions).
---

# Release and publish

Cutting and publishing a release from Effect v4 spans three packages:
`@effected/npm` reads and writes to a registry, `@effected/workspaces` decides
what versions and tags a release needs, `@effected/github` cuts the tag and
the release. This skill is the surface `silk-release-action` needs from all
three. General Effect v4 rules — service shapes, layer composition,
`Schema.Class`, testing idioms — live in `effect-v4-services-layers`,
`effect-v4-schema`, `effect-v4-testing`, `effected-packages`; this skill
states only what these packages do for a release pipeline.

## Reading the registry — `NpmRegistry`

`NpmRegistry` (`packages/npm/src/NpmRegistry.ts:340`) replaces every shelled
`npm view` with reads over core `HttpClient`. Four methods, each taking an
**optional, per-call** `RegistryTarget`:

```ts
import { NpmRegistry } from "@effected/npm";
import { Effect } from "effect";

const check = Effect.gen(function* () {
 const registry = yield* NpmRegistry;
 const published = yield* registry.version("effect", "4.0.0-beta.101");
 // published: Option<PublishedVersion> — None when that version isn't there
});
```

```ts
export interface RegistryTarget {
 readonly registry?: string | undefined; // defaults to DEFAULT_REGISTRY
 readonly token?: Redacted.Redacted<string> | undefined;
}
```

(`NpmRegistry.ts:25-30`.) `version` / `versions` / `distTags` / `publishTimes`
all take `(name, target?)` (`version` also takes the version number in the
middle) and all default `target?.registry` to `DEFAULT_REGISTRY`
(`https://registry.npmjs.org`, `NpmRegistry.ts:11`).

Three facts are load-bearing:

- **The registry is per-call, never layer-baked.** A publish flow probes two
  registries for one package inside a single program (`silk-release-action/
  src/release/publish.ts:505-540`, cited in `.claude/design/effected/packages/
  npm.md:196`), which a layer-scoped registry cannot express. A test double
  keyed without the registry axis cannot express it either — see the doubles
  below.
- **A 404 is `Option.none()`**, decided on the response **status**
  structurally, not by matching npm's stderr wording (`NpmRegistry.ts:187-190`
  — the v3 layer matched `npm error code E404` and broke when npm reworded it
  from `npm ERR!`). `version` returns `Option<PublishedVersion>`; `versions` /
  `distTags` / `publishTimes` return an empty array/record for an absent
  package rather than failing.
- **`integrity` is typed as this kit's own `IntegrityHash`** brand
  (`@effected/npm`'s SRI/corepack/yarn brand), not a bare string
  (`NpmRegistry.ts:43`) — comparing it against `PackagePublish.pack`'s
  `PackedTarball.integrity` is a typed comparison, not a string-equals-and-hope.
- **A `github-packages` target reads `version` through the packument.**
  GitHub Packages answers the per-version endpoint with 405 regardless of
  credentials, so a registry classifying `github-packages` routes straight to
  the whole-packument read and selects the version from it; a 405 from any
  **other** registry falls back to the same packument path instead of failing
  (`NpmRegistry.ts:160-168,238-296`). Absence stays `Option.none()` either way.

`RegistryReadError` (`NpmRegistry.ts:80-103`) routes on `kind: "transport" |
"status" | "decode"` — never a `"search"` kind that no read ever produces, and
never a prose `reason` field to substring-match.

`publishTimes` is the endpoint that replaces `npm view <pkg> time --json`: it
returns `ReadonlyArray<PublishTime>` (`{ version, publishedAt }`), already
excluding the packument's two non-version `time` keys (`created`, `modified`,
`NpmRegistry.ts:125,271-272`) — a consumer that reads the raw `time` object
itself re-derives that exclusion, which is exactly what `ReleaseAgeGate.
filterVersions` (below) exists not to make you do.

**It runs on core `HttpClient`, not a shelled `npm view`** — no
`ChildProcessSpawner`, no `@effected/commands` edge on this half of the
package. That is why `CommandRunnerLive` drops out of a consumer's wiring
entirely once `NpmRegistry` replaces the old shelled reads
(`.claude/design/effected/consumers/fluency-audit.md:345-347`).

**The doubles** (`NpmRegistry.ts:340-407`):

- `NpmRegistry.layerTest(overrides?: Partial<NpmRegistryShape>)` — every
  unstubbed member dies naming itself. No honest default exists for a
  fabricated version list.
- `NpmRegistry.layerSeeded(seed: RegistrySeed)` — a **working** fake, keyed
  `registries[registry][name][version]`:

  ```ts
  const registry = NpmRegistry.layerSeeded({
   registries: {
    "https://registry.npmjs.org/": { pkg: { "1.0.0": {}, "1.1.0": { integrity: "sha512-…" } } },
    "https://npm.pkg.github.com/": { pkg: { "1.1.0": { integrity: "sha512-…" } } },
   },
  });
  ```

  All three axes are load-bearing (`NpmRegistry.ts:310-320`): the v3 double
  keyed by package name alone, so it could not serve two **versions** of one
  package (a three-way merge needing base-vs-next tarballs) nor two
  **registries** for one version (a mixed publish/recover run) — both
  consumer test suites hand-rolled a replacement stub before this shape
  existed. Point at `testing-actions` for the octokit-side test harness this
  pairs with.

**Migrating a v3 `NpmRegistryTest.empty()` call: reach for `layerSeeded`, not
`layerTest`.** `NpmRegistry.layerTest()` with no overrides dies loudly **by
design** on the first unstubbed member — `version`/`versions`/`distTags`/
`publishTimes` all have `notStubbed` defaults (`NpmRegistry.ts:288-294,353-
359`), because no honest default exists for a fabricated registry read. A v3
suite that called `NpmRegistryTest.empty()` wanted a *working* empty
registry — every package absent, no version anywhere — not a double that
dies the instant it is asked a question. The v4 equivalent is
`NpmRegistry.layerSeeded({ registries: {} })` (`NpmRegistry.ts:405-407`): a
real, working double whose every lookup answers "not found" (`Option.none()`,
`[]`, `{}`) rather than throwing.

## Publishing — `PackagePublish` and `NpmExecutor`

`PackagePublish` (`packages/npm/src/PackagePublish.ts:421`) runs `npm` through
`@effected/commands`' `Run`, over core's `FileSystem | Crypto |
ChildProcessSpawner` plus `@effected/commands`' `LocalExec`:

```ts
export interface PackagePublishShape {
 readonly setupAuth: (options: {
  readonly registry: string;
  readonly token: Redacted.Redacted<string>;
  readonly npmrcPath: string;
 }) => Effect.Effect<void, PublishError>;
 readonly pack: (packageDir: string, options?: PackOptions) => Effect.Effect<PackedTarball, PublishError>;
 readonly publishTarball: (tarballPath: string, options: PublishOptions) => Effect.Effect<PublishOutcome, PublishError>;
 readonly dryRun: (packageDir: string, options?: PackOptions) => Effect.Effect<DryRunOutcome, PublishError>;
} // PackagePublish.ts:152-176
```

**The auth token goes to a caller-supplied npmrc path, never argv.**
`setupAuth` appends `//host/path/:_authToken=<token>` to `npmrcPath`
(`PackagePublish.ts:257-271`, the nerf-dart key format at `:22-26`, trailing
slash **required** or the token silently never applies). **Masking is the
caller's job** — `PackagePublish` takes a `Redacted` and has **no**
`ActionOutputs` edge anywhere in its layer requirements
(`PackagePublish.ts:425-429`). Its own doc states the reason: *"Masking the
token in a CI log is the caller's job; this package takes a `Redacted` and
has no opinion about log output"* (`PackagePublish.ts:157-160`). This is what
deleted a consumer's whole `actionOutputsLive` sub-provide and its five-line
justifying comment (`.claude/design/effected/consumers/fluency-audit.md:308-
347`) — `Redaction` still guards this kit's error messages, not the operating
system's process table, so keeping the token off argv stays the
security-correct choice independent of who masks the log.

**`pack` reports two digests and they are not interchangeable**
(`PackedTarball`, `PackagePublish.ts:47-75`):

| Field | What it is | Compares against |
| --- | --- | --- |
| `integrity` | npm's own sha512 SRI (`IntegrityHash`, optional) | `NpmRegistry.version(...)`'s `integrity` |
| `sha256Hex` | local hex SHA-256 of the tarball's own bytes | the GitHub attestation subject |

`sha256Hex` is computed by reading the packed tarball back off disk and
hashing it (`PackagePublish.ts:296-301`) — not derived from npm's own report —
which is what makes it a verifiable attestation subject. Point at
`supply-chain-attestation` for what consumes it. Getting the two swapped is a
silent attestation mismatch, not a type error: both are strings.

**`publishTarball` returns `PublishOutcome`, whose one field is
`provenanceUrl?: string | undefined`** — a plain optional, not an `Option`:
npm's Sigstore transparency-log URL when it published provenance, scraped
from npm's own output, absent for GitHub Packages, custom registries and
provenance-off runs (`PackagePublish.ts:82-88,361-363`).

**A failed `dryRun` is a result, not an error** (`DryRunOutcome.ok: boolean`,
`PackagePublish.ts:102-109,370-376`). `npm pack --dry-run` never contacts a
registry, so `ok: true` means the package packs, **not** that a registry
would accept it. The error channel is reserved for a structural failure — npm
could not be spawned, or its output was unreadable.

**`NpmExecutor`** (`packages/npm/src/NpmExecutor.ts:20`) replaces v3's five
repeated `packageManager?: "npm" | "pnpm" | "yarn" | "bun"` options with one
value:

```ts
NpmExecutor.ambient;              // the runner's own npm on PATH
NpmExecutor.dlx("npm@11");        // fetched fresh through the project launcher
```

`dlx` runs the fetch through `LocalExec.applyDlx` — `pnpm dlx npm@11 args` —
because OIDC trusted publishing needs npm ≥ 11.5.1 and GitHub-hosted runners
ship 10.x (`NpmExecutor.ts:9-19`). **With no project-local launcher, `dlx`
fails typed (`PublishError { kind: "executor" }`) rather than degrading to
the ambient npm** (`NpmExecutor.ts:37-59`) — silently running the bundled npm
when the caller explicitly asked for a pinned one would reintroduce exactly
the OIDC failure the pin exists to avoid, invisibly.

`PublishError` (`packages/npm/src/PublishError.ts:22`) routes on `kind: "auth"
| "pack" | "publish" | "output" | "digest" | "executor"` — no `reason: string`
to substring-match. `"digest"` exists specifically because npm succeeding at
`pack` while the tarball cannot be read back for hashing is not "npm pack
failed" (`PublishError.ts:9-11`).

**Wire `LocalExec`** — `PackagePublish` and `NpmExecutor.dlx` both need it in
`R`:

- A single-package checkout (an action) uses `LocalExec.layerFor("npm")` or
  `LocalExec.layerNone` (`@effected/commands`) and never installs
  `@effected/workspaces` at all.
- A monorepo consumer uses `Workspaces.localExecLayer()`
  (`packages/workspaces/src/Workspaces.ts:325-370`), which resolves the
  workspace root and detects the package manager, then feeds `NpmExecutor`
  the right prefixes.

```ts
import { NpmRegistry, PackagePublish } from "@effected/npm";
import { Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const npm = Layer.mergeAll(
 NpmRegistry.layer,
 PackagePublish.layer.pipe(Layer.provide(Workspaces.localExecLayer())),
);
```

Point at `running-commands-and-tools` for `Run` and `LocalExec` in full.

## Which registry am I talking to — `RegistryKind`

`classifyRegistry(registry?)` (`packages/npm/src/RegistryKind.ts:73-80`)
replaces four v3 predicates (`isNpmRegistry` / `isGitHubPackagesRegistry` /
`isJsrRegistry` / `isCustomRegistry`) with one exhaustive classification:

```ts
import { classifyRegistry } from "@effected/npm";

const kind = classifyRegistry(target.registry); // "npm" | "github-packages" | "jsr" | "custom"
```

An absent registry classifies as `"npm"` — no registry configured means the
public npm registry. **Subdomain matching requires a leading dot**
(`matchesDomain`, `RegistryKind.ts:47-48`): a bare `endsWith("npmjs.org")`
would classify `evil-npmjs.org` as the public registry, and that
classification decides both whether a token is sent and whether
`--provenance` is requested (`PackagePublish.ts:319-325` gates provenance on
`classifyRegistry(options.registry) === "npm"`, because npm rejects the flag
against GitHub Packages and a release publishing to three registries should
not lose two of them to one flag).

`getRegistryDisplayName` was **dropped on purpose** — v3 had two call sites
disagree on the string for the same input (`"GitHub Packages"` vs
`"github"`). Switch on the `RegistryKind` literal and choose your own words;
don't reintroduce a canonical display string.

## Holding a release back — `ReleaseAgeGate`

`ReleaseAgeGate` (`packages/npm/src/ReleaseAgeGate.ts:131`) mirrors pnpm's
publish-time gate: `minimumReleaseAge` (minutes a version must age) and
`minimumReleaseAgeExclude` (name patterns exempt), so a resolver can drop
too-young candidates before pnpm's own install rejects them with
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`.

```ts
import { ReleaseAgeGate } from "@effected/npm";

const gate = ReleaseAgeGate.combine({ ageMinutes: 1440 }, { exclude: ["@my-scope/*"] });
const eligible = gate.filterVersions(
 ["1.0.0", "1.0.1"],
 { "1.0.0": "2020-01-01T00:00:00Z", "1.0.1": "2026-07-21T00:00:00Z" },
 "prettier",
 Date.now(),
);
```

- **`combine(...contributions: PartialReleaseAgeGate[])`** (static, variadic,
  **total** — never throws) is the **single clamping authority**:
  **strictest age wins** (`Math.max(0, ...ages)`, non-finite contributions
  ignored) and exclude sets **union**, deduplicated and lexicographically
  sorted for a canonical, contribution-order-independent form
  (`ReleaseAgeGate.ts:154-161`). Zero contributions yield the inert zero gate.
- **`matchesExclude(name, patterns)`** (static) / **`isExcluded(name)`**
  (instance) use **`@pnpm/matcher` parity: `*` crosses `/`**
  (`ReleaseAgeGate.ts:60-93`), so a bare `*` matches a scoped name and
  `@scope/*` matches a whole scope. **This is deliberately NOT
  `@effected/glob`'s minimatch dialect**, where `*` refuses to cross `/` —
  pnpm treats the package name as a flat string, and routing through
  `@effected/glob` would silently change which packages a gate exempts. Do
  not "fix" the divergence.
- **`filterVersions(versions, times, name, now)`** (instance, pure,
  **caller-supplied clock**) drops versions younger than the cutoff (`now -
  ageMinutes * 60000`) and **drops versions with a missing or unparseable
  timestamp** — pnpm's strict posture: an unestablishable age is too young
  (`ReleaseAgeGate.ts:213-227`). A no-op when the gate is inert (`ageMinutes
  <= 0`) or the name is excluded.

`PartialReleaseAgeGate` (`ReleaseAgeGate.ts:38-50`) is the permissive inbound
shape — no non-negative check, because raw contributions arrive from
arbitrary config sources (inline `pnpm-workspace.yaml`, replayed hooks, `pnpm
config get`) and `combine` is the only place that clamps. **Never clamp a
`PartialReleaseAgeGate` in isolation** — always route it through `combine`,
even a single contribution, so the clamping stays in one place.

## Versions and tags — `@effected/workspaces` + `@effected/github`

`VersioningStrategy` and `ReleaseTag` are **pure value classes with statics,
not services** (`packages/workspaces/src/VersioningStrategy.ts:1-11,110`,
`ReleaseTag.ts:1-6,327`) — classification is a total fold over publishable
names and fixed groups, and the kit rule that a service shape carries only
effectful members is exactly what rules out wrapping this in a
`Context.Service`. Only `VersioningStrategy.detect` is an `Effect.fn`, over
`WorkspaceDiscovery | PublishabilityDetector`:

```ts
import { VersioningStrategy } from "@effected/workspaces";
import { Effect } from "effect";

// Requires WorkspaceDiscovery | PublishabilityDetector in R; wire both at the edge.
const program = Effect.gen(function* () {
 const strategy = yield* VersioningStrategy.detect({ fixedGroups: [["@scope/a", "@scope/b"]] });
 // strategy.type: "single" | "fixed-group" | "independent"
 return strategy.tagsFor([{ name: "@scope/a", version: "1.2.3" }]);
});
```

`VersioningStrategy.classify({ packages, fixedGroups? })` is the pure,
callable-with-no-effect entry point (`VersioningStrategy.ts:138-152`);
`detect` is `classify` run against a live workspace, keeping only packages
`PublishabilityDetector` says publish somewhere (`:163-180`) — so a consumer
with its own publishing rules swaps the `PublishabilityDetector` layer
instead of filtering the result afterward.

### Tag formats reproduce production byte for byte

`ReleaseTag.single(version, options?)` / `ReleaseTag.scoped(packageName,
version, options?)` (`ReleaseTag.ts:343-368`):

```ts
ReleaseTag.single("1.2.3").value;                // "1.2.3"
ReleaseTag.scoped("@acme/cli", "1.2.3").value;   // "@acme/cli@1.2.3"
ReleaseTag.scoped("cli", "1.2.3").value;         // "cli@v1.2.3"
```

The scoped/unscoped `v` asymmetry is **deliberate, not a bug to normalize**:
`versionPrefix` on `TagFormatOptions` (`ReleaseTag.ts:41-51`) is the explicit
override, and the defaults reproduce what `silk-release-action` actually cuts
today. Rationale, recorded in the module itself (`ReleaseTag.ts:9-13`) and in
the Phase 1c decisions log: git tag history is not an API — pre-1.0
breaking-change freedom covers this kit's code, not a consumer's existing tag
continuity.

`VersioningStrategy.tagsFor(releases, options?)` (`VersioningStrategy.ts:196-
202`) is one `ReleaseTag` per release under `independent`, or exactly one
shared tag carrying the **first** release's version under `single` /
`fixed-group` — whether a lockstep batch actually agreed on that version is
the caller's one-line check, not a field here.

### Tracking tags — the floating `v1` / `v1.2` aliases

`TrackingTag.forVersion(version, options?)` (`ReleaseTag.ts:152,190-208`)
derives the GitHub Actions distribution convention — `owner/repo@v1` resolves
to whatever 1.x the repo last pointed `v1` at:

```ts
TrackingTag.forVersion("1.2.3").map((t) => t.value);           // ["v1", "v1.2"]
TrackingTag.forVersion("1.0.0-beta.3");                         // [] — never floats onto a beta
TrackingTag.forVersion("1.2.3", { packageName: "@acme/cli" });  // ["@acme/cli@v1", "@acme/cli@v1.2"]
```

Pure derivation, formatting and parsing **only** — `TrackingTag` never moves
a git tag. **Re-pointing a git tag is a consumer/git concern**, deliberately
left out of this module (`ReleaseTag.ts:136-139`).

**Prereleases derive no tracking tags by default** (`options?.includePrerelease`
must be explicit) — anyone depending on `owner/repo@v1` wants the newest
*stable* 1.x, and re-pointing that alias at a beta ships a prerelease to
every such consumer with no signal at all. Two adjacent traps, each with a
dedicated test: `+build` metadata is **not** a prerelease (`1.2.3+sha.abc`
derives as the stable `1.2.3` — build metadata is stripped before the `-`
test), and derivation is **total** — a version that isn't `X.Y.Z` derives
`[]` rather than throwing, because `WorkspacePackage.version` is deliberately
tolerant and odd versions reach this module routinely.

`classifyTag(tag)` (`ReleaseTag.ts:260-300`) tells release tags from tracking
aliases by **segment count**, not by the `v` prefix — three numeric segments
is a version (`1.0.0` and `v1.0.0` both classify as release tags), one or two
segments behind a required `v` is a tracking alias. The package prefix splits
at the **last** `@`, so a leading npm scope survives (`@scope/pkg@1.0.0` is
package `@scope/pkg` at version `1.0.0`). `unrecognized` is a real, expected
answer — a repository's tags include branch names and `latest`.

### `PublishabilityDetector` has no ambient default

`PublishabilityDetector` (`packages/workspaces/src/Publishability.ts:119`)
decides whether a workspace package publishes and to where. **No composite in
`@effected/workspaces` provides it** — `Workspaces.layer`, `layerWithGit` and
`layerWithConfigDependencies` all **require** it in `R`:

```ts
import { PublishabilityDetector, Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));
```

This is a correctness fix, not missing ergonomics
(`packages/workspaces/CLAUDE.md:57-88`). When a composite supplied npm
semantics itself, `Layer.mergeAll` being **last-wins** meant the natural
override spelling — `Layer.mergeAll(myDetector, Workspaces.layer())` —
silently resolved to the default, with no type error, for the one service
deciding whether a package publishes and to which registry.

Two house rules this seam produced, general past this one contract:

1. **A swappable contract gets no ambient default.** Ship named policies
   (`PublishabilityDetector.layerNpm`, `.layerNone`) and require the choice
   in `R` — wiring that forgets to choose does not compile.
2. **Ship every implementation as a value, not only as a layer.**
   `PublishabilityDetector.npm` is a `PublishabilityDetectorShape`
   (`Publishability.ts:149-168`); `layerNpm` is `Layer.succeed` over it. A
   consumer composing *around* the policy — vetoing specific packages while
   deferring to npm semantics for the rest — reaches
   `PublishabilityDetector.npm.detect(pkg)` directly instead of re-entering
   the tag it is replacing (`Publishability.ts:71-84,122-147`).

See `effect-v4-services-layers` for the general form of both rules.

### Cutting the tag and the release — `GitTag` + `GitHubRelease`

```ts
import { GitHubRelease, GitTag } from "@effected/github";
import { Effect } from "effect";

const cut = Effect.gen(function* () {
 const tag = yield* GitTag;
 const releases = yield* GitHubRelease;
 yield* tag.upsert("v1.2.3", headSha); // one call, common case; two, raced case
 yield* releases.create({ tag: "v1.2.3", name: "v1.2.3", generateReleaseNotes: true });
});
```

`GitTag.upsert` (`packages/github/src/GitTag.ts:199-203`) creates, and on
`kind: "alreadyExists"` resets rather than failing — the same
`create`-then-`catchIf` shape as `GitBranch.upsert`
(`github-api`'s Case 2). `GitHubRelease.create` (`GitHubRelease.ts:170-191`)
takes `{ tag, name?, body?, draft?, prerelease?, generateReleaseNotes? }`.

**`GitTag.latestSemver(options?)` returns `Option<SemverTag>` in a single
pass** (`GitTag.ts:107,247-269`), replacing 35 lines that ran **one
`Effect.result` per parse and one per comparison**
(`.claude/design/effected/consumers/fluency-audit.md:615-639`):

```ts
const newest = yield* tag.latestSemver({ prefix: "v", includePrerelease: false });
```

This is possible only because `@effected/semver` exposes `parseResult` and
`compare` as **synchronous** primitives (`SemVer.parseResult`, `.compare`) —
`GitTag.ts:259,263` runs both inside a plain `Effect.sync` per streamed tag,
with no Effect round trip per candidate. `LatestSemverOptions.extract`
overrides the tag-name → version convention (`versionFromTag`,
`GitTag.ts:48-56`) for a repo whose tags don't match `v1.2.3` / `pkg@v1.2.3` /
`@scope/pkg@1.2.3`. Point at `github-api` for `GitTag`'s other members
(`create`, `delete`, `list`, `resolve`) and for `GitHubRelease`'s asset
upload and update/list surface.

## Elsewhere

- **`@effected/commands`' `Run` and `LocalExec` in full** (the combinators
  `PackagePublish` runs through, the argv-prefix table, `ChildProcessSpawner`
  wiring) → `running-commands-and-tools`.
- **`GitBranch`/`GitTag`/`GitHubRelease`'s full member catalogue, `GitHubError`
  classification, pagination, retry policy** → `github-api`.
- **GitHub App authentication and token lifecycle** (`GitHubToken`,
  `GitHubApp.clientLayer`) → `github-app-tokens`.
- **Sigstore signing and CycloneDX SBOM generation over `PackedTarball`'s
  `sha256Hex`** → `supply-chain-attestation`.
- **`Action.run`'s `ActionServices` and why a publish layer's `R` collapses to
  just `LocalExec` inside an action** → `actions-runtime`.
- **The scripted-spawner and seeded-registry test harnesses this whole
  surface is built to be testable against** → `testing-actions`.
