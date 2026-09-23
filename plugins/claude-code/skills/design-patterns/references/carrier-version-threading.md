# Carrier version threading

A carrier has more than one "version" in play at once — the carrier's own
release, each front end's release, the engine's release, and a
project-specific config-schema version if one exists. Getting this wrong
does not fail loudly: it produces reports that look internally
inconsistent, and a reader who compares two version numbers wrongly
concludes two different builds are running when only one ever was.

This threading discipline is the **best-of-three** answer: of the reference
repos, only one built it out fully. Treat it as the composite target, not
as "how every tool already does it" — see
[carrier-case-studies.md](./carrier-case-studies.md) for which repos have
which pieces.

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
main({ distribution: { name: "@okfit/plugin", version: PLUGIN_VERSION } });
```

A direct install of the front end (no carrier involved) calls `main()` with
no `distribution` option at all — the option is optional at every layer for
exactly that reason.

## `Distribution`: a `Context.Reference`, not a service

The front end receives `options.distribution` as a plain optional value and
converts it once, at the top of the command tree, with `Option.fromNullishOr`
(<https://github.com/spencerbeggs/okfit/blob/main/packages/cli/src/main.ts>):

```ts
const distribution = Option.fromNullishOr(options.distribution);
// ...
Effect.provideService(DistributionRef, distribution),
```

`Option.fromNullishOr` treats both `null` and `undefined` as absent and
wraps anything else in `Option.some` (`Option.ts:773`). Its siblings are
narrower: `fromUndefinedOr` (`Option.ts:807`) treats only `undefined` as
absent and `fromNullOr` (`Option.ts:841`) only `null`. The nullish form is
right here because a shim may pass `distribution: undefined` explicitly.

`DistributionRef` itself is declared once, in the front end's `internal/`
tree, as a `Context.Reference` — deliberately **not** a `Context.Service`:

```ts
export const Distribution: Context.Reference<Option.Option<DistributionShape>> = Context.Reference(
  "@okfit/cli/Distribution",
  { defaultValue: () => Option.none() },
);
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/cli/src/internal/distribution.ts>)

`Context.Reference` carries `defaultValue` and reads back without any
explicit provision — confirmed in the vendored source's `Context.ts`,
where `Reference` is defined as taking a key plus a `{ defaultValue: () =>
Service }` options object. That is exactly the shape a piece of packaging
metadata wants: every command in the tree can read `Distribution` and get
`Option.none()` for a direct install, with zero ceremony, rather than every
call site needing to provide a fake value just to satisfy a service
requirement it doesn't otherwise care about.

The shape being threaded — `{ name, version }` plus its schema — lives in
the **engine**, not in any one front end, so every front end shares one
definition:

```ts
// packages/engine/src/render/distribution.ts
export interface Distribution {
  readonly name: string;
  readonly version: string;
}
export const DistributionField = Schema.NullOr(Schema.Struct({ name: Schema.String, version: Schema.String }));
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/engine/src/render/distribution.ts>)

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

okfit's CLI formats its version line as:

```text
okfit <CLI_VERSION>[ via @okfit/plugin X] (engine <ENGINE_VERSION>, okf <SPEC>, config-schema <V>)
```

implemented as a custom `formatVersion` override on the CLI framework's
formatter:

```ts
export const versionFormatter = (distribution: Distribution | undefined): CliOutput.Formatter => ({
  ...CliOutput.defaultFormatter({ colors: useColor() }),
  formatVersion: (name: string, version: string): string => {
    const via = distribution === undefined ? "" : ` via ${distribution.name} ${distribution.version}`;
    return `${name} ${version}${via} (engine ${ENGINE_VERSION}, okf ${OKF_SPEC_VERSION}, config-schema ${CONFIG_SCHEMA_VERSION})`;
  },
});
```

(<https://github.com/spencerbeggs/okfit/blob/main/packages/cli/src/internal/versionFormatter.ts>)

Only `formatVersion` is overridden — every other formatter method (help
text, error rendering) stays the framework's own default, so overriding the
version line never risks drifting help or error output from the rest of
the CLI ecosystem.

## MCP and LSP threading

The MCP server threads `distribution` as a plain optional parameter through
its own call chain — `main` → `ServerLayer` → the tool registry → each tool
handler — the same `{ name, version } | undefined` shape at every hop
(<https://github.com/spencerbeggs/okfit/blob/main/packages/mcp/src/server.ts>,
<https://github.com/spencerbeggs/okfit/blob/main/packages/mcp/src/toolkit.ts>).
The LSP server instead puts it in its own startup log line rather than a
structured field:

```ts
: `okfit-lsp ${LSP_VERSION} via ${distribution.name} ${distribution.version}`,
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
