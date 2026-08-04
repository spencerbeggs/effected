---
name: structuring-an-action
description: Use when laying out a new GitHub Action repository on the @effected suite, deciding where a piece of code belongs (an entry point, a step, a shared service, a shim), or reviewing an existing action's file structure against the canonical shape.
when_to_use: action repo structure, src layout, where does this code go, steps vs services, program.ts, layers/app.ts, test placement, uncollected test file, vitest.setup, action.yml single source, scaffolding a new action, dependency honesty, shim register
---

# Structuring an action

The canonical shape of a GitHub Action repository built on `@effected`: what file goes where, and why that placement is the one that survives contact with a second and third action rather than diverging from the first. Companion to `designing-an-action`, which sequences the *build*; this skill owns the *shape* the build produces. The `github-action-template` repository is a living, buildable instance of this exact shape — read it alongside this skill rather than inferring the tree from prose alone.

## The canonical tree

```text
action.yml              # single source of every input/output name AND default; code mirrors it, never re-declares it
action.config.ts         # builder entries, minify, persistLocal; escape hatches added per need with a forensic comment
lib/scripts/             # non-compilable scripts (a cache-invalidating location) + bundle-truth guards
src/
  pre.ts                 # optional — only when the lifecycle needs it
  main.ts                # thin: program import + the uniform entry guard, nothing else
  post.ts                # cleanup; double-netted so it never fails the workflow
  program.ts             # pure composition: read inputs -> steps in order -> output fold -> report
  steps/                 # one module per orchestration unit
  services/              # convention, not a tracked empty directory: shared Context.Service classes
  shims/                 # convention, not a tracked empty directory: blessed local shims
  layers/app.ts          # per-entry layers, only when something must be provided outside program.ts
  schema/
    inputs.ts             # NAMES tuple + a decoded-once readInputs
    outputs.ts             # NAMES tuple + the all-disabled-defaults fold
    domain.ts              # domain schemas as needed
  state.ts                # cross-phase state as Schema.Class bundles, JSON-safe encoded forms
  format.ts | format/     # the one rendering surface for every human-readable string
  CLAUDE.md               # src conventions, kept current
__test__/
  unit/                   # mirrors src/ module for module
  integration/            # *.int.test.ts + fixtures/
  utils/                  # doubles and recording adapters — helper code, never tests
  CLAUDE.md               # test conventions + the collection contract
vitest.config.ts          # strict thresholds; coverage scores a never-imported file at zero, never omits it
vitest.setup.ts           # strips the runner's own env vars from the test process
docs/                     # numbered user docs, incl. an optional-module chapter when one exists
.github/workflows/        # CI, release, and a self-dogfood workflow where the action runs itself
.github/actions/local/    # a committed local-build target for smoke-testing the bundle
CLAUDE.md                 # how to use this repo, plus the shim register
```

## Standards

- **Give every entry point the same guard, and nothing else.** An entry file is a program import plus one conditional call to the runtime's entry function, guarded on the runner's own marker variable — the same idiom on every entry, never a bespoke shape for one phase. This is what keeps the program importable, and therefore testable, without executing it.
- **Keep `program.ts` pure composition.** It reads inputs, runs steps in order, folds their results into outputs, and reports — nothing else. No I/O of its own, no formatting, no step bodies; a step's logic lives in `steps/`, a rendered string lives in `format.ts`, and `program.ts` only joins them.
- **A step is an orchestration unit, not a service.** One module per step, each declaring its own result type, a tagged error with a closed reason union *only when the step can actually fail*, and an explicitly annotated requirement channel. A step used exactly once stays a step; promote it to `services/` only when a second step or a second action needs the same capability.
- **Start layer-less, and grow a layer only when something needs to live outside `program.ts`.** Configuration-derived services are built inside the program from already-decoded input values; a per-entry layer earns its place only for a service that must exist before inputs are decoded, or that crosses a boundary the program itself doesn't own.
- **Treat `action.yml` as the single source of input and output names and defaults.** Code mirrors those defaults; it never re-declares them independently. A three-way check — the manifest, a names-as-data tuple, and what the code actually reads or writes — is what keeps the mirror honest as the action grows.
- **Design every state field's encoded form as plain JSON.** State crosses a phase boundary as a file, republished as environment variables to the next process; an encoded form that isn't a JSON primitive decodes correctly nowhere, and the failure surfaces one phase later than the mistake that caused it.
- **Give the action exactly one rendering surface.** Every human-readable string — a log line, a summary panel, a report — is built by one pure, service-free module or directory, so the same fact can never be worded two different ways in two different places.
- **Let `services/` and `shims/` be conventions, not tracked empty directories.** An action that needs neither ships neither; document the convention in `src/CLAUDE.md` so the slot is discoverable without a placeholder file pretending something lives there.
- **Test every declared dependency against what `src/` actually imports, closed over required peers.** A dependency that's neither imported nor a required peer of one that is gets flagged; a required peer legitimately goes unimported and must be resolved out of that closure before anything is deleted.

## Footguns

- A test file placed outside the two collected test locations can be silently skipped by project-scoped test discovery — indistinguishable from a green suite unless placement itself is asserted. See [references/tests.md](references/tests.md).
- A test process that imports a guarded entry point while the runner's own marker variable is still set executes the action as an import side effect, mid-suite. See [references/tests.md](references/tests.md).
- An entry point that grows a populated default layer "just in case" invites providing services nothing in the program actually requires — start every entry layer-less and add only on genuine need. See [references/entries-and-layers.md](references/entries-and-layers.md).
- A shim with no tracking issue and no removal condition is indistinguishable from a permanent fork of kit behavior. See [references/services-and-shims.md](references/services-and-shims.md).

## Additional resources

- [references/entries-and-layers.md](references/entries-and-layers.md) — the uniform entry guard in full, why entries start layer-less, the `makeAppLayer(value)` pattern for configuration-derived services, and layer memoization by reference. Load when: writing or reviewing an entry point, or deciding whether a capability belongs in a per-entry layer.
- [references/program-and-steps.md](references/program-and-steps.md) — `program.ts`'s pure-composition shape, the output-fold-from-all-disabled-defaults pattern, and the full step-contract shape including failure-posture selection. Load when: writing `program.ts`, or adding, reviewing, or promoting a step.
- [references/services-and-shims.md](references/services-and-shims.md) — when a capability earns a shared service, the mandatory shim header contract, and the upstream-migration protocol for code that belongs in the kit rather than in the action. Load when: a capability is needed by more than one step, or the installed kit is checked and found to genuinely lack something.
- [references/schema-state-and-format.md](references/schema-state-and-format.md) — the inputs/outputs names-as-data pattern, cross-phase state schema design and the JSON-round-trip rule, and the single-rendering-surface discipline. Load when: designing `schema/`, `state.ts`, or `format.ts`.
- [references/tests.md](references/tests.md) — the test-directory contract and how to enforce placement executably, the doubles-over-`layerTest` recording pattern, and the test-process environment rule that keeps a guarded entry point from executing mid-suite. Load when: laying out `__test__/`, writing a test double, or debugging a test that silently didn't run.
- [references/scaffolding.md](references/scaffolding.md) — the manifest and build-config shape, repository workflow scaffolding including a self-dogfood workflow, the root context file's shim register, and the dependency-honesty rule applied to a fresh scaffold. Load when: starting a new action repository, or reviewing one's non-`src` structure.
