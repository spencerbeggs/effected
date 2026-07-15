---
"@effected/npm": minor
---

## Features

### `DependencySpecifier`

Relocated from `@effected/package-json` and given a second view: alongside the existing branded string and its protocol taxonomy statics (`DependencySpecifier.protocolOf`, `.isRange`, `.isCatalog`, `.isWorkspace`, …), decoding through `DependencySpecifier.FromString` now classifies a specifier into a five-case tagged union — `catalog` / `workspace` / `range` / `dist-tag` / `raw` — that consumers can pattern-match on directly:

```ts
import { DependencySpecifier } from "@effected/npm";
import { Schema } from "effect";

const classified = Schema.decodeUnknownSync(DependencySpecifier.FromString)("workspace:^1.0.0");
// => WorkspaceSpecifier { _tag: "workspace", raw: "workspace:^1.0.0", range: "^1.0.0" }
```

Encoding round-trips the original string byte-for-byte, so re-serializing a decoded value never drifts from a before/after manifest or lockfile diff.

### `DependencySection`

The dependency-section vocabulary shared across the kit: `DependencyKind` (`prod` / `dev` / `peer` / `optional`) and `DependencyField` (`dependencies` … `optionalDependencies`), plus a bidirectional mapping between the two.

```ts
import { DependencySection } from "@effected/npm";

DependencySection.fieldOf("dev"); // => "devDependencies"
DependencySection.kindOf("peerDependencies"); // => "peer"
```

### `IntegrityHash`

A branded string covering the three integrity-hash forms the kit meets: SRI (`sha512-<base64>`), corepack (`sha512.<hex>`), and yarn Berry's cache-versioned checksum (`10c0/<hex>`), with taxonomy statics (`isSri`, `isCorepack`, `isYarnChecksum`, `algorithmOf`) and a typed `decode` that fails with `InvalidIntegrityHashError` on a malformed string.

Consuming packages should read integrity hashes through this brand rather than a bare string — the taxonomy and the typed error come for free.

Takes a new pure `@effected/semver` workspace edge, used to validate ranges inside `DependencySpecifier`.
