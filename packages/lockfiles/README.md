# @effected/lockfiles

[![npm](https://img.shields.io/npm/v/@effected%2Flockfiles?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/lockfiles)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Lockfile parsing for [Effect](https://effect.website) v4: bun (`bun.lock`), npm (`package-lock.json` v2/v3), pnpm (`pnpm-lock.yaml`) and yarn Berry (`yarn.lock`) all normalized into one `Lockfile` schema model, plus pure integrity checking of that model against workspace manifests. Four formats, one model, no IO and no external runtime dependencies.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/lockfiles

Every package manager writes its lockfile in a different dialect — JSONC for bun, JSON for npm, YAML for pnpm and yarn — and each encodes packages, workspace edges and integrity data differently. Tooling that wants to answer "which version of `typescript` is resolved here" ends up with four code paths and four sets of bugs. This package normalizes all four into one model, so the question is asked once regardless of which package manager produced the file.

Every entrypoint takes content as a **string**. The package performs no IO at all: reading files, finding workspace roots and detecting which package manager a repo uses belong to its consumers, and keeping them out means the parser is a pure function you can drive from a fixture, a network response or a git blob. Malformed input always exits through a typed error channel, never as a defect, and the two ways a lockfile can be unusable are distinct tags rather than one blurry `reason` string. Yarn support is Berry only, and that is enforced: classic v1 content fails typed instead of being mis-normalized into something that looks plausible.

## Install

```bash
npm install @effected/lockfiles @effected/jsonc @effected/semver @effected/yaml effect
```

```bash
pnpm add @effected/lockfiles @effected/jsonc @effected/semver @effected/yaml effect
```

Requires Node.js >=24.11.0. `effect` v4, `@effected/jsonc`, `@effected/semver` and `@effected/yaml` are peer dependencies — the JSONC and YAML engines and the SemVer range checker all arrive through those siblings, so nothing outside `effect` and `@effected/*` reaches your tree. Package managers that install peers automatically will pull them in; add them to your manifest explicitly if yours does not.

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
| `"npm"` | `package-lock.json` | JSON | v2 and v3 |
| `"pnpm"` | `pnpm-lock.yaml` | YAML | Catalogs preserved on `PnpmExtension`; see below |
| `"yarn"` | `yarn.lock` | YAML | Berry only — classic v1 fails typed |

## Errors

`Lockfile.parse` is the only fallible entrypoint, and it fails two ways.

| Tag | Means | Fields |
| --- | ----- | ------ |
| `LockfileParseError` | The content is not a valid lockfile of that format. | `format`, `stage` (`"syntax"` when the text itself did not parse, `"validation"` when it parsed but did not have the expected shape), `cause` (structural, never stringified) |
| `LockfileFramingError` | The text parsed, but no single lockfile document could be located in it. | `format`, `documents`, `reason` (`"noLockfileDocument"`, `"noImporters"`, `"unexpectedDocuments"`) |

The framing error exists because `pnpm-lock.yaml` is a YAML **stream**, not a YAML document. pnpm 11 writes a config-dependencies preamble ahead of the lockfile whenever a workspace uses `configDependencies`, so the file carries two documents — and the preamble declares `lockfileVersion`, `importers` and `packages` too, so a parser that reads only the first document gets a lockfile that *validates* and describes an empty workspace. That is a wrong answer shaped exactly like a right one. The rule here is positional and deterministic rather than a heuristic: pnpm composes the preamble as a prefix, so the lockfile is the **last** document. A stream carrying no lockfile document fails typed. It never degrades into an empty `Lockfile`.

yarn defines no document framing at all, so multi-document `yarn.lock` content fails with `"unexpectedDocuments"` rather than being silently truncated to its first document. Where a format states no rule, this package refuses to guess.

## Features

- `Lockfile.parse(content, { format })` — the package's only fallible boundary; fails with `LockfileParseError` or `LockfileFramingError`.
- `Lockfile#withImporterNames(names)` — the pure second stage for pnpm: rewrites importer-path names and both ends of each dependency edge once the consumer has read the manifests.
- `Lockfile#packagesNamed(name)` and `Lockfile#workspacePackages` — total lookups over the model.
- `LockfileFormat` with `filenameFor` / `fromFilename` — the format literal and its mapping to lockfile filenames.
- `LockfileIntegrity.compare(lockfile, manifests)` — total, pure integrity checking with no error channel; the report carries `valid`, `missingWorkspaces`, `extraWorkspaces` and `unsatisfiedConstraints`. Constraint checking is best-effort by design: `workspace:` / `link:` / `file:` specifiers and rows whose range does not parse as SemVer are skipped.
- `WorkspaceManifest` — the manifest input shape for integrity checking: a package name plus four optional dependency records. Deliberately a plain value rather than a strict manifest model, so consumers can derive it from anything.
- `ResolvedPackage` — name, version, optional integrity hash, workspace flag and relative path, dependency map.
- `WorkspaceDependency` and `DependencyType` — a `from`/`to` edge between workspace packages with its dependency type and constraint.
- `PnpmExtension` and `BunExtension` — format-specific data such as pnpm catalogs and bun trusted dependencies, preserved on the model's optional `extension` field.

## License

[MIT](LICENSE)
