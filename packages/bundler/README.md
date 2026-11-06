# @effected/bundler

[![npm](https://img.shields.io/npm/v/@effected%2Fbundler?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/bundler)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)

The build pipeline of the `@effected/*` kit as a library. Give it a package directory and a decoded `effected.toml`, and it writes what a release packs: per-module JS and rolled-up declarations through tsdown, the publishable `package.json`, an API Extractor model with its `tsdoctor.json` manifest, an optional single-executable binary, and a structured `issues.json`.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, built on stable
> Effect v4 and still in `0.x` development. Pin an exact version: even a package
> marked *stable* before `1.0.0` can introduce a breaking change by accident, and
> an exact pin turns that into a type-check error rather than a runtime surprise.
> Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Install

```bash
pnpm add @effected/bundler effect typescript
```

Requires Node.js >=24.11.0. `effect` and `typescript` are peer dependencies. To generate an Open Graph image, also install the optional peers `satori` and `@resvg/resvg-js`. All `@effected/*` packages are ESM-only.

## Quick start

```ts
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Bundler, EffectedConfigFile } from "@effected/bundler";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";

const platform = Layer.merge(NodeFileSystem.layer, NodePath.layer);
const discovery = WorkspaceDiscovery.layer().pipe(
  Layer.provideMerge(WorkspaceRoot.layer),
  Layer.provideMerge(platform),
);

const program = Effect.gen(function* () {
  const cwd = process.cwd();
  const { config } = yield* EffectedConfigFile.load({ cwd });
  const result = yield* Bundler.build({
    cwd,
    config: config.package?.build ?? (yield* Effect.die("no package table")),
    tsdoctor: config.package?.tsdoctor,
    noExe: false,
    verbose: false,
    plugins: [],
    ci: Boolean(process.env.CI),
  });
  return result.issuesPath;
});

Effect.runPromise(program.pipe(Effect.provide(discovery))).then(console.log);
```

## What it writes

All under the package:

| Path | What it is |
| --- | --- |
| `dist/prod/<group>/pkg` | the directory to publish, one per publish target group |
| `dist/prod/<group>/meta` | the `.api.json` model, `package.json`, a portable `tsconfig.json`, `tsdoctor.json` and any Open Graph image |
| `dist/prod/targets.json` | which target publishes which group |
| `dist/prod/issues.json` | every diagnostic, and whether the build finished |

Gate on `issues.json`'s `buildOk` first, never on an empty `errors` list: the file is written on failure too, and a crash can leave every bucket empty.

## Failures

`Bundler.build` fails with one of two typed errors, and writes `issues.json` stamped `buildOk: false` before either:

- `ConfigValidationError`: the config cannot describe a build. Nothing was built.
- `BundlerError`: something failed during the build. Its `phase` names where (`validate`, `js`, `dts`, `meta`, `exe` or `manifest`) and its `report` carries what the build had recorded, so you can still render it.

The module writes nothing to stdout. Rendering the report is the caller's.

## Limits

- `cwd` must be an absolute path.
- `bundledPackages` cannot name a workspace sibling that resolves to its TypeScript source: the build fails, because the declaration generator covers only the package's own project.
- API Extractor reporting `ae-wrong-input-file-type` about a file outside the package, as it does for a sibling resolved to source, is recorded as suppressed. About a file inside the package, it stays a warning.

## License

[MIT](./LICENSE)
