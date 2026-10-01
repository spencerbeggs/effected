---
type: Decision
title: The ui declarations reference the root's types by the package's own name
description: "The ./ui and ./ui/testing declarations import the root's types from @effected/cli (kept external with dtsExternals) instead of carrying copies, with API Extractor's resulting noise suppressed for the ui entries only and re-pinned by tests over the built declarations."
status: draft
tags: [architecture, bundle, dx]
sources:
  - id: cli-build-config
    resource: ../../packages/cli/savvy.build.ts
    title: "The cli build: dtsExternals and the scoped suppression"
  - id: cli-declarations-test
    resource: ../../packages/cli/__test__/declarations.test.ts
    title: The gates over the built declarations
  - id: cli-boundary-test
    resource: ../../packages/cli/__test__/boundary.test.ts
    title: The self-name rules
  - id: split-declarations-probe
    resource: "Consumer probe over the built dist/prod/npm/pkg/index.d.ts and ui.d.ts, run 2026-10-01 during P4 review"
    title: The probe that found the split declarations
generated:
  by: "okfit/claude-code"
  at: 2026-10-01T04:10:06Z
  body_sha256: d61b911ace21e180dc7a3e0ca049efe73187e330e192b4d811899bfcc3e66a3d
---

# The ui declarations reference the root's types by the package's own name

## Context

`@effected/cli` builds one rolled-up `.d.ts` per entrypoint. `CliUi.run`, in
`./ui`, names root types in its signature: it fails with `Cancelled` or
`NotInteractive` and requires `CliTheme`.

When `./ui` imported those types relatively, the rollup put **copies** of them
into `ui.d.ts`. `Status` has a private member, so a copy is nominally distinct
from the original. A consumer providing the root's `CliTheme` layer could not
then satisfy `CliUi.run`'s requirement: the probe failed with "Types have
separate declarations of a private property 'defs'".[^split-declarations-probe]

Re-exporting the root types from `./ui` did not help, because the copies remained.

## Decision

- **`./ui` names root types through the package's own name**, with
  `import type * as Cli from "@effected/cli"`. `./ui/testing` does the same,
  and also names `./ui`'s types through `@effected/cli/ui`. Values stay
  relative imports, so the runtime graph is unchanged.
- **The dts pass keeps those imports external.** `dtsExternals` is set to
  `["@effected/cli", "@effected/cli/ui"]`; the match is exact, so each subpath
  is listed. The emitted `ui.d.ts` imports from `@effected/cli`, and
  `ui-testing.d.ts` from `@effected/cli/ui`, instead of copying.[^cli-build-config]
- **API Extractor's resulting noise is suppressed for the ui entries only.**
  The meta pass follows the self-name back into source and reports every root
  type as a forgotten export. The suppression rule matches
  `entry point ui(?:-testing)?\.d\.ts$`, so the root entry is still checked in full.
- **Tests replace what the suppression hides:**[^cli-declarations-test]
  - a consumer compiled against the built declarations must discharge
    `CliUi.run`'s requirement with the root's `CliTheme` layer, with an
    unprovided control;
  - no top-level declaration in the built `ui.d.ts` or `ui-testing.d.ts` may be
    left unexported, since that is how a forgotten export shows up in a rollup;
  - each built entry must export exactly what its source entrypoint does, and
    import the package it keeps external. This is a content check, so a turbo
    cache replay of the build report cannot turn it red.
- **The boundary test holds the self-name rules:**[^cli-boundary-test]
  - ui files name `@effected/cli` through `import type` only;
  - a root module must not import the package's own name at all, which would
    make the root declarations import themselves;
  - the root must never reach `@effected/cli/ui`.

## Accepted cost

The meta pass also throws while harvesting per-module source locations for each
ui entry. It reports this once per ui entry as a non-fatal warning: "Could not
harvest per-module source locations", level `warn`, with no code and not
CI-fatal. So the prod build report carries one warning per ui entry, accepted as
a documented exception. The API model for the ui entries also duplicates the
root's members, with some wrong source paths. That model is generated and
gitignored, so only the website's API pages are affected.

The fix belongs upstream. The meta pass should treat the package's own name as
external when it is listed in `dtsExternals`, or model multi-entry packages so
that cross-entry types need no suppression. An issue for `@savvy-web/bundler` is
drafted and not yet filed.

## Alternatives rejected

- **Type-only re-exports of the root types from `./ui`.** Rejected: the copies
  stay nominally distinct, which is the defect itself.
- **The self-reference without `dtsExternals`.** Rejected: the rollup inlined
  the whole root into `ui.d.ts`.
- **Making the root types structurally interchangeable** by dropping private
  members. Rejected: the next private member would split them again.
- **Changing `CliUi.run` to name no root class.** Rejected: it changes the
  specified API.

[^split-declarations-probe]: Consumer probe over the built `index.d.ts` and `ui.d.ts`, 2026-10-01.
[^cli-build-config]: `../../packages/cli/savvy.build.ts`
[^cli-declarations-test]: `../../packages/cli/__test__/declarations.test.ts`
[^cli-boundary-test]: `../../packages/cli/__test__/boundary.test.ts`
