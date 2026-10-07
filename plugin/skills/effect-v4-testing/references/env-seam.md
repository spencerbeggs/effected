# The env seam — swap `ConfigProvider`, never `process.env`

Loaded from `effect-v4-testing`.

Code that reads its environment through `Config.*` — `GITHUB_STEP_SUMMARY`,
a token, a feature switch — has a test seam already, and it is **not** in `R`.
`ConfigProvider.ConfigProvider` is a `Context.Reference` whose default is
`fromEnv()` (`ConfigProvider.ts:351`), so a `Config` read requires nothing and
resolves the provider off the fiber. The consequence cuts both ways: nothing
forces a test to provide one (so a suite silently reads the *real* process
env), and any test can replace it as ordinary layer provision:

```ts
import { assert, it } from "@effect/vitest";
import { Config, ConfigProvider, Effect, Option } from "effect";

const program = Effect.gen(function* () {
  const summaryFile = yield* Config.option(Config.String("GITHUB_STEP_SUMMARY"));
  return summaryFile;
});

const env = (record: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: record }));

it.effect("writes the step summary when the env names a file", () =>
  program.pipe(
    Effect.provide(env({ GITHUB_STEP_SUMMARY: "/tmp/summary.md" })),
    Effect.map((summaryFile) => assert.deepStrictEqual(summaryFile, Option.some("/tmp/summary.md"))),
  ));

it.effect("is silent when the variable is unset", () =>
  program.pipe(
    Effect.provide(env({})),
    Effect.map((summaryFile) => assert.deepStrictEqual(summaryFile, Option.none())),
  ));
```

`ConfigProvider.fromEnv({ env })` takes an explicit record and never touches
`process.env` when one is given (`ConfigProvider.ts:945`); `ConfigProvider.layer`
wraps a provider in `Layer.succeed(ConfigProvider)` (`ConfigProvider.ts:682`).
An empty record is the "variable unset" case — spell it, because the default
provider would otherwise answer from whatever the developer's shell exports.
The trap this replaces: mutating `process.env` in `beforeEach`, which leaks
across tests and cannot be scoped to one `Effect.provide`. `effect-v4-idioms`
covers the same reference from the production side.
