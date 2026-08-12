# Testing — @effected/github-actions

Child context file for the test doubles, the discriminating-test discipline and
the reachability walker. The rules live in the parent; this file is the detail.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

`@effect/vitest`, `it.effect`, `assert.*` — **never `expect`**. Tests in
`__test__/`. No `./testing` subpath, and none of the source package's nine
`*Test` doubles is ported as-is.

## Doubles

- **Every service ships `makeTest(overrides?)` + `layerTest(overrides?)`**, with
  unstubbed members dying loudly and naming the member. Three recorded
  exceptions, each with a stated reason: `ActionEnvironment` seeds the twelve
  `GITHUB_*` variables, `ActionLogger` defaults to silent, `DryRun` defaults to
  rehearsing (the safe direction).
- **`ActionEnvironment.makeTest`/`layerTest` take the payload as a second
  argument** (2026-08-04), serving `payload` **directly** rather than through a
  `GITHUB_EVENT_PATH` read. `layerTest` hard-provides `FileSystem.layerNoop({})`
  and `make` captures the filesystem at construction, so seeding the path through
  `overrides` sends the read to a noop filesystem — there was no route to a
  payload through the standard double, and a consuming action whose whole
  detection algorithm is a function of the payload rebuilt `makeTest` plus its own
  filesystem stub at every site. `undefined` means *not served*, so an unarranged
  payload still fails typed naming `GITHUB_EVENT_PATH`.
- **`OidcTokenIssuer.layerFor(claims)`** returns a **real decodable** unsigned JWT
  built from the same claims `claims()` reports. That is what makes the provenance
  path reachable; the source package's synthetic non-JWT made it structurally
  untestable and drew four apologetic comments from one consumer.
- **`BlobStore.layerMemory` runs the real envelope framing**, so a round trip
  through it proves metadata survives storage rather than asserting the double.

## Execute the real thing where the claim is about the real thing

- **Real IO where the claim is about the filesystem.** `ToolInstaller` runs under
  `NodeServices.layer` against real `tar`.
- **HTTP is tested through `FetchHttpClient.Fetch`**, so request construction,
  status mapping and body decoding all execute.
- **Concurrency tests need two latches, minimum.** A single-latch interleaving
  passed against a deliberately wrong save/restore implementation — save/restore
  is LIFO-correct whenever two overrides nest. The order must force one fiber to
  read while the other's state is applied and **unrestored**.
- **Release a spy on a process global with `acquireUseRelease`**, never
  `try`/`finally` inside `Effect.gen`: a failing assertion leaves through the
  error channel and leaks the spy into the next test.
- **Read `unhandledErrors`, not just the pass count.** It is what caught a
  detached spawn that reported its failure correctly and then killed the action.
- **Mutate the edges before declaring green.** The pid guard, the envelope magic,
  the `INPUT_` mangling, the `withEnv` scoping, the hex-vs-binary digest and the
  tool-cache swap all have recorded, discriminating mutants.

## What `__test__/reachability.test.ts` actually proves

It walks the **runtime import graph** of `src` — a static walk, type-only imports
skipped — with a control (the three Azure modules *do* reach Azure) and exact
edge-set assertions for the light modules: `CheckState.ts` reaches `effect` alone
(in particular **not** `@effected/github`, whose conclusion set it mirrors),
`ManagedDocument.ts` / `CheckDocument.ts` reach `@effected/templates` and no more,
`ChildEnv.ts` reaches nothing at all, and `Action.ts` reaches
`@effect/platform-node`, `effect` and `effect/unstable/http`.

**Be precise about the claim.** `@azure/storage-blob`, `@effected/markdown` and
`@effected/npm` are declared **dependencies**, so every consumer installs them and
a bundler's resolver still walks them. What the test proves is the half this
package controls: **no import edge exists** from a light module to a heavy one.
Combined with `"sideEffects": false` (asserted in the same suite) and the
module-per-file output the bundler emits, that is what lets a tree-shaking bundler
drop the heavy module from a consumer's output. It is *droppable by construction*,
not *absent by construction* — do not let the shorthand drift into the stronger
claim.

The stripper takes **line comments first, then blocks**: prose containing
`@azure/*` opens a block comment as far as a regex is concerned, so stripping
blocks first eats the imports that follow — failing in the safe direction, which
for a confinement test is the worst one. It has its own discriminating test.

## Commands

```bash
pnpm vitest run packages/github-actions --coverage.enabled=false   # from the repo root
pnpm build --filter @effected/github-actions
```

---

**Related context:** [CLAUDE.storage.md](./CLAUDE.storage.md) for why each Azure
module carries its own adapter.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
