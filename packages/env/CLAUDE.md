# @effected/env

Effect-native environment detection: which agent or CI (and which CI run) is
running a program, which terminal session it is in, what the terminal can do
(colour level, hyperlinks, columns), and which audience the output is for. Also
`ShellExports`, a strict reader and writer for shell export files. Read once through `Config`, swapped in tests with `layerTest`.

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

## The four oracles

Never pin this package's own output as the oracle in a test.

- Colour depth: Node's `tty.WriteStream.prototype.getColorDepth`.
- OSC 8 hyperlink support: std-osc8's own shipped test cases.
- Agent and CI detection: std-env 4.3.0's table, transcribed from source, **minus
  the runtime hosts** (and the rows std-env marks `ci: false`, and four hosts with
  no build-only evidence); the exclusion list and its reasons live in
  `src/internal/ci.ts`. One documented departure: `false`, `0`, `off` or `no`
  (any case) on `CI`, `CONTINUOUS_INTEGRATION` or a provider marker means NOT CI,
  where std-env reads any non-empty value as set. `JENKINS_URL` detection matches
  std-env.
- `ShellExports`: real bash. Generated maps go through bash's own `printf %q` and
  through `format`, and bash **sources** the result; the exported values must equal
  what `parseResult` returns. Only dialect-valid text is ever sourced. Run bash with
  `--norc --noprofile`, and give any `BASH_ENV` probe `</dev/null`: bash treats a
  socket stdin as the sshd heuristic and reads its rc file. Source a file written
  into the sandbox, never `/dev/stdin`: Node hands the child a socket for fd 0 on
  Linux and `open("/dev/stdin")` fails with ENXIO, so the source exports nothing.
  A file bash could not read exits 97 and fails the test; it is never a verdict.
  Source as the script's first command: an exported `PIPESTATUS` stays plain only
  when no pipeline ran before it (bash 3.2 through 5.3 alike). Special-name evidence
  needs bash >= 5 (`COMP_WORDBREAKS` is special); `SRANDOM` is special from 5.1 and
  `BASH_MONOSECONDS` / `BASH_TRAPSIG` from 5.3, and the suite asserts them plain below;
  the bash 3.2 suites (macOS `/bin/bash`) cover `parseBytesResult`'s mixed raw-byte
  `$'…'` form and skip where bash 3.2 is absent.

A posix `HOME`→`USERPROFILE` fallback was declined; `@effected/xdg`, which owns
home-directory reads, uses `USERPROFILE` only on win32.

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
