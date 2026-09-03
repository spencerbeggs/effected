# @effected/cli

The boundary layer of an `effect/unstable/cli` program. Four exports, all
presentation: `CliLogger`, `CliRuntime`, `SchemaIssueRenderer`,
`ConfigIssueRenderer`.

**Design doc:** `@../../.claude/design/effected/packages/cli.md` — Load when:
changing the public surface, the logger's stream routing, the failure-reporting
combinator or the renderers. It was written *before* the port and corrected
against what shipping taught, so it carries the reasoning this file only
states. The consumer record behind it is
`@../../.claude/design/effected/consumers/reposets.md` — Load when: weighing a
new request against what the first consumer actually reported.

## The rule that defines scope

**Not a CLI framework.** `effect/unstable/cli` owns parsing, flags, the command
tree and help. If a change here starts to look like parsing, it belongs upstream
or nowhere. No prompts, no spinners — `Prompt` already exists in core.

Tier: **boundary**. No platform package, required or optional. The moment
`@effect/platform-node` appears here the package stops being usable from Bun and
Deno for no benefit.

**Nothing in the kit may depend on this but an application**, same posture as
`app`. The two are siblings, not layers — `app` is the control plane, `cli` the
presentation boundary, and neither imports the other.

## Load-bearing decisions

**`CliLogger` reads `Console.Console` off the fiber.** Not a style choice:
`Logger.make` takes a *synchronous* callback and a `Sink` write is an `Effect`,
so `Stdio` is unreachable from a logger. Writing to `process.stdout` would work
and is what the consumer did first — it drags a platform assumption into a
library and makes the stream split untestable, because asserting it means
stubbing a global inside a runner that writes to those same streams.
`Console.Console` is a `Context.Reference`, so it carries a default, never
appears in `R`, and a test swaps it.

**Compare levels ordinally, never by string equality.**
`LogLevel.isGreaterThanOrEqualTo(logLevel, stderrFrom)` is the test; `logLevel
=== "Error" || logLevel === "Fatal"` hard-codes two names and silently misses
any level above them, including one added upstream. `stderrFrom` defaults to
`"Error"` and the threshold is the option.

**`LogToStderr` is honoured in one direction only.** It can force everything to
stderr; it must never move an error onto stdout. That is the one guarantee this
logger makes and a reference should not be able to revoke it.

**`CliRuntime` is a combinator, not a `runMain`.** The failure it fixes is
*where the report happens*: a platform `runMain` composes its reporting
`tapCause` around the already-provided effect, so the report runs outside your
layers and prints through the default logger on stdout. The fix has to happen
inside the effect. Wrapping `runMain` itself would drag a platform choice into
this package.

**`Runtime.errorReported` has inverted polarity relative to its name.** `false`
is what suppresses the runtime's own report; the marker means "should this be
reported". The intuitive `errorReported: true` — "I have reported it, stay
quiet" — produces exactly the double report it was meant to prevent. The test
for this is written so that flipping the source value **fails**, not so that it
merely records the current one.

**`getErrorExitCode` cannot be used alone to decide a code.** It answers `1`
both for an error marked `1` and for an unmarked one, so an `exitCode` option
would silently override a deliberate `1`. Test for the marker with
`Runtime.errorExitCode in error` to keep "the error chose" distinct from
"nothing chose".

## The optional peer, and the rule that makes it honest

`@effected/config-file` is a `workspace:^` peer with
`peerDependenciesMeta.optional: true`, consumed only by `ConfigIssueRenderer` —
the same arrangement `@effected/markdown` has with `yaml`/`toml`/`jsonc`.

**`ConfigIssueRenderer` must stay a module no other module imports.** An
optional peer whose import is reachable from a shared module is not optional; it
is a crash for every consumer who took the manifest at its word. Shared
rendering lives in `src/internal/format.ts`, which both renderers import and
neither re-exports. The entrypoint re-exporting `ConfigIssueRenderer` is fine.

Verify this with a build, not by reading: every runtime `import` in
`dist/prod/npm/pkg/**/*.js` must be `effect` or a relative path. The `.d.ts`
carries a type-only import of `ConfigValidationError`, which is erased.

## Testing

The whole surface is testable without stubbing globals: provide a capturing
`Console`, run, and assert on what was written **and on which stream**.

The discriminating mutant for `CliLogger` is **route everything to stdout**. A
suite that still passes is asserting on content and not on stream, which is half
a test — `Warn` is the boundary that catches it.

**Drive levels with `References.MinimumLogLevel`, provided as a service.**
`Logger.withMinimumLogLevel` **does not exist on the v4 line** and is the
obvious first reach. `@effect/vitest`, `it.effect`, `assert.*` — never
`expect`.

```bash
pnpm vitest run packages/cli        # from the repo root
pnpm build --filter @effected/cli   # cold; never the raw savvy.build.ts
```
