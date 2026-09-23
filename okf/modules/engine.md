---
type: Module
title: "@effected/engine"
description: The platform-free primitives a carrier-pattern tool's own engine package shares across its front ends — distribution stamping, remediation shape, and launch-context resolution.
status: draft
kind: package
resource: ../../packages/engine
layer: pure
tags: [architecture, bundle]
generated:
  by: "okfit/claude-code"
  at: 2026-09-23T17:45:24Z
  body_sha256: 7796266d9c54628b5fb105e41234870bfcb183b4fb716a336365165dc8464445
---

# @effected/engine

`@effected/engine` is where the primitives every front end of a
carrier-pattern tool shares live, once, fixed. A consumer such as okfit or
vitest-agent ships its own `engine` package that composes its `core` and
its vocabulary into shared programs; this kit package sits *below* that
consumer engine, not beside it — the consumer's engine is the thing that
**stamps `distribution` into envelopes**, and stamping requires reading
`CurrentDistribution`, so the primitive that carries it has to live
somewhere a consumer's engine can depend on without also depending on a
front end.

That is the whole reason this package exists rather than living inside
`@effected/cli` or a future `@effected/mcp`: **a consumer's engine may not
import `@effected/cli`**, whose own rule is that only applications depend
on it (see [`cli.md`](cli.md)). If `Distribution` lived in `cli`, every
consumer engine that wanted to stamp its own distribution would have to
take a `cli` dependency it structurally cannot carry. Putting `Distribution`,
`Remediation` and `LaunchContext` in a package with no dependents but the
two front ends — and one dependent, `@effected/mcp`, sitting above it in
turn — breaks that knot. See
[D1](../decisions/engine-holds-cross-front-end-primitives.md) for the full
reasoning and the rejected alternatives.

## Public surface

One module per concept, static classes with a private constructor where a
concept groups more than one operation — never an `as const` namespace
object, which loses TSDoc on its members in the built `.d.ts`.

| Export | Kind | Contract |
| --- | --- | --- |
| `Distribution` | `Schema.Struct` and type | `{ name: string; version: string }` — the carrier package a bin was installed through. |
| `DistributionField` | schema | `Schema.NullOr(Distribution)`, for envelopes. `null` means installed directly, not "not yet known." |
| `CurrentDistribution` | `Context.Reference<Option<Distribution>>` | `defaultValue: () => Option.none()`. A front end's `main` provides it once. A `Reference`, not a `Service`, so reading it adds nothing to `R`. |
| `distributionSuffix(d)` | free function | `(d: Option<Distribution>) => string`, giving `" via <name> <version>"` or `""`. A free function, not `Distribution.suffix` — a `Schema.Struct` value carries no statics to hang it from. |
| `Remediation` | `Schema.Struct` and type | `{ hint: string; suggestedTool?: string; suggestedArgs?: Record<string, unknown> }`. The shape okfit and Silk both already use, plus vitest-agent's `suggestedArgs`; vitest-agent's `humanHint` maps onto `hint`. |
| `LaunchContext.projectDir(input)` | static function | `({ argv?, env, keys, cwd }): string`. Resolves in this order: the first `argv` value that is neither empty nor a placeholder, then the first `keys` env value that is neither empty nor a placeholder, then `cwd`. Pure — `env` and `cwd` are passed in, never read from `process`. |
| `LaunchContext.isUnsubstituted(value)` | static function | `(value: string): boolean`. Detects a literal `${VAR}` that a host such as Claude Code left unsubstituted. |
| `type ProjectDirInput` | type | The parameter shape `LaunchContext.projectDir` takes. |

## Not exported, and why

- **Version constants** (an `ENGINE_VERSION` and the like). The bundler
  substitutes `__PACKAGE_VERSION__` in the *consuming* package at build
  time, so a helper shipped from this kit package would report this kit's
  own version, not the consumer's — the one value this primitive must
  never produce. The rule that an engine stamps its own version is taught
  as doctrine, with the build-time constant as a skill recipe, not
  packaged.
- **The platform layer.** Building a platform layer is a decision that
  belongs to the front end's `main`, not to a pure package with no IO at
  all.
- **`Now`.** An injectable clock has exactly one adopter today and stays a
  recipe rather than becoming kit surface it would have to carry forever.

## Tier and dependency rules

[Pure tier](../glossary/library-tier.md): `effect` is the only peer, no
`process`, no `node:` import, no platform package. Nothing in the kit
depends on `@effected/engine` except `@effected/mcp`
(see [`mcp.md`](mcp.md)); `@effected/cli` must not, and no package may add
an edge to it without a new Decision.

## Consumers

[`consumers/okfit`](../consumers/okfit.md) is the register entry that first
named this gap: its own `engine` package is exactly the shape a kit
`Distribution` primitive sits under, and its `Remediation`/`ToolFailure`
copies are one of the near-identical duplicates this package (together with
the phase-2 `@effected/mcp`) exists to collapse.
[`consumers/vitest-agent`](../consumers/vitest-agent.md) is the second: its
`process.exit` handlers and `spawnSync` e2e are `@effected/cli` concerns
(see [D3](../decisions/cli-logger-defaults-all-to-stderr.md) and
[D9](../decisions/cli-testing-uses-core-child-process.md)), but its two
independent ports of `registerToolkit` are the `Remediation`-shaped
duplication this package's `CurrentDistribution` and `Remediation` exports
target directly.

## Testing

- Schema round-trips for `Distribution` and `Remediation`.
- `CurrentDistribution`'s default read with nothing provided, and an
  override.
- `distributionSuffix`'s full truth table (`None`, `Some` with and without
  a version worth naming).
- `LaunchContext.projectDir`: an empty-string env value, a
  `${CLAUDE_PROJECT_DIR}` literal, argv precedence over env, falling
  through to `cwd`.
- A property test asserting `projectDir` never returns an empty string
  when `cwd` is not empty.

## See also

- [D1: `@effected/engine` exists and holds `Distribution`, `Remediation` and `LaunchContext`](../decisions/engine-holds-cross-front-end-primitives.md)
- [`@effected/cli`](cli.md)
- [`@effected/mcp`](mcp.md) (phase 2)
