# Several configs, one published catalog

A monorepo often has more than one package that publishes schemas, and a
single host that serves them all: a docs site's `public/schemas/`, a Pages
branch, a CDN bucket. Each package keeps its own `schemastore.config.ts`
next to the Effect Schemas it derives from, and every config writes into
the one shared folder. This page walks through that layout end to end.

## The layout

```text
packages/
  tool/
    schemastore.config.ts        name: "tool"
    src/config-schema.ts
  plugin/
    schemastore.config.ts        name: "plugin"
    src/manifest-schema.ts
site/
  public/
    schemas/                     ← shared outputDir
      catalog.json               ← merged: every slice, sorted by url
      catalogs/                  ← shared catalogDir (the default)
        tool.json                ← tool's slice
        plugin.json              ← plugin's slice
      1.0/
        tool.json
        plugin-manifest.json
```

## The two configs

Relative paths resolve against **each config file's own directory**, so
both reach the same folder through a different number of `..` segments.

```ts
// packages/tool/schemastore.config.ts
import { defineConfig } from "@effected/schemastore";
import { ToolConfig } from "./src/config-schema.js";

export default defineConfig({
  name: "tool",
  outputDir: "../../site/public/schemas",
  baseUrl: "https://example.com/schemas",
  schemas: {
    tool: {
      schema: ToolConfig,
      versions: ["1.0"],
      appendVersion: false,
      catalog: { description: "tool configuration", fileMatch: ["tool.config.json"] },
    },
  },
});
```

```ts
// packages/plugin/schemastore.config.ts
import { defineConfig } from "@effected/schemastore";
import { PluginManifest } from "./src/manifest-schema.js";

export default defineConfig({
  name: "plugin",
  outputDir: "../../site/public/schemas",
  baseUrl: "https://example.com/schemas",
  schemas: {
    "plugin-manifest": {
      schema: PluginManifest,
      versions: ["1.0"],
      appendVersion: false,
      catalog: { description: "tool plugin manifest", fileMatch: ["tool-plugin.json"] },
    },
  },
});
```

Each package's `package.json` carries the usual pair of scripts, and the
paths above make them location-independent:

```json
{
  "scripts": {
    "schema:build": "schemastore build",
    "schema:check": "schemastore check"
  }
}
```

## The rules that make it converge

- **One `catalogDir` for everyone.** Both configs above take the default,
  `<outputDir>/catalogs`, and share an `outputDir`, so they share it. A
  config that sets `catalogDir` explicitly must name the same directory as
  every other config merging into that `catalog.json`. Sibling directories
  such as `schemas/catalogs` and `schemas/more` both merge into
  `schemas/catalog.json` from different slice sets and overwrite each
  other, and no single config can see the other directory to report it.
- **Names unique regardless of case.** `name` is the slice's file base
  name. On a case-insensitive volume (the macOS and Windows defaults)
  `docs` and `Docs` are one file, and whichever config builds last
  overwrites the other's slice. The slice line of the config whose casing
  differs from the file on disk says `claimed … by case-folded match`
  (`caseFoldedMatch` in JSON); the config matching the file exactly
  reports nothing, and nothing blocks either build.
- **Schema keys unique across configs.** Each key derives a document path
  and a catalog url under the shared `outputDir`. Two configs keying a
  schema `config` write one document file, each build overwriting the
  other's. When both declare a `catalog`, the shared url blocks the merge
  (`CatalogMergeError`). Without one, when the two configs generate
  different documents for that key, each config's `check` goes red after
  the other builds; identical documents stay current.
- **Build order does not matter.** The merged file is the union of every
  slice on disk, with the running config's slice replaced by the entries it
  computes now, so whichever config builds last writes the identical file.
  After each config has built once, `check` is green for all of them.
- **Prefer serial builds against one `catalogDir`.** Each build reads the
  other slices, then writes the merged file, so two builds that overlap
  exactly can each miss the other's fresh slice. The window is small in
  practice, and the result is never silent: `check` reports the merged
  file stale, and any one build repairs it. Where builds run in parallel
  (turbo's default), a `schema:check` after them catches it. `check` only
  reads, so it is always safe to run in parallel.

## What each run reports

A clean `check` from `packages/tool` prints the tool's own documents, its
slice, and the merged file with where its entries came from:

```text
unchanged …/public/schemas/1.0/tool.json [policy semantic]
unchanged catalog slice …/public/schemas/catalogs/tool.json (1 entries)
unchanged catalog …/public/schemas/catalog.json (2 entries from 2 slice(s))
```

`--format=json` carries the same as `catalog: { slice, merged }`, where
`merged.slices` names every slice file that contributed.

## Removing a config, or its catalog

- **A config drops its last `catalog` block.** Its slice stays on disk, and
  the merged catalog keeps advertising those entries. That config's `check`
  fails (exit `1`) on `orphaned catalog slice …`, while every other
  config's `check` stays green, because the file they merge is still
  consistent. Delete the slice by hand. Every `check` then reports the
  merged file stale until any one config rebuilds it.
- **A whole config is deleted.** Nothing runs for it anymore, so nothing
  reports its slice. Delete `catalogs/<name>.json` in the same change, or
  the merged catalog keeps advertising the schemas indefinitely.
- **A config is renamed.** The old slice is now another config's slice
  advertising the same urls. The next build is blocked with
  `CatalogMergeError` (the url appears in two slices) until the old file is
  deleted. On a case-insensitive volume a case-only rename is the
  exception: the volume resolves the new name to the old file, so it is
  claimed, and its slice line says `claimed … by case-folded match`
  (`caseFoldedMatch` in JSON).

## When the merge is blocked

`CATALOG BLOCKED <path>` (exit `1`, in both `build` and `check`) lists
each problem under it:

- **A url advertised by two slices.** Usually a rename leftover or a
  schema moved between packages without deleting the old slice entry.
- **An invalid slice.** The reason names the failure: `not JSON`,
  `Expected array`, `Expected string at [0]["name"]`, one
  `Expected no excess property at …` per unexpected key, or
  `unreadable: …`. Slices are generated files, so the fix is to delete
  the bad one and rebuild the config that owns it.

The config's own documents and slice are still written on a blocked
`build`; only the merged file waits.
