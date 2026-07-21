---
"@effected/npm": minor
---

## Features

### `ReleaseAgeGate` / `PartialReleaseAgeGate`

Adds shared vocabulary for pnpm's publish-time release-age gate — the
`minimumReleaseAge` / `minimumReleaseAgeExclude` config pnpm uses to refuse
installing a version younger than a cutoff
(`ERR_PNPM_NO_MATURE_MATCHING_VERSION`). A resolver that picks the highest
in-range version with no publish-time awareness can pick a version pnpm then
rejects; mirroring the gate at resolution time avoids that.

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

`ReleaseAgeGate.combine` merges partial contributions from multiple config
sources strictest-wins: the maximum of the contributed ages (clamped
non-negative), and the exclude sets unioned. `matchesExclude` mirrors pnpm's
own `@pnpm/matcher` name-matching semantics — a `*`-glob crosses `/`, unlike
`@effected/glob`'s minimatch dialect — so `isExcluded` and `filterVersions`
behave exactly like pnpm's own gate. `filterVersions` takes the caller's
clock; a version with a missing or unparseable publish timestamp is dropped,
matching pnpm's strict posture.
