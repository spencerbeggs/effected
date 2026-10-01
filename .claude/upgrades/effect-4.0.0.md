# Upgrade this project to Effect 4.0.0 and the matching @effected kit

You are upgrading this repository to stable Effect `4.0.0`, from Effect `4.0.0-rc.118` or an earlier release candidate. You are also moving to the `@effected/*` kit release built on it. That kit release also ships the interactive CLI kit: the new `@effected/env` and `@effected/github-commands` packages and the `@effected/cli` presentation layer.

Work through the steps in order, and do not skip the verification at the end. Check every API claim against the vendored source or the installed `effect`, never from memory.

## What is different this time

Effect v4 is stable, so the kit no longer pins `effect` exactly:

- **Caret peers.** Every `@effected/*` package now peers `effect` as `^4.0.0`, and the `@effected/pnpm-plugin-effect` catalogs give `effect` and every `@effect/*` package `^4.0.0`.
- **The lockfile holds the exact version.** The version you build against is the lockfile's resolution, not the catalog literal.
- **One shared version.** Effect releases `effect` and every `@effect/*` package together at one version. Keep them all on the same `4.x`.
- **Stability tags.** Effect marks some APIs `@stability unstable`; those may change in a minor Effect release. Much of `effect/cli`, `effect/process`, `effect/ai`, `effect/http`, `effect/rpc` and `effect/sql` carries the tag. Untagged APIs follow semver.

## 1. Repin the vendored Effect source first

If this repository vendors Effect source (usually `.repos/effect`), repin it before you touch code. It is the authority on what v4 exports, and it must agree with the installed version:

```bash
savvy repos pin effect effect@4.0.0
```

Or use the `repos_manage` MCP tool with `action: "pin"`, `name: "effect"`, `ref: "effect@4.0.0"`. Review any `staleNoteIds` it reports. Commit the pin together with the version bump in step 2, never separately. Never write under `.repos/` by hand.

From now on, re-pin whenever the **lockfile's** `effect` moves to a new `4.x`, not only when you edit a catalog. If the project does not vendor Effect, skip this step.

## 2. Move the dependency ranges

- **Effect packages:** every `effect` and `@effect/*` dependency goes to `^4.0.0`, and resolves to `4.0.0` or a later `4.x` that is the same for all of them. If the ranges come from a pnpm catalog, update the catalog. `@effect/tsgo` versions on its own line; take the version the catalog names.
- **Catalog plugin:** if the project gets its catalogs from `@effected/pnpm-plugin-effect` through `configDependencies`, bump it to the kit release built on `4.0.0`.
  - That release's catalog names each `@effected` package at its next minor, and adds `@effected/env` and `@effected/github-commands` at `^0.1.0`.
  - Bump version and integrity together: `pnpm view @effected/pnpm-plugin-effect@<version> dist.integrity`.
  - pnpm 12 refuses a `file:` or tarball config dependency, so it can't be linked locally.
- **Direct `@effected/*` ranges:** hand-bump any that don't come from `catalog:effected`. On `0.x`, a caret pins the minor, so `^0.30.0` does not accept `0.31.0`.
- **Release-age gates:** a fresh release is refused by pnpm's `minimumReleaseAge` and yarn berry's `npmMinimalAgeGate` until it's old enough. If an install is refused, add `effect` and `@effect/*` to `minimumReleaseAgeExclude` (pnpm), or wait out the gate.
- **Reinstall from scratch:** run `pnpm clean --lockfile && pnpm install` (or delete the lockfile and install). A plain install keeps the old resolved versions.
- **Check the lockfile diff:**
  - Make sure platform binaries (turbo, biome, tsgo) were not dropped.
  - Make sure no kit package or importer of yours resolves against a release candidate. `grep -n "4.0.0-rc" pnpm-lock.yaml` may only show entries under tools still built on a release candidate.

**Tooling still built on a release candidate.** Dev tools that depend on `effect` `4.0.0-rc.*` themselves keep their own copy, and that is expected.

- **Don't force them onto `4.0.0`.** A global `overrides` entry for `effect` moves those tools onto a version they were not built for.
- **Their `platform-node-shared` pin.** Each tool needs `@effect/platform-node-shared` pinned under its own `@effect/platform-node` parent, or a fresh resolve pairs it with the stable `4.0.0` shared package, which is built for a different `effect`. `@effected/pnpm-plugin-effect` applies both pins for you. Without the plugin, add the scoped overrides yourself:

  ```yaml
  overrides:
    "@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared": 4.0.0-rc.117
    "@effect/platform-node@4.0.0-rc.118>@effect/platform-node-shared": 4.0.0-rc.118
  ```

- **Keep their old kit copies out of the new kit's peers.** Those tools install previous `@effected/*` versions at the workspace root, and pnpm can use them to satisfy the new kit's peers. Set `resolvePeersFromWorkspaceRoot: false`. Then declare in each package the `@effected/*` peers the kit packages you use expect (step 5). `pnpm peers check` should come back clean.

## 3. Find the Effect 4.0.0 changes in your code

None of these is a rename a regex can make safely. Find the call sites, then fix each one against the vendored source:

```bash
git grep -nE '\b(Array|Arr|Chunk|Effect|Record)\.(partition|separate)\b|\.partitionMap\b|Schema\.(brand|fromBrand)\b|verifyLosslessTransformation|\.takers\b|ExitEncoded'
```

- **`partition` returns `[successes, failures]`.** This covers `Array`, `Chunk`, `Effect` and `Record` `partition`, their `separate` helpers and `Option.partitionMap`; the old order was `[failures, successes]`. **This one is silent:** where both sides share a type, the reversed destructuring still compiles and simply swaps your data. Fix every call site, and check the tests that cover each. `Stream.partition` is unchanged (`[passes, fails]`).
- **`Schema.brand` takes one concrete identifier,** and is type-only.
  - To carry several brands, apply `brand` once per identifier.
  - The identifier is not stored on the AST, and `SchemaRepresentation` drops it. Reapply `brand` after rebuilding a schema from a representation if you need the nominal type.
  - `Schema.fromBrand` uses the constructor's sole brand key.
- **`TestSchema`.** Its round-trip assertion is `verifyRoundTrip`. The Effect forms `succeedEffect`, `failEffect` and `verifyRoundTripEffect` use the calling fiber's services and `TestClock`. The module is `@stability unstable`.
- **Less common:**
  - `Queue.State.takers` holds `Queue.Taker` entries; call `entry.resume(...)`.
  - `Effect.race*` now interrupts losers that are still starting.
  - An `RpcMessage.ExitEncoded` interrupt `fiberId` may be `null`.
  - Server WebSockets close with 1000, 1001 or 1011 by outcome.
  - A missed pong now fails in-flight RPC calls.

Update code samples and prose in READMEs, docs and agent context files to match, and leave CHANGELOGs alone. Re-check any `file:line` citation into `.repos/effect` against the repinned tree, because line numbers moved.

## 4. Adopt the kit's breaking changes

Skip any part for a package you do not use.

**`@effected/cli`** is now the presentation layer of an `effect/cli` program.

- **New peers.**
  - `@effected/env`, `@effected/walker` and `@effected/glob` are required peers. Declare them beside `@effected/cli`: as regular dependencies in a bin or tool, as peers in a library.
  - `ink`, `react` and `@types/react` are optional peers, needed only for `@effected/cli/ui`.
- **Colour follows Node.**
  - `FORCE_COLOR` now beats `NO_COLOR`, and `FORCE_COLOR=0` forces colour off.
  - `NODE_DISABLE_COLORS` and `TERM=dumb` turn colour off.
  - A test harness that checks for escape-free output without a terminal should pin `FORCE_COLOR=0`, since a `FORCE_COLOR` inherited from CI now colours the output.
- **The default failure report is a document.** Without a `render` option, failures print a status line (`✗ Error: boom`, or `[FAIL] Error: boom`) plus a cleaned stack, not `String(error)`.
  - Tests asserting the exact line `Error: boom` need updating.
  - A hand-built `FailureDetails` literal must now supply `defaultLines` and `lines({ status? })`.
- **Log text is sanitised.** `CliLogger` removes escapes and control characters, and turns a tab into a space. Under GitHub Actions it neutralizes workflow commands. Snapshots of log output may change bytes.
- **`CliRuntime.main` builds the platform layer under the logger,** so log lines written while building go to stderr.

**`@effected/github-actions`:** `ActionLogger` neutralizes plain log text. A program that deliberately wrote a workflow command through `Effect.logInfo("::…")` must use the service's own methods instead: `group`, `notice`, annotations, `setFailed`, `setSecret`. `WorkflowCommand` now lives in `@effected/github-commands`, and is still re-exported.

**Full peer closure.** `@effected/app`, `xdg`, `config-file`, `tsconfig-json` and `schemastore-cli` now declare every `@effected/*` package they rely on as a peer. If `pnpm peers check` reports a new unmet `@effected/*` peer, declare it.

## 5. Optional: adopt the interactive CLI kit

Do this only if the project has a CLI and its owner wants it. Load the `effect-v4-cli` skill first; it covers this end to end. The pieces:

- **The one wiring:** `Command.withSharedFlags(CliAudience.flags())` on the root, then `CliRuntime.main(CliAudience.run(root, { version }), { platform, env })`. The flags add `--audience`, `--human`, `--agent` and `--ci`.
- **Output:** `CliMessage` for outcome lines, and `Doc.print` for documents. The renderer follows the audience: ANSI for a person, plain for an agent, a GitHub Actions log under Actions.
- **Prompts:** `CliPrompt.fallback` for a core prompt behind a missing flag.
- **Screens:** `@effected/cli/ui` adds Ink screens (`CliUi.prompt` and `CliUi.fallback` with `Select`, `MultiSelect`, `Confirm`, `TextInput`, `Tabs` and `Viewport`), plus `CliUi.live` for a live progress view.
- **Testing:** `@effected/cli/ui/testing` provides `CliUiTest` to drive them in tests.

## 6. Verify

- **Typecheck:** run `types:check` / `tsc --noEmit` for every package.
- **Build and tests:** run the full build and the full test suite.
- **One Effect version:** one `effect` version (`4.x`) is resolved for your own packages and the kit (`pnpm why effect`). Any release-candidate copy belongs to a tool.
- **Bins:** every published bin starts from a packed install (`npm pack`, then install into a temp directory and run `--help`).
- **Peers:** `pnpm peers check` is clean.
- **No stale references:** the vendored pin, the installed `effect`, and any text that names the current pin all say `4.0.0` (or the `4.x` your lockfile resolves).

Report what you changed, every `partition` call site you fixed, and anything that needed a hand migration beyond the list above.
