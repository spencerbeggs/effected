# Structuring tests

## The collection contract

Tests live in `unit/` (mirroring `src/` module for module) or `integration/` (as `*.int.test.ts`), and nowhere else. `utils/` holds helper code — doubles, adapters — never a `*.test.ts` file. This isn't a style preference: a test file placed somewhere a runner's own discovery doesn't look is functionally identical to a deleted test, and the two are indistinguishable from the outside — both show a suite with fewer tests than the source implies, and neither produces a red result.

Enforce this executably rather than by convention. Two mechanisms both satisfy the same contract, and which one applies depends on how the test runner discovers files:

- A config-level include glob narrow enough to name the two sanctioned locations, paired with an assertion on the collected test count so a glob that stops matching anything fails loudly instead of silently collecting nothing.
- A structural placement test: walk the test directory in a small script, and fail if any `*.test.ts` file sits outside the two sanctioned locations. This is the shape to reach for when the runner's own project-discovery mechanism doesn't expose a single root include glob to narrow.

Either way, gate a scoped test run on the reported test *count*, never the exit code — a filtered run that matches nothing typically still exits zero.

**`__test__/utils/` is precisely the directory a project-scoped discovery may never collect** — a `*.test.ts` placed there does not run, and nothing reports it. That is exactly why the contract puts *no* tests there, and it is also the trap on the tidy-up: "these helpers look like tests, let me co-locate a few cases with them" silently deletes those cases while the suite stays green. One action documented the same hazard in reverse — a proposed cleanup that would have moved four live suites into that directory, all of them vanishing without a red result.

Probed, and narrower than it is usually assumed to be: the exclusion is specific to the **top-level** `__test__/utils/`. A nested `__test__/unit/utils/` collects fine, so the canonical mirror layout works — it just cannot be rooted at `__test__/utils/`.

## The three-way check, executably

The manifest, the names-as-data tuple, and what the code actually reads or
writes must all agree, and the check that proves it is one test per direction.
It is the single highest-value artifact of an alignment pass: on one action it
immediately found an input read but never declared (so it was permanently `""`
and no workflow could ever set it), an input declared and documented but read
nowhere, and three outputs written in the wrong case against a manifest that
never declared them.

```ts
// __test__/unit/schema/manifest-sync.test.ts
import { Yaml } from "@effected/yaml";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import * as fs from "node:fs";
import { INPUT_NAMES, readInputs } from "../../../src/schema/inputs.js";
import { OUTPUT_NAMES, emitOutputs } from "../../../src/schema/outputs.js";

const manifest = Effect.runSync(Yaml.parse(fs.readFileSync("action.yml", "utf8"))) as {
 readonly inputs?: Record<string, { readonly default?: string }>;
 readonly outputs?: Record<string, unknown>;
};

const sorted = (names: Iterable<string>) => [...names].sort();

describe("action.yml is the single source", () => {
 it("declares exactly the inputs the tuple names", () => {
  assert.deepStrictEqual(sorted(Object.keys(manifest.inputs ?? {})), sorted(INPUT_NAMES));
 });

 it("declares exactly the outputs the tuple names", () => {
  assert.deepStrictEqual(sorted(Object.keys(manifest.outputs ?? {})), sorted(OUTPUT_NAMES));
 });

 // Leg three — what the code actually READS. A recorder over the provider's
 // env is the only way to observe it; a static read of the module cannot.
 it.effect("reads exactly the inputs the tuple names", () =>
  Effect.gen(function* () {
   const seen = new Set<string>();
   yield* Effect.provide(readInputs, ActionInput.layer(recordingEnv(seen, FIXTURE_ENV)));
   assert.isAbove(seen.size, 0); // see the spread hazard below — this line is load-bearing
   assert.deepStrictEqual(sorted(seen), sorted(INPUT_NAMES));
  }),
 );

 // Leg three — what the code actually WRITES, including case.
 it.effect("writes exactly the outputs the tuple names", () =>
  Effect.gen(function* () {
   const written = yield* recordEmittedOutputs(emitOutputs(ALL_DISABLED));
   assert.deepStrictEqual(sorted(written), sorted(OUTPUT_NAMES));
  }),
 );
});
```

Both third legs are the point. The first two compare two *declarations*, which
drift together the moment someone updates both and neither matches the code;
only a recorded read and a recorded write observe behavior. `github-action-template`
carries a working instance of this check — read it if the shape above needs
grounding in a real repository.

`recordingEnv` is a `Proxy` over the fixture env whose `get` trap adds the
demangled name to `seen` before answering. Which brings the hazard:

### The `recordingEnv` spread hazard fails GREEN

The natural way to compose the recorder with fixed credentials is a spread:

```ts
ActionInput.layer({ ...recordingEnv(seen), ...CREDENTIALS }) // BROKEN — silently
```

**Object spread copies via `ownKeys`.** Over a `Proxy` on an empty target that
yields nothing, so the recorder is discarded entirely, `seen` stays empty, and
the assertion compares empty to empty and **passes**. The test cannot fail, and
nothing signals it.

Two fixes, and use both: assert `seen.size > 0` **before** the comparison — one
line, and it converts the whole check from decoration into a gate — and put the
fixed values on the proxy's *target* rather than spreading around it
(`recordingEnv(seen, { ...FIXTURE_ENV, ...CREDENTIALS })`), so there is nothing
to flatten. The proxy is the non-obvious half of the technique; anything that
copies it by enumeration destroys it.

## Doubles: recording wrappers over the kit's own test layers

```ts
export const captureLogger = (lines: Array<LogLine>): Layer.Layer<never> =>
 /* install a logger that pushes every emitted line into `lines` */;

export const someServiceRecording = (recording: SomeRecording): Layer.Layer<SomeService> =>
 SomeService.layerTest({
  someMember: (arg) =>
   Effect.sync(() => {
    recording.calls.push(arg);
   }),
  // every other member keeps the kit double's die-loudly default
 });
```

The kit's own service doubles die loudly on an unstubbed member by design — a handful of named exceptions aside, the ones whose safe default is a real answer rather than a fabrication. Build a thin recorder on top rather than a whole hand-rolled double: stub exactly the members a given suite exercises, and let every other member's death prove the suite doesn't quietly depend on something it never declared.

**Record inside the effect, never eagerly at layer construction.** A recorder that pushes to its array outside an `Effect.sync`/`Effect.gen` boundary logs calls that were only *described*, not run — which produces a recording of an effect's shape rather than of what actually happened when it executed.

For a cross-phase-state double specifically, encode through the caller's own schema and store the encoded text, exactly as the real mechanism does — a round trip through a double built this way proves the schema itself survives the phase boundary, not merely that the double can echo back what it was given.

## The test-process environment

A test process is still a process, and if it happens to have the runner's own marker variables set — because it's running inside CI, say — a test that imports a guarded entry point executes the action as an import side effect, in the middle of the test run. Strip the runner's marker variable, and any input/state variables the runner would have set, once, in a global test-setup step:

```ts
// vitest.setup.ts (or the equivalent for another runner)
export function setup(): void {
 delete process.env.GITHUB_ACTIONS;
 for (const name of Object.keys(process.env)) {
  if (name.startsWith("INPUT_") || name.startsWith("STATE_")) delete process.env[name];
 }
}
```

The entry guard itself is not wrong to rely on the runner's marker variable — the ambient test environment is what's wrong, and this is the one place to fix it for the whole suite at once rather than working around it per test file. Stripping input and state variables alongside the marker keeps a test from silently reading a *host* workflow's own inputs or state when a fixture forgets to seed its own.

## What a full suite for this shape typically pins

- The three-way sync between the manifest, the names-as-data tuple, and what the code actually reads or writes — for both inputs and outputs.
- The program's log stream as the decision record: the run-context block, every `SKIPPED` line, the closing result block, and outputs emitted on every exit path including failure.
- Each step's failure posture, including the degrade path actually degrading rather than propagating.
- The cleanup entry's double net, proven by injecting both an ordinary error and a defect.
- The structural checks above: dependency honesty, harness canon (every test file actually imports the intended test framework, not merely declares it as a dependency), and test placement.

Before considering a new suite complete, mutate an edge it claims to cover and confirm the suite actually goes red.
