---
type: Gotcha
title: catalog:build is missing from pnpm-workspace.yaml because it is injected
description: Grepping pnpm-workspace.yaml for catalog:build finds nothing, which reads as a broken or unconfigured catalog reference rather than the configDependency-injected catalog it actually is.
status: stable
resource: ../../pnpm-workspace.yaml
stale_after: 2027-03-13T00:00:00Z
tags:
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: ede38808a928bada067da5e98d23c2f02233bc4205834916c2a9fc1333cede41
---

# catalog:build is missing from pnpm-workspace.yaml because it is injected

## What a reader sees

Every package's `devDependencies` names `typescript` as `catalog:build`.
Grepping `pnpm-workspace.yaml` for `catalog:build` — or for `build:` under
its `catalogs:` key — finds nothing.[^pnpm-workspace]

## What they wrongly conclude

That `catalog:build` is a dangling reference: a catalog name used by
packages but never declared, which looks like either an incomplete catalog
setup or a typo that should be "fixed" by adding a `build:` entry to
`pnpm-workspace.yaml`.

## What is actually true

`catalog:build` is not declared in the workspace file at all. It is
injected by the `@savvy-web/pnpm-plugin-silk` configDependency, which
supplies this and other silk-side catalogs (`catalog:silk`, `catalog:docs`)
before the workspace resolves — a pnpm configDependency runs ahead of the
workspace file and can contribute config the file itself never states. Its
absence from `pnpm-workspace.yaml` is therefore expected, not a bug to
repair by hand-adding the entry.

## The check

To see the resolved version behind `catalog:build`, read the
configDependency's materialized output rather than `pnpm-workspace.yaml` —
`node_modules/.pnpm-config/` (or the installed `@savvy-web/pnpm-plugin-silk`
package itself) reflects what the plugin actually injected. Never add a
`build:` entry to `pnpm-workspace.yaml`'s `catalogs:` block to "fix" the
grep coming up empty.

[^pnpm-workspace]: `pnpm-workspace.yaml:128` — the `configDependencies`
    block names `@savvy-web/pnpm-plugin-silk` as the injector; no
    `catalog:build` entry appears anywhere in the file's `catalogs:` key.
