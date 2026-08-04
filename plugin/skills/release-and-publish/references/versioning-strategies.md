# Versioning strategy and publishability

Load when: classifying a workspace's release shape (single/fixed-group/
independent), formatting a release tag, or wiring `PublishabilityDetector`.

## `VersioningStrategy` and `ReleaseTag` are pure value classes, not services

Classification is a total fold over publishable names and fixed groups —
the rule that a service shape carries only effectful members is exactly
what rules out wrapping this in a `Context.Service`. Only
`VersioningStrategy.detect` is an `Effect.fn`, over `WorkspaceDiscovery |
PublishabilityDetector`:

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
callable-with-no-effect entry point; `detect` is `classify` run against a
live workspace, keeping only packages `PublishabilityDetector` says publish
somewhere — so a consumer with its own publishing rules swaps the
`PublishabilityDetector` layer instead of filtering the result afterward.

## Tag formats reproduce production byte for byte

```ts
ReleaseTag.single("1.2.3").value;                // "1.2.3"
ReleaseTag.scoped("@acme/cli", "1.2.3").value;   // "@acme/cli@1.2.3"
ReleaseTag.scoped("cli", "1.2.3").value;         // "cli@v1.2.3"
```

The scoped/unscoped `v` asymmetry is **deliberate, not a bug to
normalize** — `versionPrefix` on `TagFormatOptions` is the explicit
override, and the defaults reproduce what the kit's own release action
actually cuts today. Git tag history is not an API — pre-1.0
breaking-change freedom covers this kit's own code, not a consumer's
existing tag continuity, so don't "fix" the asymmetry to look more
consistent.

`VersioningStrategy.tagsFor(releases, options?)` is one `ReleaseTag` per
release under `independent`, or exactly one shared tag carrying the
**first** release's version under `single`/`fixed-group` — whether a
lockstep batch actually agreed on that version is the caller's one-line
check, not a field here.

## Tracking tags — the floating `v1`/`v1.2` aliases

`TrackingTag.forVersion(version, options?)` derives the GitHub Actions
distribution convention — `owner/repo@v1` resolves to whatever 1.x the repo
last pointed `v1` at:

```ts
TrackingTag.forVersion("1.2.3").map((t) => t.value);           // ["v1", "v1.2"]
TrackingTag.forVersion("1.0.0-beta.3");                         // [] — never floats onto a beta
TrackingTag.forVersion("1.2.3", { packageName: "@acme/cli" });  // ["@acme/cli@v1", "@acme/cli@v1.2"]
```

Pure derivation, formatting and parsing **only** — `TrackingTag` never
moves a git tag. Re-pointing a git tag is a consumer/git concern,
deliberately left out of this module.

**Prereleases derive no tracking tags by default** (`options?.includePrerelease`
must be explicit) — anyone depending on `owner/repo@v1` wants the newest
*stable* 1.x, and re-pointing that alias at a beta ships a prerelease to
every such consumer with no signal at all. `+build` metadata is **not** a
prerelease — build metadata is stripped before the prerelease test.
Derivation is **total** — a version that isn't `X.Y.Z` derives `[]` rather
than throwing, because a workspace package's version field is deliberately
tolerant and odd versions reach this module routinely.

`classifyTag(tag)` tells release tags from tracking aliases by **segment
count**, not by the `v` prefix — three numeric segments is a version
(`1.0.0` and `v1.0.0` both classify as release tags), one or two segments
behind a required `v` is a tracking alias. The package prefix splits at the
**last** `@`, so a leading npm scope survives. `unrecognized` is a real,
expected answer — a repository's tags include branch names and `latest`.

## `PublishabilityDetector` has no ambient default

`PublishabilityDetector` decides whether a workspace package publishes and
to where. **No composite in `@effected/workspaces` provides it** —
`Workspaces.layer`, `layerWithGit` and `layerWithConfigDependencies` all
**require** it in `R`:

```ts
import { PublishabilityDetector, Workspaces } from "@effected/workspaces";
import { Layer } from "effect";

const WorkspacesLayer = Workspaces.layer().pipe(Layer.provide(PublishabilityDetector.layerNpm));
```

This is a correctness fix, not missing ergonomics. When a composite used to
supply npm semantics itself, last-wins layer merging meant the natural
override spelling silently resolved back to the default, with no type
error, for the one service deciding whether a package publishes and to
which registry.

Two house rules this seam produced, general past this one contract:

1. **A swappable contract gets no ambient default.** Ship named policies
   (`PublishabilityDetector.layerNpm`, `.layerNone`) and require the choice
   in `R` — wiring that forgets to choose does not compile.
2. **Ship every implementation as a value, not only as a layer.**
   `PublishabilityDetector.npm` is a plain shape value; `layerNpm` wraps
   it. A consumer composing *around* the policy — vetoing specific
   packages while deferring to npm semantics for the rest — reaches
   `PublishabilityDetector.npm.detect(pkg)` directly instead of
   re-entering the tag it is replacing.

See `effect-v4-services-layers` for the general form of both rules.
