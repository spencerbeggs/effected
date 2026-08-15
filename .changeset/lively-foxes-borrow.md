---
"@effected/package-json": minor
---

## Breaking Changes

`PackageJsonFileShape` gains three new members — `readManifest`, `writeManifest` and `modify` (see Features below). Any hand-built test double implementing `PackageJsonFileShape` structurally must add them.

## Features

### `PackageManifest` — a presence-lenient package.json model

A new `PackageManifest` class decodes the shapes `Package` rightly rejects: `name` and `version` are optional, and `packageManager` accepts the range spelling (`pnpm@^11.20.0`) via the new `PackageManagerRange` class. Every field that *is* present still decodes through the same typed codecs as `Package` — this is the idiomatic private workspace root (`{ "private": true, "packageManager": "pnpm@11.2.0" }`), not a weaker validator.

```ts
import { PackageManifest } from "@effected/package-json";

const root = yield* PackageManifest.decode({ private: true, packageManager: "pnpm@^11.20.0" });
root.isPrivate; // true
root.packageManager?.isExact; // false — it's a range, not a pin
```

### `PackageJsonFormat.modify` / `modifyToString`

A surgical, decode-free field editor over package.json text: applies one `PackageFieldEdit` (a `path` plus a `value`, or `value: undefined` to delete) and preserves every byte outside the edited span — key order, indentation, line endings, trailing newline — which is what keeps a one-field change reviewable in someone else's repository.

### `PackageJsonFile.readManifest` / `writeManifest` / `modify`

The `PackageJsonFile` service grows three matching members: `readManifest`/`writeManifest` read and write through `PackageManifest` instead of the strict `Package`, and `modify` applies a list of `PackageFieldEdit`s to a file on disk in one read/edit/write pass, skipping the write entirely when the result is byte-identical to what was read.

```ts
import { PackageJsonFile } from "@effected/package-json";

const files = yield* PackageJsonFile;
yield* files.modify("./package.json", [{ path: ["packageManager"], value: "pnpm@11.2.0" }]);
```
