---
type: Gotcha
title: The root tsconfig's skipLibCheck override exists only to work around one vitest .d.ts
description: The root tsconfig.json sets skipLibCheck true against the silk preset's own default of false, solely because vitest@5.0.0 ships a declaration file that fails to typecheck on its own.
status: stable
resource: ../../tsconfig.json
stale_after: 2027-03-13T00:00:00Z
tags:
  - compat
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 07452ac0e629cf14
---

# The root tsconfig's skipLibCheck override exists only to work around one vitest .d.ts

## What a reader sees

The root `tsconfig.json` sets `compilerOptions.skipLibCheck: true` even
though it extends `@savvy-web/silk/tsconfig/node/root.json`, and the silk
preset itself sets no `skipLibCheck` at all.[^tsconfig] A reader auditing
overrides for ones that can be dropped might read this one as leftover
scaffolding worth removing to match the preset's own default.

## What they wrongly conclude

That the override is redundant, incidental, or safe to delete as part of
tidying up deviations from the shared preset.

## What is actually true

Removing it breaks every commit in the repository. With `skipLibCheck`
unset, it defaults to `false`, and the root program then typechecks every
dependency's shipped declaration files as part of `tsc --noEmit` — which is
exactly what the pre-commit hook runs. `vitest@5.0.0` ships a broken
declaration file: `dist/chunks/plugin.d.ts` imports `MarkOptions` from
`vitest/browser`, and `dist/browser.d.ts` does not export it. That import
was, at the time this was diagnosed, the **only** error in the entire root
program — meaning the override is not defending against a class of
problems, it is defending against exactly one third-party file, and its
absence fails `tsc --noEmit` on every single commit in the repository
regardless of what the commit itself touches.

## The check

Leave `skipLibCheck: true` in place until vitest ships a `vitest/browser`
export that satisfies `dist/chunks/plugin.d.ts`'s import — at that point the
override can be dropped, and the drop should be validated by running
`tsc --noEmit` against the root program with the override removed and
confirming zero errors, not just by checking vitest's changelog. Per-package
`types:check` runs are unaffected either way, since it is only the root
program's dependency-declaration check that this override is silencing.

[^tsconfig]: `tsconfig.json` — `compilerOptions.skipLibCheck: true` against
    `@savvy-web/silk/tsconfig/node/root.json`.
