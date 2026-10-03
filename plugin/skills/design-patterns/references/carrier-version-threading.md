# Carrier version threading

A carrier has more than one "version" in play at once — the carrier's own
release, each front end's release, the engine's release, and a
project-specific config-schema version if one exists. Getting this wrong
does not fail loudly: it produces reports that look internally
inconsistent, and a reader who compares two version numbers wrongly
concludes two different builds are running when only one ever was.

`@effected/engine` ships the carrier-identity half of this discipline —
`Distribution`, `DistributionField`, `CurrentDistribution` and
`distributionSuffix` — so a front end no longer hand-rolls its own
`Context.Reference` for it. What still has no kit export, and stays a
recipe: each package inlining its own version at build time, `engine_version`
as the comparable version, and the `--version` line's own format (which
`effect-v4-cli`'s `recipes.md#version-formatter` already teaches — this file
only threads the carrier identity into it).

## Each package inlines its own version, at build time

Every package that needs to report "my version" gets it from a build-time
literal, never a `package.json` read:

```ts
// packages/plugin/src/version.ts
export const PLUGIN_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0";
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/plugin/src/version.ts>)

The bundler replaces `process.env.__PACKAGE_VERSION__` with that specific
package's own version at build time — `"0.0.0"` is the unbuilt-source
fallback, and reads as dev mode rather than a real release. A
`package.json` read looks equivalent until code that reported its version
moves to a shared engine package: at that point a `package.json` read
reports the **engine's** package name and version, not the caller's, and
the bug is silent because both are plausible-looking semver strings.

## The carrier threads its own identity down

A carrier's bin shim knows which meta-package it is, so it passes that
identity to `main()` as an option:

```ts
declare const main: (options: { readonly distribution?: { readonly name: string; readonly version: string } }) => void
declare const PLUGIN_VERSION: string

main({ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } })
```

A direct install of the front end (no carrier involved) calls `main()` with
no `distribution` option at all — the option is optional at every layer for
exactly that reason.

## `CurrentDistribution`: `@effected/engine`'s `Context.Reference`

The front end receives `options.distribution` as a plain optional value and
converts it once, at the top of the program, with `Option.fromNullishOr`
and `@effected/engine`'s `CurrentDistribution`:

```ts
import { CurrentDistribution, distributionSuffix } from "@effected/engine"
import { Effect, Option } from "effect"

interface MainOptions {
  readonly distribution?: { readonly name: string; readonly version: string }
}

const main = (options: MainOptions = {}) =>
  Effect.gen(function* () {
    const distribution = yield* CurrentDistribution
    return `mytool 1.2.3${distributionSuffix(distribution)}`
  }).pipe(Effect.provideService(CurrentDistribution, Option.fromNullishOr(options.distribution)))

console.log(await Effect.runPromise(main({ distribution: { name: "@scope/plugin", version: "1.2.3" } })))
console.log(await Effect.runPromise(main()))
```

Prints `mytool 1.2.3 via @scope/plugin 1.2.3` for the carrier-launched case
and `mytool 1.2.3` (no suffix) for a direct install. `Option.fromNullishOr`
treats both `null` and `undefined` as absent and wraps anything else in
`Option.some` — the nullish form is right here because a shim may pass
`distribution: undefined` explicitly rather than omitting the option. Its
siblings are narrower: `fromUndefinedOr` treats only `undefined` as absent,
`fromNullOr` only `null`.

`CurrentDistribution` is a `Context.Reference`, not a `Context.Service` — it
carries its own default (`Option.none()`), so nothing has to provide it at
all for a direct install; only the carrier-launched path needs the one
`Effect.provideService` call, made once, at the top of the program. Every
command or handler further down reads `CurrentDistribution` and gets
`Option.none()` for a direct install with zero ceremony, instead of every
call site needing to provide a fake value just to satisfy a service
requirement it doesn't otherwise care about. The shape being threaded —
`{ name, version }` — is `@effected/engine`'s `Distribution`, one
definition every front end shares instead of each hand-rolling its own
`Schema.Struct`; `DistributionField` is the `null`-or-`Distribution` shape
for a JSON envelope field.

## `engine_version` is THE comparable version

Every JSON envelope the engine produces carries two version-shaped fields,
and they answer different questions:

- **`engine_version`** — stamped by the engine itself, so no front end can
  omit or misreport it. This is **the** version to compare across two
  reports when asking "did the same build produce both of these?"
- **`distribution`** — packaging metadata: `null` for a direct install, or
  `{ name, version }` for whichever meta-package the bins came through.
  Front-end version and distribution are provenance, not a comparable
  version.

The origin of this rule is a real incident: an agent compared a CLI
report's own version against an MCP report's own version over the same
bundle, found them different, and wrongly concluded two different engines
had run the analysis — when in fact one engine ran both times and only the
*packaging* differed. `engine_version` (plus a spec/schema version, where
one exists) is the field designed to make that comparison correct instead
of misleading.

## The `--version` format

Formatting the version line itself — combining `distributionSuffix` with
core's own `formatVersion` hook — is `effect-v4-cli`'s
[`recipes.md#version-formatter`](../../effect-v4-cli/references/recipes.md#version-formatter),
not re-taught here: that reference covers the exact `(name, version)` arity
`formatVersion` takes and the ruling that only a *consumer* front end may
depend on `@effected/engine`, never the kit's own `cli` package. This file
supplies the identity `CurrentDistribution` carries down to that formatter;
the formatter is the front end's job.

## MCP and LSP threading

The MCP server threads `distribution` as a plain optional parameter through
its own call chain — `main` → `ServerLayer` → the tool registry → each tool
handler — the same `{ name, version } | undefined` shape at every hop
(<https://github.com/spencerbeggs/okfit/blob/main/packages/mcp/src/server.ts>,
<https://github.com/spencerbeggs/okfit/blob/main/packages/mcp/src/toolkit.ts>).
The LSP server instead puts it in its own startup log line rather than a
structured field:

```ts
const LSP_VERSION = "1.0.0"
const distribution = { name: "@scope/plugin", version: "1.2.3" }

const startupLine = `okfit-lsp ${LSP_VERSION} via ${distribution.name} ${distribution.version}`
console.log(startupLine)
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/lsp/src/server.ts>)

Pick the mechanism that matches how that front end's consumers actually
observe it — a startup log line for something a human tails, a structured
envelope field for something a program parses.

## What the other two repos are missing

`systems`' `savvy --version` reports the **CLI's** own version from the
carrier — there is no distribution threading, so a report gives no signal
about which meta-package installed it, and Silk's version is threaded
nowhere at all. `vitest-agent` has no threading of any kind; a lockstep
runtime-drift check that tried to compare versions across its own front
ends was removed after producing false positives. Neither gap is fatal —
both tools work — but neither can answer "did the same build produce
these two reports?" the way `engine_version` answers it here. See
[carrier-case-studies.md](./carrier-case-studies.md) for the full deltas.
