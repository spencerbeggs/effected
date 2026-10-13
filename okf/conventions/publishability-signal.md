---
type: Convention
title: Read publishability from publishConfig.access, never from private
description: Every source package.json in this repo is "private" true by design; the machine-checkable signal for whether a package publishes is publishConfig.access === "public", set by the bundler's manifest transform, not the source private field.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - release
  - dx
sources:
  - id: github-actions-package
    resource: ../../packages/github-actions/package.json
  - id: pnpm-plugin-effect-package
    resource: ../../packages/pnpm-plugin-effect/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 457227d4dcda1038
---

# Read publishability from publishConfig.access, never from private

Never read a package's source `package.json` `"private": true` as
evidence that it will not publish. Every source manifest in this repo
sets `"private": true`, intentionally, on all thirty-one publishable
packages and every non-publishing workspace member alike — the field
distinguishes nothing here.[^github-actions-package] `@savvy-web/bundler`'s
`publishConfig` transform produces the actual publishable manifest at
build time from that private source manifest, and the transform's output
is what actually reaches the registry.

The machine-checkable publishability signal is `publishConfig.access ===
"public"`. A publishing package declares it directly in the source
manifest — `github-actions/package.json` carries `"publishConfig": {
"access": "public", "directory": "dist/dev/pkg", "linkDirectory": true,
"targets": { "npm": true } }`.[^github-actions-package] Any tooling that
needs to ask "does this package publish" — a catalog-membership check, a
release-scope calculation, a dependency audit — must ask the question
this way. Asking `private === false` instead classifies every package in
this workspace as unpublishable and fails open: `packages/pnpm-plugin-effect/__test__/catalog.test.ts`'s
own membership derivation, and the root `catalog:sync`/`catalog:check`
gate, both compute publishability from `publishConfig.access`, never from
`private`.[^pnpm-plugin-effect-package]

Always write and read this signal as `publishConfig.access === "public"`.
Never add logic that infers publish intent from `private`, and never
"fix" a source manifest's `"private": true` believing it blocks a
release — it does not, and never has.

[^github-actions-package]: `packages/github-actions/package.json` —
    `"private": true` at the top of the manifest alongside a
    `"publishConfig": { "access": "public", ... }` block, the shape every
    publishing package in the workspace shares.
[^pnpm-plugin-effect-package]: `packages/pnpm-plugin-effect/package.json`
    and its build (`savvy.build.ts`) — the companion package that ships
    the catalog naming every other package's next-release version; see
    [the catalog-sync CLI](../interfaces/catalog-sync-cli.md) for how
    that catalog is kept in step with what actually publishes.
