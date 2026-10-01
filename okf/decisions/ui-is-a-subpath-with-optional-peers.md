---
type: Decision
title: The Ink layer is a ./ui subpath of cli, with ink and react as optional peers
description: "Interactive screens live in @effected/cli behind ./ui and ./ui/testing, with ink and react as optional peers that the root never reaches and that ./ui itself loads only when a screen mounts; separate cli-ink and cli-ui packages were rejected."
status: draft
tags: [architecture, bundle]
sources:
  - id: cli-package-json
    resource: ../../packages/cli/package.json
    title: The cli manifest, carrying the ./ui exports and the optional peers
  - id: cli-boundary-test
    resource: ../../packages/cli/__test__/boundary.test.ts
    title: The reachability test that keeps the root off ./ui
  - id: optional-peers-revert
    resource: https://github.com/spencerbeggs/effected/issues/250
    title: "Issue 250: optional peers re-exported from a root entry broke unbundled consumers"
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T03:17:21Z
  body_sha256: 30cd2af57c947cd5a975d937fa294fc7e74a037dac74efeef954ef7b9aa0bf3c
---

# The Ink layer is a ./ui subpath of cli, with ink and react as optional peers

## Context

The interactive CLI kit needs screens: a select, a multi-select, a confirm,
a text input, tabs and a live view. They are built on Ink, which brings
React. Most programs that depend on `@effected/cli` never draw a screen, and
an agent or a CI run never should, so they must not pay for React.

The kit has learned this lesson once. A static root re-export of optional
code breaks every unbundled consumer that took the manifest at its word and
did not install the optional package.[^optional-peers-revert] An optional
peer is optional only while no shared module reaches it.

## Decision

The Ink layer lives in `@effected/cli` behind two subpaths: `./ui` for the
screens and widgets, and `./ui/testing` for the screen harness.[^cli-package-json]

- `ink` (`^7.1.1`) and `react` (`^19.2.0`) are **optional peers**. Only files
  under `src/ui.ts`, `src/ui-testing.ts` and `src/ui/**` may name them.
- **The root never reaches `./ui`**, statically or through a lazy
  `import()`. `boundary.test.ts` walks the module graph from `src/index.ts`
  and `src/testing.ts` and fails on any `src/ui*` file or any `ink` or
  `react` specifier it reaches.[^cli-boundary-test]
- **`./ui` itself loads neither `ink` nor `react` when it is imported.**
  Runtime values come only from the kit's lazy loader, which `import()`s
  both the first time a screen mounts. Kit files may `import type` from
  either package but never import a value. A consumer's flag path can import
  `@effected/cli/ui` and still not load React unless it draws a screen.
- Kit components are written with `React.createElement`, so the package
  needs no JSX and no tsconfig change. Consumers may write JSX.

## Alternatives rejected

- **A separate `@effected/cli-ink` package.** Rejected. Its consumers are
  the programs that already depend on `cli`, and its screens read `cli`'s
  services (`CliInteractive`, `CliTheme`). A second package would be a second
  peer that has to resolve to one copy of each service, for no install a
  consumer saves: an optional peer already costs nothing to a program that
  never installs it.
- **A separate `@effected/cli-ui` package.** Rejected for the same reason.
- **Static `ink` and `react` imports inside `./ui`.** Rejected. Importing
  `./ui` from a module that only sometimes draws a screen would load React on
  every run, which is the cost the subpath exists to avoid.

## Consequences

A consumer who wants screens installs `ink` and `react` beside
`@effected/cli`. One who does not pays nothing and sees no peer warning that
matters. The tier consequence is
[recorded separately](ui-tier-is-integrated-on-opt-in.md), and so is
[why the boundary is a reachability check](root-boundary-is-reachability.md).

[^optional-peers-revert]: <https://github.com/spencerbeggs/effected/issues/250>
[^cli-package-json]: `../../packages/cli/package.json`
[^cli-boundary-test]: `../../packages/cli/__test__/boundary.test.ts`
