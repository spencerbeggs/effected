---
name: actions-inputs-outputs
description: Use when reading @effected/github-actions inputs through ActionInput (Config-based — there is no ActionInputs service and ActionInputError does not survive; INPUT_ variable mangling; the Config.withDefault trap that silently swallows a malformed input behind a default) or writing outputs through ActionOutputs (set, setJson, summary, exportVariable, addPath, setFailed, setSecret; the derived runner-file heredoc delimiter; GITHUB_OUTPUT/GITHUB_ENV/GITHUB_PATH/GITHUB_STEP_SUMMARY). Also covers designing a machine-readable, schema-backed output contract for a workflow or LLM consumer. Trigger phrases — action input, action output, INPUT_ mangling, ConfigError, dry-run silently defaulted, runner file delimiter, setJson, output contract, JSON Schema drift test.
---

# Actions inputs & outputs

The runner-file I/O surface of `@effected/github-actions`: reading what a
workflow author configured, and publishing what the action produced. Both
modules live in `packages/github-actions/src/`, both fail through structured
errors, and neither ever spells a runner variable name — that mangling lives
in exactly one function per direction.

For everything else the runtime provides — `ActionState`, `Secret`,
`GitHubToken`, the default layer composition — see `actions-runtime`. For
`Redacted`/masking mechanics and cross-phase state, see
`actions-state-and-secrets`. For the job summary sink and log annotations
beyond `setFailed`/`setSecret`, see `actions-reporting`. For test doubles and
harness patterns across this package, see `testing-actions`. General Effect
v4 `Config`/`Schema` rules live in `effect-v4-schema` and `effect-v4-idioms`;
this skill carries only the Actions-specific instance of those rules.

## Inputs: `Config`, not a service

There is no `ActionInputs` service and `ActionInputError` **does not
survive** — an input failure is a `Config.ConfigError`
(`packages/github-actions/CLAUDE.md`, "Errors"). `ActionInput` is a static
namespace of `Config.Config<A>` factories
(`packages/github-actions/src/ActionInput.ts:79-252`):

| Accessor | Returns | Notes |
| --- | --- | --- |
| `ActionInput.string(name)` | `Config.Config<string>` | `Config.string(inputVariable(name))` (`ActionInput.ts:83-85`) |
| `ActionInput.boolean(name)` | `Config.Config<boolean>` | YAML 1.2 core schema: `true\|True\|TRUE\|false\|False\|FALSE` only (`ActionInput.ts:88-107`) |
| `ActionInput.integer(name)` | `Config.Config<number>` | `Config.int(inputVariable(name))` (`ActionInput.ts:110-112`) |
| `ActionInput.redacted(name)` | `Config.Config<Redacted.Redacted<string>>` | `Config.redacted(inputVariable(name))` (`ActionInput.ts:115-117`) |
| `ActionInput.lines(name)` | `Config.Config<ReadonlyArray<string>>` | Splits on `\n`, trims, drops blanks (`ActionInput.ts:127-136`) |
| `ActionInput.list(name)` | `Config.Config<ReadonlyArray<string>>` | Accepts a JSON array, a YAML bullet list, or comma/newline-separated values (`ActionInput.ts:146-173`) |
| `ActionInput.pairs(name)` | `Config.Config<Record<string, string>>` | One `key=value` per line, `#` comments stripped, splits on the **first** `=` only (`ActionInput.ts:181-199`) |
| `ActionInput.schema(name, schema)` | `Config.Config<A>` | JSON-parses the raw string, then decodes through `schema` (`ActionInput.ts:202-216`) |

Every one of these is keyed by `inputVariable(name)`
(`ActionInput.ts:19`):

```ts
export const inputVariable = (name: string): string => `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
```

**GitHub uppercases and replaces spaces — dashes are left alone.** The input
`sbom-config` arrives as `INPUT_SBOM-CONFIG`, not `INPUT_SBOM_CONFIG`
(`ActionInput.ts:8-10`; asserted directly in
`__test__/ActionInput.test.ts:18-31`, including a regression case named for
"the bug that shipped": a consumer once read
`process.env["INPUT_SBOM_CONFIG"]` directly and silently got nothing). Read
every input through `ActionInput` — no caller spells `INPUT_*` itself.

An **empty string reads as absent**, both for `ActionInput`'s accessors and
for `ActionInput.provider` (`ActionInput.ts:225-226`, `:233-234`): the runner
sets an unsupplied optional input to `""`, and treating that as present
would make every unset optional input look supplied.

```ts
import { ActionInput } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
 const dryRun = yield* ActionInput.boolean("dry-run");
 const paths = yield* ActionInput.list("paths");
 const token = yield* ActionInput.redacted("token");
});
```

### `ActionInput.layer()` is deliberately not in the default runtime

`ActionInput.layer(env?)` installs `ActionInput.provider` — a
`ConfigProvider` that joins a path with `_`, replaces spaces with underscores
and uppercases the whole (`ActionInput.ts:231-236`, `:249-251`). It is
**never** composed into `ActionRuntime.layer`. Per the probe recorded in
`packages/github-actions/src/Action.ts:64-73`: `ActionInput`'s own
`inputVariable` already fully mangles the key before any `Config` read
happens, and at beta.101 the ambient default `ConfigProvider` resolves that
exact variable with the same empty-string-is-absent semantics — so
installing `ActionInput.layer()` in production buys nothing for inputs,
while its uppercasing would silently re-mangle the key of every **other**
`Config` the program reads. It stays exported for the one case it was built
for: resolving inputs from an explicit record in a test, without mutating
`process.env`.

```ts
// Test-only — never composed into a running action's default layer:
const value = yield* Effect.provide(ActionInput.string("dry-run"), ActionInput.layer({ "INPUT_DRY-RUN": "true" }));
```

### The `Config.withDefault` trap

**The most valuable thing in this skill.** `Config.withDefault` and
`Config.option` fall back only for **missing** data — and "missing" is
judged from the *issue*, not the combinator: an `InvalidValue` whose `actual`
is `Option.none()` is classified as missing data
(`.repos/effect/packages/effect/src/Config.ts:298-325`,
`isMissingDataOnly`, confirmed at line 304:
`Option.isNone(issue.actual) || (Option.isSome(issue.actual) && issue.actual.value === undefined)`).
`Config.withDefault`'s own TSDoc states "validation errors still propagate" —
true, **provided** the validation error correctly carries what it rejected.

A hand-built `Config.ConfigError` that omits `actual` therefore looks exactly
like missing data to `withDefault`/`option`, and gets silently swallowed by
any default placed on top of it — even though the input was **present and
malformed**, not absent.

This shipped as a real defect in `ActionInput.boolean`: a malformed
`dry-run` input resolved to `false` under a `withDefault(false)`, and a
rehearsal run performed real mutations
(`.claude/plans/2026-07-25-github-split-decisions-log.md:420-426`;
`packages/github-actions/CLAUDE.md`, "Errors"). The fix is in
`ActionInput.ts:33-34`:

```ts
const configError = (message: string, actual: unknown): Config.ConfigError =>
 new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue(Option.some(actual), { message })));
```

`Option.some(actual)` is load-bearing. **Any typed `ConfigError` built in
this package (or a downstream one) must carry its `actual`.** The wrong
version — `Option.none()`, or a bare `Config.ConfigError` built without
routing through `SchemaIssue.InvalidValue` at all — compiles, typechecks,
and passes every test that does not specifically stack a `withDefault` on
top of the failing config. Test for it directly: assert that
`yourConfig.pipe(Config.withDefault(fallback))` still **fails** — not
falls back — when fed a present-but-malformed value.

## Outputs: `ActionOutputs`

`ActionOutputs` (`packages/github-actions/src/ActionOutputs.ts:149-172`) is a
`Context.Service` requiring `ActionEnvironment | FileSystem.FileSystem` to
build. Its shape (`ActionOutputsShape`, `ActionOutputs.ts:70-89`):

| Member | Signature | Target |
| --- | --- | --- |
| `set` | `(name, value) => Effect<void, ActionOutputError>` | `GITHUB_OUTPUT` |
| `setJson` | `<A, I>(name, value: A, schema: Schema.Codec<A, I>) => Effect<void, ActionOutputError>` | `GITHUB_OUTPUT`, JSON-encoded through `schema` |
| `summary` | `(content) => Effect<void, ActionOutputError>` | `GITHUB_STEP_SUMMARY` |
| `exportVariable` | `(name, value) => Effect<void, ActionOutputError>` | `GITHUB_ENV` |
| `addPath` | `(path) => Effect<void, ActionOutputError>` | `GITHUB_PATH` |
| `setFailed` | `(message) => Effect<void>` | stdout, `::error::` workflow command |
| `setSecret` | `(value) => Effect<void>` | stdout, `::add-mask::` workflow command |

`ActionOutputError` (`ActionOutputs.ts:10-38`) carries a closed `reason`:
`unavailable` (the runner-file variable itself is unset — usually means the
code is not running on a runner), `writeFailed`, `invalidName`, or
`encodeFailed` (a `setJson` value did not satisfy its schema).

### Where the runner files come from

`ActionOutputs`' internal `append` resolves the destination path by asking
`ActionEnvironment.get(file)` for the runner-file **variable name** —
`"GITHUB_OUTPUT"`, `"GITHUB_ENV"`, `"GITHUB_PATH"`, `"GITHUB_STEP_SUMMARY"`
(`ActionOutputs.ts:95-103`). `ActionEnvironment` is the **one** reader of
`process.env` in the package, snapshotted once into an immutable map when its
`.layer` builds (`ActionEnvironment.ts:294-304`); `get` fails typed
(`ActionEnvironmentError`, `reason: "unavailable"` maps through to
`ActionOutputError`'s `unavailable`) rather than resolving to `undefined`
when a variable is not set — which is exactly what happens when this code
runs off a real runner. Full context/override mechanics
(`GitHubContext`, `RunnerContext`, `withEnv`, fiber-local overrides):
`actions-runtime`.

### Runner-file delimiters are derived, never random

Every block write goes through `appendBlock`, which wraps the value in a
heredoc-shaped block (`ActionOutputs.ts:105-111`):

```ts
const delimiterFor = (value: string): string => {
 let delimiter = BASE_DELIMITER; // "EFFECTED_EOF"
 while (value.includes(delimiter)) {
  delimiter = `${delimiter}_`;
 }
 return delimiter;
};
```

GitHub's own toolkit picks a random UUID here and accepts the (tiny) chance
of collision. Extending `EFFECTED_EOF` with `_` until it is absent from the
value makes collision **impossible** rather than improbable, needs no
`Crypto` in `R`, and is deterministic under test
(`ActionOutputs.ts:43-60`; exercised directly in
`__test__/ActionOutputs.test.ts:67-83`, which writes a value containing the
literal string `EFFECTED_EOF` and asserts the delimiter grew past it). A
value that contained an un-derived, fixed delimiter would terminate its
block early and corrupt every entry written after it in the same file — a
value-controlled injection into the runner's own file. `isUsableName`
(`ActionOutputs.ts:63`) applies the same discipline to the **name** half:
a name containing `\r` or `\n` is refused (`reason: "invalidName"`) before
anything is written, rather than corrupting the block structure.

### `exportVariable` targets subsequent steps, not this one

`ActionEnvironment` snapshots `process.env` once, at layer construction. A
variable exported mid-run through `ActionOutputs.exportVariable` is **not**
observed by an already-seeded `ActionEnvironment` reader in the same
process — that is GitHub's own model (`exportVariable` affects steps that
run *after* the current one), not a bug in this package
(`ActionEnvironment.ts:113-129`, `ActionOutputs.ts:139-146`). Do not write a
test asserting a same-process readback of an exported variable; assert
against the written `GITHUB_ENV` file content instead, as
`__test__/ActionOutputs.test.ts:100-114` does.

```ts
import { ActionOutputs } from "@effected/github-actions";
import { Effect, Schema } from "effect";

const Result = Schema.Struct({ count: Schema.Number, tag: Schema.String });

const program = Effect.gen(function* () {
 const outputs = yield* ActionOutputs;
 yield* outputs.set("version", "1.2.3");
 yield* outputs.setJson("result", { count: 2, tag: "ok" }, Result);
 yield* outputs.exportVariable("CACHE_HIT", "true");
 yield* outputs.summary("## Done\n");
});
```

## Machine-readable output contracts

Designing a `setJson` payload as a stable contract for a downstream workflow
step or an LLM consumer — `Schema` as the single source of truth,
`Schema.toJsonSchemaDocument`, annotation conventions, and a committed-schema
drift test — is its own reference.

**Load when:** authoring or reviewing a `setJson` output meant to be
consumed outside the action itself (a downstream job, a bot, an LLM reading
workflow output).

→ [references/output-contracts.md](references/output-contracts.md)
