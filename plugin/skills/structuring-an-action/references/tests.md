# Structuring tests

## The collection contract

Tests live in `unit/` (mirroring `src/` module for module) or `integration/` (as `*.int.test.ts`), and nowhere else. `utils/` holds helper code — doubles, adapters — never a `*.test.ts` file. This isn't a style preference: a test file placed somewhere a runner's own discovery doesn't look is functionally identical to a deleted test, and the two are indistinguishable from the outside — both show a suite with fewer tests than the source implies, and neither produces a red result.

Enforce this executably rather than by convention. Two mechanisms both satisfy the same contract, and which one applies depends on how the test runner discovers files:

- A config-level include glob narrow enough to name the two sanctioned locations, paired with an assertion on the collected test count so a glob that stops matching anything fails loudly instead of silently collecting nothing.
- A structural placement test: walk the test directory in a small script, and fail if any `*.test.ts` file sits outside the two sanctioned locations. This is the shape to reach for when the runner's own project-discovery mechanism doesn't expose a single root include glob to narrow.

Either way, gate a scoped test run on the reported test *count*, never the exit code — a filtered run that matches nothing typically still exits zero.

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
