# Carrier verification

Three tests keep the carrier pattern honest as the package graph evolves.
Each answers a different question, and none substitutes for the others.

## 1. Manifest DAG test — with non-vacuity

Read every workspace package's `package.json` across `dependencies`,
`devDependencies`, `peerDependencies` and `optionalDependencies`; classify
every package into a layer; assert every edge points to a strictly lower
layer (or into tooling); assert no same-layer edges (a front end cannot
depend on another front end); detect cycles.

A layer-ranked variant declares the ranking as a lookup table and asserts
against it directly:

```ts
it("every workspace package has a declared rank", () => {
  const missing = graph.map((n) => n.name).filter((n) => !(n in LAYER_RANKS));
  expect(missing).toEqual([]);
});

it("every workspace edge points to a strictly lower rank", () => {
  const violations = graph.flatMap((n) =>
    n.edges.filter((e) => LAYER_RANKS[e.to] >= LAYER_RANKS[n.name]).map((e) => `${n.name} -> ${e.to} (${e.kind})`),
  );
  expect(violations).toEqual([]);
});

it("the two front ends never depend on each other", () => {
  const cli = graph.find((n) => n.name === "@vitest-agent/cli");
  const mcp = graph.find((n) => n.name === "@vitest-agent/mcp");
  expect(cli?.edges.map((e) => e.to)).not.toContain("@vitest-agent/mcp");
  expect(mcp?.edges.map((e) => e.to)).not.toContain("@vitest-agent/cli");
});
```

(<https://github.com/spencerbeggs/vitest-agent/blob/main/packages/plugin/__test__/workspace-layering.test.ts>)

That test is plain Vitest. In an Effect repo, write new tests with
`assert.*` from `@effect/vitest` (see the `effect-v4-testing` skill) and
adapt the checks rather than copying the `expect` matchers.

A second style declares the ranking as an external `layers.json` and reads
the live workspace off disk each run:

```json
{
  "layers": [
    ["@savvy-web/silk"],
    ["@savvy-web/cli", "@savvy-web/mcp", "@savvy-web/changelog"],
    ["@savvy-web/silk-effects"],
    ["@savvy-web/silk-core"]
  ],
  "tooling": ["@savvy-web/bundler", "..."],
  "harness": ["@e2e/*"]
}
```

(<https://github.com/savvy-web/systems/blob/main/e2e/workspace/layers.json>)

### Non-vacuity: prove the checker can actually fail

A DAG test that never triggers on a broken fixture is worthless — it can
pass because there is nothing wrong, or because the check itself is
silently short-circuited (an empty glob, a typo'd field name, a discovery
bug that finds zero edges). `systems`' suite adds explicit non-vacuity
controls alongside the real assertion:

```ts
// (a) every name layers.json declares must actually have been discovered on disk
const missingDeclaredNames = declaredNames.filter((name) => !discoveredNames.has(name));
expect(missingDeclaredNames).toEqual([]);

// (c) edge extraction must have actually found edges
expect(edges.length, `expected to discover workspace:* edges, found ${edges.length}`).toBeGreaterThan(0);

// (b) a handful of known load-bearing edges must be present
const loadBearingEdges = [
  "@savvy-web/silk-effects -> @savvy-web/silk-core (dependencies)",
  "@savvy-web/cli -> @savvy-web/silk-effects (dependencies)",
  "@savvy-web/silk -> @savvy-web/cli (dependencies)",
];
const missingLoadBearingEdges = loadBearingEdges.filter((label) => !edgeLabels.has(label));
expect(missingLoadBearingEdges).toEqual([]);
```

(<https://github.com/savvy-web/systems/blob/main/e2e/workspace/__test__/e2e/package-graph.e2e.test.ts>)

Plus two **positive-control fixtures** — hand-built graphs the checker must
reject, run alongside the live-workspace assertion:

```ts
it("flags exactly one offender for a hand-built sideways L3 edge", () => {
  // a fixture graph, not the live workspace — one edge points sideways
  expect(findOffenders(fixtureLayers, fixtureEdges)).toEqual(["@fixture/l3-b -> @fixture/l3-a (dependencies)"]);
});

it("detects a cycle in a hand-built fixture graph", () => {
  // a fixture graph with a genuine 3-node cycle
  expect(topoSortSucceeds(fixtureNodes, fixtureEdges)).toBe(false);
});
```

Without these, "the DAG test passes" and "the DAG test would ever fail on
a real violation" are two different claims — okfit currently has no
manifest DAG test at all, which is a gap, not merely a style difference
(see [carrier-case-studies.md](./carrier-case-studies.md)).

### The subtle back-edge to watch for

A **lower** package listing a **higher** one in `devDependencies` purely
for test fixtures breaks the layering model just as much as a production
back-edge does, and it blocks safely extracting the lower package into its
own repository later, once it needs to be. If a lower package's tests need
fixtures that live in a higher one, give the fixtures their own package
instead of reaching up for them.

## 2. Source boundary tests, per package

Scan a package's `src/` tree for the things its layer promises not to do:
`process` reads (none at all in the engine — no allowlist except a
package's own `version.ts`, which reads a bundler-injected define, not a
runtime environment variable; a narrow allowlist of `bin`/`main`/
`version`/exit-tty helpers in a CLI), platform imports leaking into core,
front ends importing each other.

```ts
const isAllowedToReadProcess = (relativePath: string): boolean => relativePath === "version.ts";

it("no file under src/ reads `process` -- exactly one allowlisted file (version.ts)", () => {
  const offenders = walk(SRC_ROOT).filter(
    (file) =>
      !isAllowedToReadProcess(relative(SRC_ROOT, file)) &&
      /\bprocess\s*\./.test(stripComments(readFileSync(file, "utf8"))),
  );
  assert.deepStrictEqual(offenders.map((file) => relative(SRC_ROOT, file)), []);
});
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/engine/__test__/boundaries.test.ts>)

**Probe it against a planted violation** before trusting it — add a
`process.env` read to a fixture file under the scanned tree and confirm the
test fails, the same discipline any regex-based static check needs, since
a broken pattern that matches nothing passes silently forever.

## 3. Packed-install e2e, across package managers

Neither of the first two tests proves a consumer *outside* the monorepo
actually gets working bins — only a real pack-and-install does. The shape:

1. Pack the carrier (and, in a workspace-isolated setup, every front end it
   depends on) to a tarball with `npm pack`.
2. Create a scratch project **outside** the workspace, one per package
   manager under test (npm, pnpm, yarn, bun), each with its own manager-
   specific override mechanism (`overrides` for npm/bun, `pnpm.overrides` /
   a `pnpm-workspace.yaml` for pnpm, a Yarn Berry resolution field) pointing
   every family package at its own tarball.
3. Run that manager's install.
4. Assert:
   - `node_modules/.bin/<tool>` and `node_modules/.bin/<tool>-mcp` exist and
     are executable;
   - `<tool> --version` exits 0 with a semver on stdout;
   - **`<tool>-mcp` answers a JSON-RPC `initialize` request on stdout, with
     completely empty stderr**, and exits 0 on stdin close.

```ts
it("vitest-agent-mcp answers a JSON-RPC initialize on stdout with empty stderr", () => {
  const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", /* ...params */ });
  const result = /* spawn the installed bin, write `${initialize}\n` to stdin, close it */;
  expect(result.stderr).toBe("");
});
```

(<https://github.com/spencerbeggs/vitest-agent/blob/main/packages/plugin/__test__/bins-packed-install.e2e.test.ts>)

Abridged from that suite, which is deliberately plain Vitest because it
tests package managers and published manifests, not Effect code. In an
Effect repo's own suite, assert with `assert.*` from `@effect/vitest` (see
`effect-v4-testing`) and keep the shape of the test, not its matchers.

The empty-stderr assertion is not incidental — it is the packed-install
proof of the MCP crash-guard contract in
[carrier-entry-contract.md](./carrier-entry-contract.md): if a static
import anywhere in the server graph throws before the guards are
registered, this is the test that catches it, because nothing else spawns
a *really installed* binary the way a plugin host does.

Gate the whole suite on the carrier's production build existing (skip, do
not fail, when it doesn't — this is an e2e proof layered on a build
artifact, not a substitute for the build) and gate each package-manager
block on that manager being present on `PATH`. Pair the cross-manager e2e
with an in-repo e2e that spawns the built bins directly from `dist/` for a
faster signal that does not depend on any package manager being installed.
