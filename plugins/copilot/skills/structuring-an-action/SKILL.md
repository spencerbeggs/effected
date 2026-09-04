---
name: structuring-an-action
description: >-
  Use when laying out a new GitHub Action repository on the @effected suite, deciding where a
  piece of code belongs (an entry point, a step, a shared service, a shim), or reviewing an
  existing action's file structure against the canonical shape.
---

# Structuring an action

The canonical shape of a GitHub Action repository built on `@effected`: what file goes where, and why that placement is the one that survives contact with a second and third action rather than diverging from the first. Companion to `designing-an-action`, which sequences the *build*; this skill owns the *shape* the build produces. The `github-action-template` repository is a living, buildable instance of this exact shape — read it alongside this skill rather than inferring the tree from prose alone. It is authoritative for **shape only**: it pins its own `@effected/github-actions` version and will usually sit behind the one a consuming repo installs, so an agent reading it to answer "what does the kit offer" under-reports (it carries no `ManagedDocument` / `CheckDocument` usage at all). For surface, read the installed package in `node_modules`.

## The canonical tree

```text
action.yml              # single source of every input/output name AND default; code mirrors it, never re-declares it
action.config.ts         # builder entries, minify, persistLocal; escape hatches added per need with a forensic comment
lib/scripts/             # non-compilable scripts (a cache-invalidating location) + bundle-truth guards
schemas/                  # versioned output-contract documents, <version>/<name>-<version>.json; only when a JSON contract crosses the boundary
<action>.input.schema.json  # unversioned input schema at the root, only when a JSON input crosses the boundary
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
  unit/                   # mirrors src/ module for module — src/utils/ mirrors to unit/utilities/, never unit/utils/
  integration/            # *.int.test.ts + fixtures/
  utils/                  # doubles and recording adapters — helper code, NEVER tests: a directory named utils, fixtures or snapshots is skipped by discovery at ANY depth (references/tests.md)
  CLAUDE.md               # test conventions + the collection contract
vitest.config.ts          # strict thresholds; coverage scores a never-imported file at zero, never omits it
vitest.setup.ts           # strips the runner's own env vars from the test process
docs/                     # numbered user docs, incl. an optional-module chapter when one exists
.github/workflows/        # CI, release, and a self-dogfood workflow where the action runs itself
.github/actions/local/    # a committed local-build target for smoke-testing the bundle
dist/                     # committed bundles; CI rebuilds and diffs them so a stale bundle cannot merge
package.json              # a dependency enters when src imports it, closed over required peers
tsconfig.json             # extends the builder's action config and nothing else
CLAUDE.md                 # how to use this repo, plus the shim register
```

## Standards

- **Give every entry point the same guard, and nothing else.** An entry file is a program import plus one conditional call to the runtime's entry function, guarded on the runner's own marker variable — the same idiom on every entry, never a bespoke shape for one phase. This is what keeps the program importable, and therefore testable, without executing it.
- **Keep `program.ts` pure composition, and emit the output baseline first.** It emits `initialOutputs` before any work, reads inputs, runs steps in order, folds their results into outputs, emits the full set on every exit path, and reports — nothing else. The baseline goes out **up front, not from an error handler**: a handler that re-emits it on failure overwrites an output describing work that really happened. No I/O of its own, no formatting, no step bodies.
- **A step is an orchestration unit, not a service.** One module per step, each declaring its own result type, a typed error *only when the step can actually fail*, and an explicitly annotated requirement channel. **State the failure posture in the module doc, beside the error channel** — fail-the-job, degrade-to-warning or double-netted — and annotate a `never` that means "this degrades" rather than letting it be inferred, so a dependency upgrade that widens a member's channel is a build error at that line. Give that error a closed `reason` union when every reason carries the same fields, or one class per failure behind a union type alias when the reasons carry different fields or a caller needs to recover from one alone — the judgement test is in [designing-an-action](../designing-an-action/references/walking-skeleton.md), and the kit applies it to its own errors. A step used exactly once stays a step; promote it to `services/` only when a second step or a second action needs the same capability. The same rule read from the catch side: an `Effect.catch` around a step whose `E` is `never` is dead code the compiler never flags — the handler, its fallback result and its failure log line are all unreachable, and they read as coverage in review. Check the callee's declared `E` before writing a handler.
- **Start layer-less, and grow a layer only when something needs to live outside `program.ts`.** Configuration-derived services are built inside the program from already-decoded input values; a per-entry layer earns its place only for a service that must exist before inputs are decoded, or that crosses a boundary the program itself doesn't own.
- **Treat `action.yml` as the single source of input and output names and defaults.** Code mirrors those defaults; it never re-declares them independently. A three-way check — the manifest, a names-as-data tuple, and what the code actually reads or writes — is what keeps the mirror honest as the action grows; the first two legs are declarations that drift together, so the recorded-read and recorded-write legs are the ones that find anything. Write it executably: [references/tests.md](references/tests.md) shows the whole check, and the `recordingEnv` spread hazard that makes it pass while testing nothing.
- **Design every state field's encoded form as plain JSON.** State crosses a phase boundary as a file, republished as environment variables to the next process; an encoded form that isn't a JSON primitive decodes correctly nowhere, and the failure surfaces one phase later than the mistake that caused it.
- **Give the action exactly one rendering surface.** Every human-readable string — a log line, a summary panel, a report — is built by one pure, service-free module or directory, so the same fact can never be worded two different ways in two different places.
- **Let `services/` and `shims/` be conventions, not tracked empty directories.** An action that needs neither ships neither; document the convention in `src/CLAUDE.md` so the slot is discoverable without a placeholder file pretending something lives there.
- **Test every declared dependency against what `src/` actually imports, closed over required peers.** A dependency that's neither imported nor a required peer of one that is gets flagged; a required peer legitimately goes unimported and must be resolved out of that closure before anything is deleted.
- **Prove layer minimalism at compile time, from both sides.** One type-level assertion that the app layer's requirements minus the runtime's services is `never`, and a second over the *program's* requirements, because a service resolved inside a step method never appears in the layer's input channel. See [references/tests.md](references/tests.md).
- **Publish a structured output through one schema and one generator.** When a `setJson` output leaves the action, the schema that encodes it is the schema the committed JSON Schema is generated from, and the generator's own targets are what the drift test walks. `actions-inputs-outputs` owns the recipe.

## Footguns

- A test file placed in a directory named `utils`, `fixtures` or `snapshots` — at any depth — is silently skipped by project-scoped discovery and indistinguishable from a green suite; mirror `src/utils/` to `unit/utilities/`. See [references/tests.md](references/tests.md).
- A recorder composed into a provider by object spread is copied via `ownKeys` and silently discarded, so the assertion compares empty to empty and passes. Assert the recorder saw something before comparing. See [references/tests.md](references/tests.md).
- A test process that imports a guarded entry point while the runner's own marker variable is still set executes the action as an import side effect, mid-suite. See [references/tests.md](references/tests.md).
- An entry point that grows a populated default layer "just in case" invites providing services nothing in the program actually requires — start every entry layer-less and add only on genuine need. See [references/entries-and-layers.md](references/entries-and-layers.md).
- A shim with no tracking issue and no removal condition is indistinguishable from a permanent fork of kit behavior. See [references/services-and-shims.md](references/services-and-shims.md).
- An `Effect.onError` that re-emits the all-disabled output baseline blanks an output for work that actually happened; emit the baseline first instead. See [references/program-and-steps.md](references/program-and-steps.md).
- A hand-rolled `FileSystem.layerNoop` over a `Map` encodes only what its author remembered; the filesystem double is `@effected/memfs`. See [references/tests.md](references/tests.md).

## Additional resources

- [references/entries-and-layers.md](references/entries-and-layers.md) — the uniform entry guard in full, why entries start layer-less, the `makeAppLayer(value)` pattern for configuration-derived services, and layer memoization by reference. Load when: writing or reviewing an entry point, or deciding whether a capability belongs in a per-entry layer.
- [references/program-and-steps.md](references/program-and-steps.md) — `program.ts`'s pure-composition shape, the output-fold-from-all-disabled-defaults pattern, and the full step-contract shape including failure-posture selection. Load when: writing `program.ts`, or adding, reviewing, or promoting a step.
- [references/services-and-shims.md](references/services-and-shims.md) — when a capability earns a shared service, the mandatory shim header contract, and the upstream-migration protocol for code that belongs in the kit rather than in the action. Load when: a capability is needed by more than one step, or the installed kit is checked and found to genuinely lack something.
- [references/schema-state-and-format.md](references/schema-state-and-format.md) — the inputs/outputs names-as-data pattern, cross-phase state schema design and the JSON-round-trip rule, and the single-rendering-surface discipline. Load when: designing `schema/`, `state.ts`, or `format.ts`.
- [references/tests.md](references/tests.md) — the test-directory contract and how to enforce placement executably, the doubles-over-`layerTest` recording pattern, and the test-process environment rule that keeps a guarded entry point from executing mid-suite. Load when: laying out `__test__/`, writing a test double, or debugging a test that silently didn't run.
- [references/scaffolding.md](references/scaffolding.md) — the manifest and build-config shape, repository workflow scaffolding including a self-dogfood workflow, the root context file's shim register, and the dependency-honesty rule applied to a fresh scaffold. Load when: starting a new action repository, or reviewing one's non-`src` structure.
