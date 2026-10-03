# The release-age gate, and cutting the tag

Load when: gating a resolver against too-young releases, or cutting the git
tag and GitHub release once a version is chosen.

## Holding a release back — `ReleaseAgeGate`

`ReleaseAgeGate` mirrors pnpm's publish-time gate: `minimumReleaseAge`
(minutes a version must age) and `minimumReleaseAgeExclude` (name patterns
exempt), so a resolver can drop too-young candidates before pnpm's own
install rejects them with a mature-matching-version error.

```ts
import { ReleaseAgeGate } from "@effected/npm";

const gate = ReleaseAgeGate.combine({ ageMinutes: 1440 }, { exclude: ["@my-scope/*"] });
const eligible = gate.filterVersions(
  ["1.0.0", "1.0.1"],
  { "1.0.0": "2020-01-01T00:00:00Z", "1.0.1": "2020-06-01T00:00:00Z" },
  "prettier",
  Date.now(),
);
```

- **`combine(...contributions)`** (static, variadic, **total** — never
  throws) is the **single clamping authority**: strictest age wins (the
  maximum across contributions, non-finite ones ignored) and exclude sets
  **union**, deduplicated and lexicographically sorted for a canonical,
  contribution-order-independent form. Zero contributions yield the inert
  zero gate.
- **`matchesExclude`/`isExcluded`** use pnpm's own matcher parity: `*`
  **crosses `/`** — a bare `*` matches a scoped name and `@scope/*` matches
  a whole scope. This is deliberately **not** `@effected/glob`'s minimatch
  dialect, where `*` refuses to cross `/` — pnpm treats the package name as
  a flat string, and routing through `@effected/glob` would silently
  change which packages a gate exempts. Do not "fix" the divergence.
- **`filterVersions(versions, times, name, now)`** (instance, pure,
  caller-supplied clock) drops versions younger than the cutoff and drops
  versions with a missing or unparseable timestamp — pnpm's strict
  posture: an unestablishable age is too young. A no-op when the gate is
  inert or the name is excluded.

`PartialReleaseAgeGate` is the permissive inbound shape — no non-negative
check, because raw contributions arrive from arbitrary config sources and
`combine` is the only place that clamps. **Never clamp a
`PartialReleaseAgeGate` in isolation** — always route it through `combine`,
even a single contribution, so the clamping stays in one place.

## Cutting the tag and the release — `GitTag` + `GitHubRelease`

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

`GitTag.upsert` creates, and on an already-exists response resets rather
than failing — the same create-then-recover shape as `GitBranch.upsert`
(see `github-api`). `GitHubRelease.create` takes `{ tag, name?, body?,
draft?, prerelease?, generateReleaseNotes? }`.

`GitTag.latestSemver(options?)` returns `Option<SemverTag>` in a single
pass over the tag stream, possible only because `@effected/semver` exposes
its parse and compare primitives as synchronous — no `Effect` round trip
per candidate:

```ts
const newest = yield* tag.latestSemver({ prefix: "v", includePrerelease: false });
```

`LatestSemverOptions.extract` overrides the tag-name → version convention
for a repo whose tags don't match `v1.2.3`/`pkg@v1.2.3`/`@scope/pkg@1.2.3`.
Point at `github-api` for `GitTag`'s other members (`create`, `delete`,
`list`, `resolve`) and for `GitHubRelease`'s asset-upload and update/list
surface — this reference states only the release-cutting call sequence.
