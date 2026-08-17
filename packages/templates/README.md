# @effected/templates

[![npm](https://img.shields.io/npm/v/@effected%2Ftemplates?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/templates)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Managed sections: delimited `BEGIN`/`END` blocks inside files whose surrounding content belongs to the user. A tool owns the block, the user owns everything else, and neither destroys the other — the mechanism behind a generated hook, a managed config fragment, or any file your tool and your user both need to edit.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/templates

Most "managed section" implementations put the whole algorithm inside a service that also does file IO, so the hardest logic — deciding what changed, and where a new block belongs — can only be tested by writing files to disk. This package splits the two apart. `SectionDocument` is a pure string-to-string core with no `Effect`, no IO and no runtime: parse a document, compare a declared section against what is already there, reconcile a whole set of them, render the result. `ManagedSection` is a thin service that reads a file, calls the pure core, and writes back only when the text actually changed.

Ambiguity fails typed rather than being resolved by guessing: an unterminated marker, an orphaned `END`, two overlapping sections, or the same identity declared twice are all a typed `SectionParseError` naming the line, never a silent skip that leaves a duplicate block on the next run. Line endings are a first-class invariant too — the document's dominant EOL is detected at parse and every comparison is EOL-normalized, so a CRLF file does not report drift forever.

## Install

```bash
npm install @effected/templates effect
```

```bash
pnpm add @effected/templates effect
```

Requires Node.js >=24.11.0. `effect` v4 is the only peer dependency, and the only dependency of any kind.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`FileSystem` comes from `effect` core, not from a platform package, so a consumer provides it once at the edge (`NodeFileSystem.layer` from `@effect/platform-node` on Node). `Path` is deliberately not required — this package treats every path as an opaque string handed straight to `FileSystem`.

## Quick start

Declare two sections and sync them into a file in one call. Declared order becomes file order, so `base` always precedes `tool`, however a user may have reordered the file by hand:

```ts
import { CommentStyle, ManagedSection, SectionId } from "@effected/templates";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";

const Base = SectionId.make({ key: "base", commentStyle: CommentStyle.hash });
const Tool = SectionId.make({ key: "tool", commentStyle: CommentStyle.hash });

const program = Effect.gen(function* () {
  const sections = yield* ManagedSection;
  return yield* sections.syncAll(".husky/pre-commit", [Base.section("#!/usr/bin/env sh"), Tool.section("npx tool run")]);
});

Effect.runPromise(program.pipe(Effect.provide(ManagedSection.layer), Effect.provide(NodeFileSystem.layer))).then((outcomes) =>
  console.log(outcomes.map((o) => o._tag)),
);
// example output on a fresh file: [ "Created", "Created" ]
// example output on a second, identical run: [ "Unchanged", "Unchanged" ]
```

## Features

- `SectionDocument` — the pure core: `parse` / `read` / `has` / `check` / `reconcile` / `remove` over a plain string, with no `Effect`, no IO and no runtime needed to test it.
- `ManagedSection` — the service: `read`, `readAll`, `isManaged`, `sync`, `syncAll`, `check`, `checkAll` and `remove`, each writing back only when the text changed.
- `CommentStyle` — an open set of `{prefix, suffix?}` presets (`hash`, `slash`, `semicolon`, `dash`, `html`, `block`) covering both line comments and wrapped ones like `<!-- … -->`, so a managed section can live in Markdown or HTML, not just source files.
- `SyncOutcome` / `CheckOutcome` — tagged results (`Created` / `Updated` / `Unchanged`, `Absent` / `UpToDate` / `Drifted`) that carry the sections involved rather than a diff, so a caller renders exactly the comparison it needs.
- Byte-preserving outside managed blocks: every character outside a declared section's span survives a sync, in order, including a leading BOM.
- Idempotent by construction: syncing an already-up-to-date document writes nothing and touches no mtime.

## License

[MIT](LICENSE)
