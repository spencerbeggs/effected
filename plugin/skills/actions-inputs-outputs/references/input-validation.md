# Reading inputs correctly

## `ActionInput`: a static namespace of `Config` factories

`ActionInput` is a static namespace of `Config.Config<A>` factories, not a
service:

| Accessor | Returns | Notes |
| --- | --- | --- |
| `ActionInput.string(name)` | `Config.Config<string>` | `Config.string(inputVariable(name))` |
| `ActionInput.boolean(name)` | `Config.Config<boolean>` | YAML 1.2 core schema only: `true\|True\|TRUE\|false\|False\|FALSE` |
| `ActionInput.integer(name)` | `Config.Config<number>` | `Config.int(inputVariable(name))` |
| `ActionInput.redacted(name)` | `Config.Config<Redacted.Redacted<string>>` | `Config.redacted(inputVariable(name))` |
| `ActionInput.lines(name)` | `Config.Config<ReadonlyArray<string>>` | Splits on `\n`, trims, drops blanks |
| `ActionInput.list(name)` | `Config.Config<ReadonlyArray<string>>` | Accepts a JSON array, a YAML bullet list, or comma/newline-separated values |
| `ActionInput.pairs(name)` | `Config.Config<Record<string, string>>` | One `key=value` per line, `#` comments stripped, splits on the first `=` only |
| `ActionInput.schema(name, schema)` | `Config.Config<A>` | JSON-parses the raw string, then decodes through `schema` |

There is no `ActionInputs` service and no `ActionInputError` — an input
failure is a `Config.ConfigError`.

## The `inputVariable` mangling rule

Every accessor is keyed by `inputVariable(name)`:

```ts
export const inputVariable = (name: string): string => `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
```

**GitHub uppercases and replaces spaces with underscores — dashes
survive.** The input `sbom-config` arrives as `INPUT_SBOM-CONFIG`, not
`INPUT_SBOM_CONFIG`; reading `process.env["INPUT_SBOM_CONFIG"]` directly
finds nothing. The same rule applies to a multi-word action name:
`upgrade-runtime-node` arrives as `INPUT_UPGRADE-RUNTIME-NODE`. A
hand-written test key of `INPUT_UPGRADE_RUNTIME_NODE` — underscores where
the dashes belong — reads nothing, and a test built that way passes for the
wrong reason: it never asks the runner's real key to resolve at all. Read
every input through `ActionInput` — no caller spells `INPUT_*` itself.

An **empty string reads as absent**, both for `ActionInput`'s accessors and
for the installed provider below: the runner sets an unsupplied optional
input to `""`, and treating that as present would make every unset
optional input look supplied.

```ts
import { ActionInput } from "@effected/github-actions";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const dryRun = yield* ActionInput.boolean("dry-run");
  const paths = yield* ActionInput.list("paths");
  const token = yield* ActionInput.redacted("token");
});
```

## Two providers: `layerDefault` is in the runtime, `layer()` never is

`ActionInput.layerDefault` **is** composed into `ActionRuntime.layer`. Its
provider, `ActionInput.providerOver(ambient)`, touches only a **flat,
single string-segment** name — the only shape the runner could have set —
trying `inputVariable(name)` through the ambient provider first, then the
name unchanged; nested and numeric paths pass through untouched. Pinned
consequences: a supplied input **shadows** an env var of the same bare name
in any casing of the read (the derivation uppercases); an unsupplied input
(`""`) does not shadow, because the attempt resolves through the ambient
provider's empty-is-absent rule; and `ActionInput.*` accessors are
unchanged — their `INPUT_` names re-mangle to `INPUT_INPUT_…`, never match,
and fall through to the ambient lookup they always used.

`ActionInput.layer(env?)` installs a different `ConfigProvider` — one that
joins a path with `_`, replaces spaces with underscores, and uppercases the
whole. It is **never** composed into `ActionRuntime.layer`:
`ActionInput`'s own `inputVariable` already fully mangles the key before
any `Config` read happens, and the ambient default `ConfigProvider`
resolves that exact variable with the same empty-string-is-absent
semantics — so installing this provider in production buys nothing for
inputs, while its uppercasing would silently re-mangle the key of every
**other** `Config` a program reads. `ActionInput.layer` stays exported for
the one case it was built for: resolving inputs from an explicit record in
a test, without mutating `process.env`.

```ts
// Test-only — never composed into a running action's default layer:
const value = yield* Effect.provide(ActionInput.string("dry-run"), ActionInput.layer({ "INPUT_DRY-RUN": "true" }));
```

## The `Config.withDefault` trap — retired in effect beta.102–105

`Config.withDefault` and `Config.option` fall back only for **missing**
data. Through effect 4.0.0-beta.101, "missing" was judged from the *issue*:
an `InvalidValue` whose `actual` was `Option.none()` was classified as
missing data, so a hand-built `Config.ConfigError` that omitted `actual`
got silently swallowed by any default placed on top of it — a boolean input
that decoded wrong under `withDefault(false)` silently resolved to `false`,
and a dry-run flag misread that way ran its mutations for real. The fix
then was constructing the issue with `Option.some(actual)`.

**beta.102–105 removed both the trap and the fix.** `SchemaIssue`s no
longer carry an `actual: Option` (`InvalidValue` is now
`(annotations?, input?, options?)`, input retained only under
`reportInput: true`), and `Config` judges missing-vs-invalid from its own
evaluator's input evidence, not the issue. Probed on beta.105: a
present-but-malformed value **fails** through `withDefault`, and so does a
hand-built
`new Config.ConfigError(new Schema.SchemaError(new SchemaIssue.InvalidValue({ message })))`
with no input attached — neither silently defaults. Do not port the
`Option.some(actual)` construction forward (it no longer type-checks).
The regression test is still worth keeping: assert that
`yourConfig.pipe(Config.withDefault(fallback))` still **fails** — not falls
back — when fed a present-but-malformed value.

## Designing an inputs module: decode once, validate across fields

Model every action input over `ActionInput`, decoded **once** and exported
separately from an `INPUT_NAMES` const tuple (names as data, not scattered
string literals), with defaults matching `action.yml` exactly. Cross-field
interaction validation — an enum-or-range choice, two inputs that must stay
disjoint, "at least one of these must be active" — belongs in that same
decode step, not scattered across the steps that consume the values later:
a caller reading `steps/lint.ts` should never have to also read
`steps/format.ts` to know whether their two inputs can legally combine.

Plan a **three-way sync test** between `action.yml`'s declared inputs, the
`INPUT_NAMES` tuple, and the decoded shape's keys — one assertion that
walks all three and fails if any pair disagrees. This catches the drift a
line-by-line code review misses: an input added to `action.yml` but never
wired into `readInputs`, or a tuple entry with no matching `action.yml`
declaration.
