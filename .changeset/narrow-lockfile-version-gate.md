---
"@effected/lockfiles": minor
---

## Breaking Changes

The supported input domain narrows to pnpm `lockfileVersion` **9+** and npm `lockfileVersion` **3+**. This is a lockfile-format gate, not a package-manager-version claim — a lockfile records no manager version, and format 9 is written by pnpm 9, 10 and 11 alike.

An older lockfile that previously parsed now fails typed at `stage: "validation"` with a structured cause:

```ts
import { Lockfile, isUnsupportedLockfileVersion } from "@effected/lockfiles";
import { Effect } from "effect";

const parsed = Lockfile.parse(text, { format: "npm" }).pipe(
  Effect.catchTag("LockfileParseError", (error) =>
    isUnsupportedLockfileVersion(error.cause)
      ? Effect.fail(`lockfile too old: needs ${error.cause.format} lockfileVersion ${error.cause.minimumSupported}+`)
      : Effect.fail("malformed lockfile"),
  ),
);
```

`error.cause` carries `{ _tag: "UnsupportedLockfileVersion", format, lockfileVersion, minimumSupported, message }`; discriminate on `_tag` via the new `isUnsupportedLockfileVersion` predicate rather than parsing `message`. bun and yarn are unaffected — neither format records a comparable version line.

## Features

* `ResolvedPackage` gained `peerDependencies` and `peerDependenciesMeta` (declared peer ranges and their `{ optional }` flags, normalized across all four formats), `instanceId` (the lockfile-native identity of this instance — opaque, look it up rather than parse it), `resolved` (dependency/peer name → the `instanceId` it resolved to) and `unresolvedEdges` (edges the lockfile records but the model could not name, distinct from a genuine absence).
* New exports `UnsupportedLockfileVersion` (type) and `isUnsupportedLockfileVersion` (predicate) so the `cause._tag` discrimination above typechecks.

## Bug Fixes

* Nested npm entries no longer retain their path in `name` — an entry previously named `express/node_modules/debug` now resolves to `debug`.
* npm/pnpm entries nested under a workspace directory (e.g. `packages/lib/node_modules/react`) are no longer dropped. A lockfile recording two `react` versions previously parsed to one, silently, with no error — any consumer comparing resolved versions could report a stale or missing answer.
