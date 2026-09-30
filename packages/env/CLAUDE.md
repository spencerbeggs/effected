# @effected/env

Effect-native environment detection: which agent or CI is running a program,
what the terminal can do (colour level, hyperlinks, columns), and which audience
the output is for. Read once through `Config`, swapped in tests with `layerTest`.

**Design doc:** `@./okf/modules/env.md` — Load when: changing the public
surface, adding a detector, or deciding whether a capability belongs here
versus in `@effected/cli` or `@effected/engine`.

## Boundary tier — purity rules

`effect` is the only peer. **Never add an `@effected/*` or runtime
dependency.** `@effected/workspaces` is a devDependency for the `SourceBoundary`
purity test only.

- `src/` has no `process` reads, no `node:`, `@effect/platform*` or
  `@effected/*` imports, and no `console.*` or stdout writes.
  `__test__/purity.test.ts` runs a `SourceBoundary` scan that enforces exactly
  this. `node:` imports are allowed in `__test__/`.
- Nothing is read at import time. Every read happens inside a layer's
  construction Effect, through `Config`.
- House style: static classes with private constructors, or `Context.Service`
  classes carrying static `layer` and `layerTest`. No `as const` namespace
  objects.
- One module per concept; `src/index.ts` is the only re-exporting module.
  Detectors live under `src/internal/` and are not exported.

## The three oracles

Never pin this package's own output as the oracle in a test.

- Colour depth: Node's `tty.WriteStream.prototype.getColorDepth`.
- OSC 8 hyperlink support: std-osc8's own shipped test cases.
- Agent and CI detection: std-env 4.3.0's table, transcribed from source.

## Test and build

Tests live in `__test__/`, use `@effect/vitest`, assert with `assert.*` —
never `expect`.

```bash
pnpm vitest run --project @effected/env   # this package's tests, from the repo root
pnpm build --filter @effected/env         # dev + prod, from the repo root
```

Never run `node savvy.build.ts --target prod` directly: it skips
`build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` that
looks exactly like a clean gate.
