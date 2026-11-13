# @effected/lockfiles

[![npm](https://img.shields.io/npm/v/@effected%2Flockfiles?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/lockfiles)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Lockfile parsing for [Effect](https://effect.website) v4: bun (`bun.lock`), npm (`package-lock.json`), and pnpm (`pnpm-lock.yaml`) all normalized into one `Lockfile` schema model, plus pure integrity checking of that model against workspace manifests and a pure before/after comparison of two lockfiles. Three formats, one model, no IO and no external runtime dependencies.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 (`effect` `~4.1.0`) and still in `0.x` development. Stable Effect
> makes a kit `1.0.0` possible, not automatic. To keep your `effect` and
> `@effect/*` versions on the line the kit is built and tested against, install
> [`@effected/pnpm-plugin-effected`](https://www.npmjs.com/package/@effected/pnpm-plugin-effected).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/lockfiles

Every package manager writes its lockfile in a different dialect — JSONC for bun, JSON for npm, YAML for pnpm — and each encodes packages, workspace edges and integrity data differently. Tooling that wants to answer "which version of `typescript` is resolved here" ends up with three code paths and three sets of bugs. This package normalizes all three into one model, so the question is asked once regardless of which package manager produced the file.

Every entrypoint takes content as a **string**. The package performs no IO at all: reading files, finding workspace roots and detecting which package manager a repo uses belong to its consumers, and keeping them out means the parser is a pure function you can drive from a fixture, a network response or a git blob. Malformed input always exits through a typed error channel, never as a defect, and the two ways a lockfile can be unusable are distinct tags rather than one blurry `reason` string.

## Install

```bash
npm install @effected/lockfiles @effected/bun @effected/jsonc @effected/npm @effected/pnpm @effected/semver @effected/yaml effect
```

```bash
pnpm add @effected/lockfiles @effected/bun @effected/jsonc @effected/npm @effected/pnpm @effected/semver @effected/yaml effect
```

Requires Node.js >=24.11.0. `effect` v4, `@effected/bun`, `@effected/jsonc`, `@effected/npm`, `@effected/pnpm`, `@effected/semver` and `@effected/yaml` are peer dependencies — each manager's native lockfile document, the JSONC and YAML engines, the shared dependency-specifier vocabulary and the SemVer range checker all arrive through those siblings, so nothing outside `effect` and `@effected/*` reaches your tree. Package managers that install peers automatically will pull them in; add them to your manifest explicitly if yours does not.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

## Quick start

```ts
import { Lockfile, LockfileIntegrity, WorkspaceManifest } from "@effected/lockfiles";
import { Effect } from "effect";

declare const content: string; // lockfile text, read by the caller

const program = Effect.gen(function* () {
  // The only fallible boundary in the package.
  const lockfile = yield* Lockfile.parse(content, { format: "pnpm" });

  // pnpm workspace packages come back keyed by importer path; rewrite them
  // once you have read the manifests. Total and pure — no error channel.
  const named = lockfile.withImporterNames(new Map([["packages/core", "@acme/core"]]));

  // Total lookups over the model.
  const versions = named.packagesNamed("typescript").map((p) => p.version);

  // Pure integrity checking — no Effect, no error channel, no IO.
  const report = LockfileIntegrity.compare(named, [
    WorkspaceManifest.make({ name: "@acme/core", dependencies: { lodash: "^4.17.0" } }),
  ]);

  return { versions, workspaces: named.workspacePackages.length, valid: report.valid };
});

Effect.runPromise(program).then(console.log);
// { versions: [...resolved typescript versions], workspaces: <count>, valid: true | false }
```

## Formats

`format` is a literal, and `filenameFor` / `fromFilename` map between the literal and the file on disk so a consumer that detected a package manager never has to hard-code a filename.

| Format | Filename | Dialect | Notes |
| ------ | -------- | ------- | ----- |
| `"bun"` | `bun.lock` | JSONC | Trusted dependencies preserved on `BunExtension` |
| `"npm"` | `package-lock.json` | JSON | `lockfileVersion` 3+ — v2 and older fail typed |
| `"pnpm"` | `pnpm-lock.yaml` | YAML | `lockfileVersion` 9+ — older fails typed. Catalogs preserved on `PnpmExtension`; see below |

### Supported lockfile versions

The gate is on the **lockfile format version**, which is the only version a lockfile records:

| Format | Minimum | Older input |
| ------ | ------- | ----------- |
| pnpm | `lockfileVersion` 9 | `LockfileParseError`, `stage: "validation"` |
| npm | `lockfileVersion` 3 | `LockfileParseError`, `stage: "validation"` |
| bun | not gated | — |

The `cause` is a structured `{ _tag: "UnsupportedLockfileVersion", format, lockfileVersion, minimumSupported, message }`, so a consumer can distinguish "your lockfile is too old" from "your lockfile is malformed" without parsing prose. `isUnsupportedLockfileVersion` is the exported predicate that narrows to it — discriminate on the tag, never on `message`, which is a summary rather than contract:

```ts
import { isUnsupportedLockfileVersion, Lockfile } from "@effected/lockfiles";
import { Effect } from "effect";

declare const content: string;

const program = Lockfile.parse(content, { format: "pnpm" }).pipe(
  Effect.catchTag("LockfileParseError", (error) =>
    isUnsupportedLockfileVersion(error.cause)
      ? Effect.fail(`lockfileVersion ${error.cause.lockfileVersion}; need ${error.cause.minimumSupported}+`)
      : Effect.fail("malformed lockfile"),
  ),
);
// a pre-v9 pnpm lockfile takes the first branch, a truncated one the second
```

`cause` stays an open channel deliberately: it carries whatever the delegated parsing engines throw, so declaring it as a closed union would present an open channel as an exhaustive one. The predicate is what makes narrowing it honest.

Older formats are rejected rather than parsed because they cannot answer the questions the model now asks: pre-v9 pnpm has no `snapshots:` section, and npm v1/v2 trees record no per-instance nesting, so both would decode into rows with no resolution data.

**Tested against** pnpm 11.22.0, npm 11.19.0 and bun 1.3.14 — a separate claim from the gate, and deliberately so. A lockfile does not record which package manager wrote it, and the mapping is many-to-one (pnpm 9, 10 and 11 all write format `9.0`), so no manager-version requirement could be enforced here even in principle.

## Errors

`Lockfile.parse` is the only fallible entrypoint, and it fails two ways.

| Tag | Means | Fields |
| --- | ----- | ------ |
| `LockfileParseError` | The content is not a valid lockfile of that format. | `format`, `stage` (`"syntax"` when the text itself did not parse, `"validation"` when it parsed but did not have the expected shape), `cause` (structural, never stringified) |
| `LockfileFramingError` | The text parsed, but no single lockfile document could be located in it. | `format`, `documents`, `reason` (`"noLockfileDocument"`, `"noImporters"`, `"unexpectedDocuments"`) |

The framing error exists because `pnpm-lock.yaml` is a YAML **stream**, not a YAML document. pnpm 11 writes a config-dependencies preamble ahead of the lockfile whenever a workspace uses `configDependencies`, so the file carries two documents — and the preamble declares `lockfileVersion`, `importers` and `packages` too, so a parser that reads only the first document gets a lockfile that *validates* and describes an empty workspace. That is a wrong answer shaped exactly like a right one. The rule here is positional and deterministic rather than a heuristic: pnpm composes the preamble as a prefix, so the lockfile is the **last** document. A stream carrying no lockfile document fails typed. It never degrades into an empty `Lockfile`.

## Instances and resolution

A row in `lockfile.packages` is one package **instance**, not one package. A dependency installed twice under different peers is two rows, and `instanceId` is that row's lockfile-native identity, carried verbatim. Treat it as **opaque**: look an id up in the model, never split or pattern-match one, because its spelling is the format's business and differs per manager.

`resolved` maps each dependency name — and each peer name the lockfile records a resolution for — to the `instanceId` it actually resolved to, which is what lets a consumer walk the real graph rather than re-resolving ranges itself. `peerDependencies` and `peerDependenciesMeta` carry the declarations as written, defaulting to `{}`.

```ts
import { Option } from "effect";

const [instance] = lockfile.packagesNamed("react-dom");
const reactId = instance?.resolved["react"];
const react = reactId === undefined ? Option.none() : lockfile.packageByInstanceId(reactId);
// Option.some(ResolvedPackage) — the version this particular react-dom instance resolved to
// Option.none() when the lockfile records no row under that id
```

`packageByInstanceId` is the lookup to reach for rather than a scan over `lockfile.packages`: it builds its index lazily on first call and reuses it, so walking a graph edge by edge stays linear instead of quadratic. A repeated id resolves to the first row, so a malformed lockfile gives a stable answer rather than an iteration-order one.

`unresolvedEdges` names the edges the lockfile **records** but the model could not name. A name listed there is not absent — it is unanswered, so a missing `resolved` key must not be read as "nothing is there". A gate that cares about completeness checks that array before trusting an empty result.

## Comparing two lockfiles

`LockfileDiff.compare(before, after)` reports what moved between two parsed lockfiles — what an update tool reports after an install. It is total and pure, like `LockfileIntegrity.compare`: no Effect, no error channel, no IO.

```ts
import { Lockfile, LockfileDiff } from "@effected/lockfiles";
import { Effect } from "effect";

declare const beforeText: string; // the lockfile before `pnpm update`
declare const afterText: string; // and after

const program = Effect.gen(function* () {
  const before = yield* Lockfile.parse(beforeText, { format: "pnpm" });
  const after = yield* Lockfile.parse(afterText, { format: "pnpm" });
  const diff = LockfileDiff.compare(before, after);

  for (const change of diff.catalogs) {
    // A side that does not exist, or a version that does not resolve, is absent.
    const from = change.version.before ?? "-";
    const to = change.version.after ?? "-";
    console.log(`${change.catalog}/${change.name} ${change.kind}: ${from} -> ${to}`);
  }
  return diff.importers.filter((change) => change.specifier.after?._tag !== "catalog");
});
// With a default catalog entry `lodash: ^4.17.21` resolved at 4.17.23 before
// and 4.17.24 after, and a new `zod` entry, this prints:
// default/lodash changed: 4.17.23 -> 4.17.24
// default/zod added: - -> 3.25.76
```

- `catalogs` holds one `CatalogChange` per catalog entry added, removed or changed: `catalog` (`"default"` for the default catalog in every format), `name`, `specifier` and `version` as `{ before, after }`, `kind`, and `consumers` — the importers that reference the entry through `catalog:`, read from the `before` lockfile for a removed entry.
- `importers` holds one `ImporterChange` per importer dependency added, removed or changed, identified by `importer` path, `name` and `depType` together. `specifier` sides are classified specifiers, as on `ImporterDependency`, so `_tag` tells a `catalog:` reference apart.
- A side that does not exist is absent, and so is a version that cannot be resolved. A record is `changed` when its specifier differs, or when its version resolves on both sides and differs; a version resolvable on one side only is not a change by itself.
- `hasChanges` is `false` exactly when both arrays are empty.

Where a resolved version lives differs by format, and the comparison normalizes it so the answer is the same for every format:

| Format | Catalog entry version | Importer dependency version |
| ------ | --------------------- | --------------------------- |
| pnpm | recorded on the entry | recorded on the importer dependency (a workspace link reads `link:<path>`) |
| bun | the one version the entry's consumers resolved to (consumers that disagree give no version); with no consumer, the package's version when the lockfile holds exactly one | read through the importer's resolved edge to its package entry |
| npm | — (npm has no catalogs) | read through the importer's resolved edge to its package entry |

A catalog bump shows in `catalogs`, and also in `importers` for each consumer whose resolved version moved; filter on `specifier.after?._tag !== "catalog"` to keep the two apart, as above.

## Features

- `Lockfile.parse(content, { format })` — the package's only fallible boundary; fails with `LockfileParseError` or `LockfileFramingError`.
- `Lockfile#withImporterNames(names)` — the pure second stage for pnpm: rewrites importer-path names and both ends of each dependency edge once the consumer has read the manifests.
- `Lockfile#packagesNamed(name)`, `Lockfile#packageByInstanceId(id)` (`Option`-answering, over a lazily built index) and `Lockfile#workspacePackages` — total lookups over the model.
- `LockfileFormat` with `filenameFor` / `fromFilename` — the format literal and its mapping to lockfile filenames.
- `LockfileIntegrity.compare(lockfile, manifests)` — total, pure integrity checking with no error channel; the report carries `valid`, `missingWorkspaces`, `extraWorkspaces` and `unsatisfiedConstraints`. Constraint checking is best-effort by design: `workspace:` / `link:` / `file:` specifiers and rows whose range does not parse as SemVer are skipped.
- `LockfileDiff.compare(before, after)` — total, pure before/after comparison: catalog entries (`CatalogChange`) and importer dependencies (`ImporterChange`) added, removed or changed, with resolved versions normalized across formats. See [Comparing two lockfiles](#comparing-two-lockfiles).
- `WorkspaceManifest` — the manifest input shape for integrity checking: a package name plus four optional dependency records. Deliberately a plain value rather than a strict manifest model, so consumers can derive it from anything.
- `ResolvedPackage` — one package *instance*: name, version, optional integrity hash, workspace flag and relative path, dependency map, the peer declarations (`peerDependencies`, `peerDependenciesMeta`), the opaque `instanceId`, the `resolved` name-to-instance map and the `unresolvedEdges` the model could not name.
- `isUnsupportedLockfileVersion` and the `UnsupportedLockfileVersion` type — the predicate that narrows a `LockfileParseError.cause` to a version-gate rejection, so "too old" and "malformed" are told apart on a tag rather than on prose.
- `WorkspaceDependency` — a `from`/`to` edge between workspace packages, with `depType` spelled in `@effected/npm`'s `DependencyField` vocabulary and its declared constraint.
- `PnpmExtension` (from `@effected/pnpm`) and `BunExtension` (from `@effected/bun`) — format-specific data such as pnpm catalogs and bun trusted dependencies, preserved on the model's optional `extension` field.

## License

[MIT](LICENSE)
