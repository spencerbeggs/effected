# Carrier app layer and config schemas (optional)

A tool with no user-facing config file skips this reference entirely — it
is an optional extension of the carrier pattern (see
[carrier-package.md](./carrier-package.md)), not a required layer. Reach
for it once a tool has: a config file a user hand-edits, and/or state a
front end needs to discover the same way every time.

The rule this reference teaches is a placement rule, not a mechanics
lesson — for the JSON Schema generation and drift-gate mechanics
themselves, see `building-schemastore-schemas`. This file only covers
*where* each piece belongs and *why*, using okfit as the worked example
(the only one of the three carrier case-study repos that builds this out).

## The one-sentence rule

**Shape, version, and hosted identity live with the shape — core. Platform
discovery, config discovery, and persistence live in the engine. Front
ends only pass in process-derived inputs.**

## Core owns the config shape, therefore its version, therefore its published identity

A config file's Effect Schema, its `CONFIG_SCHEMA_VERSION`, and its
`HostedSchema` identity all belong in the same package that owns the
domain model — core — because all three answer the same question
("what does this document look like, and where does the published
version of it live?"), and answering it in three different places is how
they drift apart.

okfit's `packages/core/src/OkfitConfig.ts` declares all three together:

```ts
// The version this schema shape describes — major.minor only. Core owns
// this number because it owns the shape: an additive optional key is a
// minor bump, a removed or retyped key is a major bump.
export const CONFIG_SCHEMA_VERSION = "1.0" as const;

// Where the published `config` JSON Schema document lives and which
// version is current. `versions` derives from CONFIG_SCHEMA_VERSION
// rather than restating the number, so this host and the CLI's
// `--version` `config-schema` segment can never drift apart.
export const okfitConfigSchemaHost = HostedSchema.github({
  repo: "spencerbeggs/okfit",
  path: "schemas",
  name: "config",
  versions: [CONFIG_SCHEMA_VERSION],
  appendVersion: false,
});

// The directive `okfit init` writes ahead of a fresh config file.
export const SCHEMA_DIRECTIVE = `#:schema ${okfitConfigSchemaHost.$id}\n\n`;
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/core/src/OkfitConfig.ts>)

`HostedSchema.github`'s signature (verified against `@effected/schemastore`
in this kit — `HostedSchema.github(input: GitHubHostedSchemaInput):
HostedSchema`) takes `repo`, an optional `branch` (defaults to `main`),
`path`, `name`, `versions`, and `appendVersion`; okfit's call sets
`appendVersion: false`, which is only legal under the `"versioned"` layout
`path` implies here — every other version would otherwise share one file
name.

The document schema itself is derived from the same struct, minus wire
bookkeeping, with an **open root and closed tables**:

```ts
export const okfitConfigDocumentFields = Schema.StructWithRest(
  Schema.Struct({
    okf_version: okfitConfigFields.fields.okf_version,
    bundle: okfitConfigFields.fields.bundle,
    // ...every other declared table...
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/core/src/OkfitConfig.ts>)

`StructWithRest` here means unrecognized **top-level** keys are permitted
(a forward-compat escape hatch for a config file), while every table that
*is* declared stays closed — an unknown key inside `[lint]`, for instance,
is still a schema violation. This is a shape decision, so it belongs with
the rest of the shape, in core.

Consequence of putting all three in one place: the URL a fresh config's
`#:schema` directive points at, the `$id` of the generated JSON Schema
document, and the `config-schema` segment of a `--version` line (see
[carrier-version-threading.md](./carrier-version-threading.md)) all derive
from the same constants. They cannot independently drift, because there is
only one place to have gotten any of them wrong.

## The featured example: `schemastore.config.ts`

okfit's generator config is the concrete artifact all of the above feeds
into, and it is small enough to read in full:

```ts
/**
 * The whole schema setup for okfit: `okfitConfigDocumentFields` becomes the
 * published `config` JSON Schema document, hosted at `okfitConfigSchemaHost`
 * — the same `HostedSchema` `@okfit/engine`'s `init` reads to stamp the
 * `#:schema` directive, so the URL a fresh config points at and the one this
 * build writes can never disagree. Run via `pnpm schema:build` /
 * `pnpm schema:check`.
 */
import { defineConfig } from "@effected/schemastore";
import { okfitConfigDocumentFields, okfitConfigSchemaHost } from "../../src/OkfitConfig.js";

export default defineConfig({
  outputDir: "../../../../schemas",
  schemas: {
    [okfitConfigSchemaHost.name]: {
      schema: okfitConfigDocumentFields,
      hosted: okfitConfigSchemaHost,
      published: false,
      catalog: {
        description: "okfit config file for an Open Knowledge Format (OKF) bundle",
        fileMatch: ["okfit.toml", ".okfit.toml", "**/.config/okfit.toml"],
      },
    },
  },
});
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/core/lib/configs/schemastore.config.ts>)

The load-bearing details:

- **It imports both the schema and the `HostedSchema` from core's own
  `src/`.** `okfitConfigDocumentFields` and `okfitConfigSchemaHost` are the
  same values `OkfitConfig.ts` exports for runtime use — the generator does
  not restate the shape or re-derive the identity, it consumes exactly what
  the engine's `init` program also consumes for the `#:schema` directive.
  One pair of values, two consumers (the generator, the runtime), zero
  chances to disagree.
- **`outputDir` resolves against the config file's own directory, never
  the shell's working directory**, so `"../../../../schemas"` lands at the
  repository root.
  Verified in `@effected/schemastore-cli`'s loader: `ConfigLoader.load`
  computes `directory = path.dirname(configPath)` from wherever the config
  file was actually found, then `ConfigLoader.resolvePaths` resolves
  `outputDir` (and every other relative path in the config) against that
  directory — never against `process.cwd()`. From
  `packages/core/lib/configs/schemastore.config.ts`, four `../` segments
  walk `lib/configs` → `lib` → `core` → `packages` → the repository root, landing at `schemas/`
  there. Get this wrong and either the generator writes documents where
  nothing expects them, or (worse) it silently writes them somewhere that
  happens to still work when run from one directory and breaks the moment
  someone runs `schema:build` from a different one — resolving against the
  config file, not the invoking shell, is exactly what avoids that.
- **`published: false` until the document is catalogued.** This is also
  the *default* when the field is omitted — okfit states it explicitly
  because the intent matters here: while `published` is `false`, a schema
  contract change rewrites the current version label (`1.0`) in place.
  Once the document is catalogued (flipped to `published: true`), the same
  kind of change instead **appends** a new label (`1.1`) and the old one
  freezes — the versioning discipline the CI drift gate (`schema:check`)
  enforces either way. See `building-schemastore-schemas` for the full
  drift-gate mechanics; this reference only needs the placement fact: the
  flag is a per-schema property the *shape's owner* sets, alongside the
  shape.
- **`catalog.fileMatch` lists only the project-tier filenames** —
  `okfit.toml`, `.okfit.toml`, `**/.config/okfit.toml`, the same three
  candidates `buildConfigLayer`'s discovery resolver walks upward for (see
  below). A user- or system-tier config file (the XDG personal default, the
  `/etc` tier) is never matched by `fileMatch` at all — those files instead
  get the same identity via the `#:schema` directive the engine's `init`
  program writes into them directly, not via editor filename-pattern
  matching. `fileMatch` and the directive are two different mechanisms for
  the same goal (an editor offering schema-aware completion), applied to
  two different tiers of file.
- **It lives under `lib/configs/`, not `src/`.** This is build-time
  tooling — the script that *generates* the published document — not
  runtime code the package ships to consumers. `@effected/schemastore-cli`
  is a `devDependency` for exactly this reason: it drives `schema:build`
  and `schema:check` as package scripts, never imported by anything under
  `src/`. `@effected/schemastore` itself, by contrast, is a
  **peerDependency** on core (plus the matching `devDependency` for core's
  own tests) — the standard pure-library split (see
  [carrier-package.md](./carrier-package.md)) — because `HostedSchema` is
  read at **runtime**, from `src/OkfitConfig.ts`, to build the `#:schema`
  directive string every time `init` runs.

## Engine owns the app layer: platform + config discovery

Everything both front ends need to *find* the platform and the config file
lives in the engine, consumed wholesale — the same "front ends render, the
engine computes" split every other engine responsibility follows (see
[carrier-package.md](./carrier-package.md)).

The platform layer names the one ambient value every front end must agree
on — the XDG application namespace — in exactly one place:

```ts
export const OKFIT_APP_NAMESPACE = "okfit";

export const OkfitPlatform = Layer.mergeAll(
  Xdg.layer,
  AppDirs.layer({ namespace: OKFIT_APP_NAMESPACE }).pipe(Layer.provide(Xdg.layer)),
).pipe(Layer.provideMerge(NodeServices.layer));
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/engine/src/platform.ts>)

The engine may import `@effect/platform-node` here — only **core** stays
platform-free — but still reads no `process` itself (`NodeServices.layer`
supplies `FileSystem`/`Path`/etc. as services; nothing in this module reads
an environment variable or `process.cwd()` directly).

Config discovery is built the same way — one function, consumed by every
front end, parameterized only by what a front end had to read from the
process (an explicit `--config` path, or the discovery starting directory):

```ts
export const buildConfigLayer = (options: {
  readonly explicitConfigPath: Option.Option<string>;
  readonly discoveryCwd: string;
  readonly systemConfigDir?: string; // tests only: redirects the /etc tier
}): Layer.Layer<OkfitConfigFile, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
  Option.isSome(options.explicitConfigPath)
    ? AppConfig.layer(OkfitConfigFile, {
        filename: "config.toml",
        schema: OkfitConfig,
        codec: TomlCodec,
        strategy: MergeStrategy.firstMatch(),
        resolvers: [ConfigResolver.explicitPath(options.explicitConfigPath.value)],
        xdg: false,
      })
    : AppConfig.layer(OkfitConfigFile, {
        filename: "config.toml",
        schema: OkfitConfig,
        codec: TomlCodec,
        strategy: MergeStrategy.firstMatch(),
        resolvers: [
          ConfigResolver.upwardWalk({
            filenames: [".okfit.toml", "okfit.toml", ".config/okfit.toml"],
            cwd: options.discoveryCwd,
            name: "project",
          }),
        ],
        systemEtc: options.systemConfigDir === undefined ? true : { dir: options.systemConfigDir },
      });
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/engine/src/config/layer.ts>)

`AppConfig.layer` (verified against `@effected/app` in this kit,
`AppConfig.layer(Tag, options)`) is the one call site both branches share
— an explicit `--config` path narrows to exactly one resolver and skips
the XDG tier entirely (an explicit path means "only that path," not "also
fall back"); no `--config` walks upward from `discoveryCwd` through the
three project-tier filenames, then falls through to the XDG and native
tiers `AppConfig.layer` adds by default and the `/etc` tier the
`systemEtc` option opts into.

### `App`/`AppStore`/`AppCache` are excluded unless the tool needs persisted state

Only `AppConfig` is used here. `@effected/app`'s other three exports —
`App`, `AppStore`, `AppCache` — appear **nowhere** in okfit's engine, so no
`store.db` or `cache.db` is ever created for a tool that has no state to
persist. This is enforced, not merely stated: the engine's own boundary
test asserts it directly —

```ts
/** K-9: no file under `src/` may import these three names from `@effected/app`. */
const FORBIDDEN_APP_IMPORTS = ["App", "AppStore", "AppCache"];
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/engine/__test__/boundaries.test.ts>)

— which is the same boundary-test discipline covered in
[carrier-verification.md](./carrier-verification.md), applied to a new
invariant: *this* tool's engine gets config discovery only. Take the full
`@effected/app` (`App`/`AppStore`/`AppCache`, not just `AppConfig`) only
once a tool genuinely needs a persisted store or cache — adding them
unconditionally would give every installer a SQLite file it never asked
for.

## Front ends only pass in process-derived inputs

Nothing under the engine reads `process` for any of this. `discoveryCwd`
is **passed in** by whichever front end's `main.ts` is running — it reads
`process.cwd()` itself (or takes an explicit `--config` flag value) and
hands the *value*, not the read, down into `buildConfigLayer`. This is the
same discipline as version threading in
[carrier-version-threading.md](./carrier-version-threading.md): a
process-derived fact gets read exactly once, at the front end's own entry
point, and threaded down as a plain value from there — never re-read
inside a shared package that more than one front end depends on.

## What the other two case-study repos do

`vitest-agent` publishes a JSON Schema document of its own
(`packages/sdk/lib/configs/run-report-schema.ts`, using the same
`@effected/schemastore` `defineConfig`/`HostedSchema` pair), but for a
**report file** its reporter writes, not a user-authored config file a
person hand-edits — so it is a `HostedSchema` user, not a counterexample to
anything above, just a different artifact than this reference covers.
`systems` has no equivalent found in this survey: no `schemastore.config.ts`
or `HostedSchema` usage turned up in its source tree. Neither gap changes
the rule — this whole reference is optional, and a tool with nothing for a
human to hand-edit has no reason to build any of it.
