# Runtime — @effected/github-actions

Child context file for the environment, input, state and logging services. The
rules live in the parent; this file is why they are shaped that way.

**Parent:** [CLAUDE.md](./CLAUDE.md)
**Design depth:** `@../../.claude/design/effected/packages/github-actions-runtime.md`

---

## `ActionEnvironment` owns `process.env`

It reads it **once, at layer construction**, into an immutable map held in a
`Context.Reference`. `withEnv` is therefore fiber-local and parallel-safe, and
`process.env` is never mutated. The source package hand-rolled set/restore and
admitted in a comment that it was not parallel-safe.

The honest cost: a variable exported mid-run by `exportVariable` is not observed
by an already-seeded reader. That matches GitHub's model, where `exportVariable`
targets *subsequent* steps.

`GitHubContext.headRef` (2026-08-02) is an `Option<string>`: outside pull
requests the runner does not merely omit `GITHUB_HEAD_REF`, it may write the
**empty string**, and both spellings of absence decode to `None` — the trap is
in the type, not a call-site check. The derived `branch` accessor owns the
universal fallback (headRef when present, else `refName`), so no consumer
hand-rolls the chain again. Encoded form is `string | null`
(`Schema.OptionFromNullOr`), so an encoded context stays plain JSON.

## No caller ever spells a runner variable name

Inputs go through `ActionInput` (which owns the `INPUT_` mangling — GitHub
uppercases and replaces **spaces**, and leaves **dashes alone**); log
annotations go through `ActionLogger.annotated`. Both exist because a consumer
spelled a name wrong and shipped it. The rule extends to tests (2026-08-02):
`ActionInput.provider`/`layer` dual-accept **input-name keys** (`with:`-block
style, `{"biome-version": "…"}`) and mangle internally — an explicit
`INPUT_`-spelled entry still wins — and `ActionInput.variable(name)` exports the
derivation for the rare test that must spell the variable.

`Action.run` installs `ActionInput.providerOver(ambient)` as the default
`ConfigProvider` (via `ActionInput.layerDefault`, composed into
`ActionRuntime.layer`), so a bare `Config.string("dry-run")` that side-steps the
accessors degrades to the right answer instead of silently taking its default —
a live action shipped that false green. The design doc's earlier "the runtime
does not install a provider" probe is superseded by the 2026-07-25 ruling below
it. Only flat single-segment paths get the `INPUT_` derivation; nested and
numeric paths pass through untouched.

**`list` splits on commas as well as newlines** — the separator is `/[\n,]/`
(`ActionInput.ts:302`), so a single-line `a,b` input is TWO entries, not one.
Neither the member's own summary nor its `@remarks` says so; they describe the
bullet and comment handling only. A reader who takes the docs at face value
will not expect it, and a value that legitimately contains a comma cannot be
passed through `list` at all.

**The `pairs` accessor validates the key always, the value on request**
(2026-08-23). An **empty key** (`=value`, or a bare `=`) is rejected
unconditionally — `{ "": v }` cannot be what a workflow meant, and the damage
lands far from the typo: an empty key became a repository filter matching
nothing, and the run reported zero results with no indication why. An empty
*value* is legitimate (setting a property to `""`), so `requireValue` opts into
rejecting it. Every rejection **names the offending line**.

**Absence is one rule across every accessor**: a missing input and an input set
to `""` are both *missing data*, because the runner writes `""` for an input the
workflow omitted. An **optional** input therefore needs `Config.withDefault` (or
`Config.option`) at the call site, or the read fails outright.

## Runner-file delimiters are derived, never random

`EFFECTED_EOF`, extended with `_` until absent from the value. Collision becomes
**impossible** rather than improbable, needs no `Crypto` in `R`, and is
deterministic under test. A value containing the delimiter would terminate its
block early — a value-controlled injection into the runner's own file.

## `ActionState.save` proves the round trip at save time

It proves the encoded form survives `JSON.stringify`/`parse` and re-decodes,
failing typed (`notPlainJson`, naming the key) instead of leaving a `malformed`
mystery for a later phase — the schema's encoded form must be plain JSON
(`Schema.OptionFromNullOr`, not `Schema.Option`).

## Logging

- `ActionLogger.withBuffer({ onSuccess: "discard" })` discards a success and
  nothing else — failure, defect and interruption all flush, and step debugging
  overrides the discard.
- `ActionLogger.withStep(name, effect, options?)` (2026-08-04) is the
  summary-line composition `withBuffer` alone cannot reach: discard-on-success
  plus **one** info line (`summary`, default `✅ <name>`), and a `❌ <name>`
  header emitted through `Console` — ahead of the flush, and deliberately not a
  second `::error::` beside the one `Action.run` renders. The summary is emitted
  **outside** the buffered region; inside, it would be discarded with the
  transcript it replaces, and a green step would print nothing. It survives step
  debugging. Ported from the legacy `Step.groupStep`, whose shape was
  independently derived wrong three times during one port because `group` +
  `withBuffer` looks like complete parity.

## Errors

**Audit every ported channel for whether it can fire.** The source package has
at least two structurally unreachable ones. When porting a member, either
demonstrate the failure path with a test or delete it from the signature — every
error reason in this package currently has a test that fires it.

`ActionInputError` does not survive: input failures are `ConfigError`.

`ActionOutputError` and `DetachedProcessError` are now **per-reason tagged
unions** (see the parent's non-negotiables): `RunnerFileUnavailableError |
RunnerFileWriteError | InvalidOutputNameError | OutputEncodeError |
DetachedOutputError`, and five likewise for the detached spawner. The names
survive as union aliases, so nothing in the surface moved; what changed is that
"the runner file is not there" and "the output name is invalid" are separately
recoverable — the distinction a `pre`/`post` phase actually acts on.

**`Config.withDefault` reads the *issue*, not the combinator.** An
`InvalidValue` whose `actual` is `None` is classified as *missing data* and
silently defaulted (`Config.ts:304`). This shipped as a real defect — a
malformed `dry-run` input resolved to `false`. Any typed `ConfigError` built
here must carry its `actual`.

---

**Related context:** [CLAUDE.processes.md](./CLAUDE.processes.md) for secrets
and spawning; [CLAUDE.testing.md](./CLAUDE.testing.md) for the doubles that stub
these services.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
