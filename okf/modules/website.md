---
type: Module
title: website
description: The RSPress docs site, publishing per-package API reference generated from each package's api-extractor model under lib/models/.
status: stable
kind: website
resource: ../../website
tags:
  - dx
sources:
  - id: website-package-json
    resource: ../../website/package.json
  - id: website-rspress-config
    resource: ../../website/rspress.config.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 7f81002bc8a682eb
---

# website

## Purpose

`website/` is the repository's RSPress docs site (npm name `docs`,
private). It builds with `rspress build`, serves a local preview with
`node lib/scripts/dev.mts` / `node lib/scripts/preview.mts`, and
typechecks with `tsc --noEmit` like every other workspace
member.[^website-package-json]

## Layout

- `docs/` — the RSPress content root (`rspress.config.ts`'s `root:
  "docs"`).
- `lib/models/` — per-package api-extractor doc models, one directory
  per `@effected` package (for example `lib/models/app`,
  `lib/models/config-file`). These are `build:prod` artifacts produced by
  each package's own build, not authored here, and are gitignored — the
  same doc models the plugin's construct-index generator reads from each
  package's `dist/prod/npm/meta/<dir>.api.json` rather than from this
  gitignored copy.
- `theme/` — the site's custom styling.

## Build

`rspress-plugin-api-extractor`'s `ApiExtractorPlugin` is configured with
`apis: ApiExtractorPlugin.apis.fromDir("./lib/models")`, so the site
renders API reference pages directly from whichever per-package model
directories exist under `lib/models/` at build time.[^website-rspress-config]
Since those models are `build:prod` artifacts of the individual
packages, a package must be built with `pnpm build --filter
@effected/<pkg>` before the website's own build will have current API
reference content for it. The site also wires `pluginSitemap` and a
mermaid diagram plugin.

## Dependencies

Devdependencies draw from `catalog:docs` (`@rspress/core`,
`@rspress/plugin-sitemap`, `@types/node`, `@types/react`,
`@types/react-dom`, `react`, `react-dom`, `mermaid`) plus a
directly-pinned `rspress-plugin-api-extractor`.[^website-package-json]

[^website-package-json]: `website/package.json` — `"name": "docs"`,
    `"private": true`, `scripts.build: "rspress build"`.
[^website-rspress-config]: `website/rspress.config.ts` — the
    `ApiExtractorPlugin` configuration reading `./lib/models`.
