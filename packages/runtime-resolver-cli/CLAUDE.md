# @effected/runtime-resolver-cli

The `runtime-resolver` binary. Resolves Node.js, Bun and Deno versions through [`@effected/runtime-resolver`](../runtime-resolver/CLAUDE.md) and prints a JSON envelope, so a CI job can pipe it into `jq` and pick out a version to install.

Four files: `Cli.ts` (the command), `CliResponse.ts` (the envelope schemas), `bin.ts` (the entry point) and `index.ts` (re-exports the command for embedding and testing).

**Design doc:** `@../../.claude/design/effected/packages/runtime-resolver.md` — one doc covers both packages; the split and its rationale are in it.

## Tier: integrated — and this package exists *to be* tier 3

This is the entire reason the package exists. It carries `@effect/platform-node` as a regular dependency, and that is exactly what a tier-2 library's consumers must not be made to install. Under [R1](../../.claude/design/effected/effect-standards.md#dependency-policy) the binary therefore becomes its own package rather than making every API-only consumer of the resolver pay for a platform adapter. A tool declares its full stack as regular dependencies, so `effect` is a `dependency` here, not a peer.

Nothing depends on this package, so R2 propagation is moot.

### The `@effect/cli` finding — the reusable one

**`@effect/cli` is dead on the v4 line and will not be revived.** Its latest is `0.75.2`, its dist-tags are `latest` and `snapshot` only, and it peers on `effect@^3.21.x`. Do not add it, and do not go looking for a v4 release of it.

That is not a blocker, because **the CLI framework moved into `effect` core**: this command is built on `effect/unstable/cli` (`Command`, `Flag`, `Argument`, `Primitive`, `Prompt`, `HelpDoc`, `CliError`). The same merge happened to platform — `effect/unstable/http` ships `HttpClient` and `FetchHttpClient`.

So the split survived the disappearance of its original cause, and the *new* cause is the one to remember:

```ts
// effect/unstable/cli/Command.ts — at the pinned catalog beta
export type Environment = FileSystem.FileSystem | Path.Path | Terminal.Terminal | ChildProcessSpawner | Stdio.Stdio
```

Core **declares** all five and **implements none of them for Node** — it ships `Path.layer`, `FileSystem.layerNoop` and `Stdio.layerTest`, and no more. `@effect/platform-node` supplies the Node implementations (`NodeServices`, `NodeRuntime`, …), and it leaks onto library consumers in precisely the way `@effect/cli` used to. Same R1 rule, different package.

`src/bin.ts` is the **only** file that binds the command to a concrete runtime (`NodeServices.layer` + `NodeRuntime.runMain`). Keep it that way: a `@effect/platform-node` import anywhere else in `src/` makes the package harder to test and blurs the one boundary that justifies its existence.

## A usage error is a failure, not a printed complaint

The rule the tests exist to hold, and the one easiest to break by "improving" the output:

- A **usage** error — no runtime selected, an unrecognized `--node-phases` value — fails with `CliError.UserError`, which `Command.run` and `NodeRuntime.runMain` already understand as **exit code 1**. Printing the complaint and returning successfully (the first cut) exits `0`, and a CI job gating on the exit status reads a typo as a pass.
- A **resolution** that matches nothing is **data**. It exits `0` with `ok: false` in the envelope, because a caller asking "what Node versions match `>=999`?" got a real answer.

Collapsing the two in either direction is the bug. Failing usage errors is also what removes the sentinel that made phase parsing awkward — `parsePhases` fails through the error channel instead of returning an `Option.some(undefined)` for the caller to test against.

`--increments` uses `Flag.choice`, which validates at parse time, so an invalid value never reaches the handler. `--node-phases` takes a comma-separated list, which `Flag.choice` cannot express, so it decodes through the same schema the library uses rather than a hand-rolled string check.

## Testing and building

`Command.runWith` takes an explicit `argv` array, so the CLI is tested **without spawning a process** — a capability the v3 suite did not have. `__test__/Cli.test.ts` drives it against stubbed resolver layers.

`@effect/vitest`, `assert.*` — never `expect`.

```bash
pnpm vitest run packages/runtime-resolver-cli     # from the repo root
pnpm build --filter @effected/runtime-resolver-cli
```

Never run `node savvy.build.ts --target prod` directly — it skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.
