---
name: actions-inputs-outputs
description: >-
  Use when reading a GitHub Action's inputs through ActionInput, writing outputs through
  ActionOutputs, or designing a machine-readable, schema-backed output contract for a workflow or
  LLM consumer.
---

# Actions inputs & outputs

The runner-file I/O surface of `@effected/github-actions`: reading what a workflow author configured, and publishing what the action produced. Both modules fail through structured errors, and neither ever spells a runner variable name — that mangling lives in exactly one function per direction.

For everything else the runtime provides — `ActionState`, `Secret`, `GitHubToken`, the default layer composition — see `actions-runtime`. For `Redacted`/masking mechanics and cross-phase state, see `actions-state-and-secrets`. For the job summary sink and log annotations beyond `setFailed`/`setSecret`, see `actions-reporting`. For test doubles, see `testing-actions`. General Effect v4 `Config`/`Schema` rules live in `effect-v4-schema` and `effect-v4-idioms`; this skill carries only the Actions-specific instance of those rules.

## What you have

| Construct | Import | Reach for it when |
| --- | --- | --- |
| `ActionInput.string` / `.boolean` / `.integer` / `.redacted` | `import { ActionInput } from "@effected/github-actions"` | reading a single-value input with the runner's own parsing rules |
| `ActionInput.lines` / `.list` / `.pairs` | same | reading a multi-value or key/value input without hand-rolling a splitter |
| `ActionInput.schema(name, schema)` | same | an input carries genuinely nested structure and is worth decoding as JSON |
| `ActionOutputs.set` / `.exportVariable` / `.addPath` | `import { ActionOutputs } from "@effected/github-actions"` | publishing a plain output, an env var for later steps, or a PATH prefix |
| `ActionOutputs.setJson` | same | publishing a structured output through a `Schema` codec |
| `ActionOutputs.summary` | same | appending to the job summary (full sink detail in `actions-reporting`) |
| `ActionOutputs.setFailed` / `.setSecret` | same | rendering `::error::`/`::add-mask::` directly, outside the normal failure path |

## Standards

- **Read every input through `ActionInput`'s accessors — never a bare `Config.string`/`Config.boolean` spelled by hand.** The accessors own the `INPUT_` name mangling (uppercase, spaces to underscores, dashes survive) and carry the parsing and typed `ConfigError`s a bare read cannot. `ActionRuntime.layer` installs a provider that also resolves a bare flat name through the same derivation, but a program that reads inputs directly still owns none of the parsing — write `ActionInput.boolean("dry-run")`, not `INPUT_DRY-RUN` spelled anywhere.
- **Prove a present-but-malformed input fails through `withDefault` — do not hand it an `actual`.** Through effect beta.101, `Config.withDefault`/`Config.option` classified an `InvalidValue` whose `actual` was `Option.none()` as *missing*, so hand-built `ConfigError`s had to carry `Option.some(actual)` or be silently defaulted. beta.102–105 removed the trap: issues no longer carry `actual` (`InvalidValue` is `(annotations?, input?, options?)`), and `Config` tracks input evidence itself — probed on beta.105, a present-but-malformed value fails even under a default. Keep the regression test (`config.pipe(Config.withDefault(x))` fails, not falls back, on malformed input); drop the `Option.some(actual)` construction (it no longer type-checks). See `references/input-validation.md`.
- **Design a state or output field's encoded form as plain JSON before deciding how to test it.** A `setJson` payload, a runner-file write, and cross-phase state all round-trip through `JSON.stringify`/`parse`; a value whose encoded form isn't a JSON primitive fails one step later than the mistake.
- **Build a `CheckRunOutput`/`ActionOutputs` object with a conditional spread when a field is `optionalKey`.** The key may be omitted; the value must never be an explicit `undefined` passed to it.
- **Publish a `setJson` contract from a schema the projection also produces from — never duplicate the shape.** See `references/output-contracts.md`.
- **An empty string reads as absent, everywhere in this surface.** The runner sets an unsupplied optional input to `""`; treat that the same as a missing key, not a supplied empty value.

## Footguns

- A bare `Config.string("dry-run")` can typecheck, compile clean, and pass a test suite whose injected `ConfigProvider` is keyed by the plain name — and still read nothing against the real runner, silently falling back to a default. See `references/input-validation.md`.
- GitHub uppercases and replaces spaces with underscores in a runner variable name, but dashes survive — a hand-written test key with underscores where dashes belong reads nothing and passes for the wrong reason. See `references/input-validation.md`.
- `ActionEnvironment` snapshots `process.env` once at layer construction, so a value exported mid-run through `exportVariable` is never observed by the same process's own reader — that's GitHub's model, not a bug. Assert against the written `GITHUB_ENV` file, not a same-process readback.
- A runner-file block write uses a derived delimiter, never a fixed or random one — a value containing an un-derived delimiter would terminate its own block early and corrupt every entry written after it in the same file.

## Additional resources

- [references/input-validation.md](references/input-validation.md) — the `Config.withDefault` trap in full, the `inputVariable` mangling rule with its dash/underscore trap, the two config providers (`layerDefault` vs the record-backed `layer()`), and the three-way sync discipline between `action.yml`, an input names tuple and the decoded shape. Load when: designing or reviewing an inputs module, or chasing why a malformed input silently defaulted.
- [references/output-contracts.md](references/output-contracts.md) — `ActionOutputs`' full member table, the runner-file delimiter and name-validation rules, and the pattern for a `setJson` payload consumed outside the action: schema as encoder, pure projections, the `@effected/schemastore` generator whose pipeline refuses a pinned target's contract change itself, versioned publication, and the `SchemaPipeline.check` drift test. Load when: authoring or reviewing `ActionOutputs` usage, or a `setJson` output meant for a downstream job, a bot, or an LLM reader.
- [references/json-contracts.md](references/json-contracts.md) — when a JSON-shaped input earns a published, `@effected/schemastore`-generated JSON Schema versus staying an internal `ActionInput.schema` decode. Load when: an input is genuinely nested structure rather than a flat or line-list value, and workflow authors would benefit from editor completion on it.
