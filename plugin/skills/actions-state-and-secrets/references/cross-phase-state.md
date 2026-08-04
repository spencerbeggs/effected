# `ActionState`, state vs. outputs, and failure discipline

## `ActionState`: the phase-boundary service

```ts
export interface ActionStateShape {
  readonly save: <A, I>(key: string, value: A, schema: Schema.Codec<A, I>) => Effect.Effect<void, ActionStateError>;
  readonly get: <A, I>(key: string, schema: Schema.Codec<A, I>) => Effect.Effect<A, ActionStateError>;
  readonly getOptional: <A, I>(
    key: string,
    schema: Schema.Codec<A, I>,
  ) => Effect.Effect<Option.Option<A>, ActionStateError>;
  readonly saveSecret: (key: string, secret: string) => Effect.Effect<void, ActionStateError>;
}
```

`save`/`get`/`getOptional` round-trip an ordinary `Schema.Class` bundle:
`save` encodes with the caller's schema, `JSON.stringify`s the result, and
appends a delimited block to the file at `GITHUB_STATE`; `get`/`getOptional`
read the republished `STATE_<key>` variable, `JSON.parse` it, and decode it
back through the same schema. `get` fails `{ reason: "missing" }` when the
key was never saved; `getOptional` reports that as `Option.none()` instead —
reach for `getOptional` at exactly the call sites where "an earlier phase
didn't run" is a normal outcome, not a bug (`GitHubToken.dispose` is the
worked example, below).

**Design every state field's encoded form as plain JSON —
`Schema.OptionFromNullOr`, never `Schema.Option`.** An `Option` field's
encoded form under `Schema.Option` is an `Option` *instance*, not a JSON
primitive; `JSON.stringify` serializes it through its own `toJSON` into a
shape the matching decode then rejects. The failure lands one phase later
than the mistake: `save` in `main` reports success, and `get`/`getOptional`
in `post` cannot decode the value it wrote. `save` also catches the general
"not plain JSON" case at write time — it proves the encoded form survives
`JSON.stringify`/`parse` and fails typed (`reason: "notPlainJson"`, naming
the key) rather than leaving a `malformed` mystery for the later phase — but
the fix at design time is still cheaper: pick `Schema.OptionFromNullOr` for
every optional field in a state bundle from the start.

**Only `saveSecret` masks — `save` does not, and the distinction is the
whole API surface for choosing between them:**

```ts
saveSecret: (key: string, secret: string) =>
  // Mask first, then persist. The ordering is the guarantee.
  Effect.flatMap(outputs.setSecret(secret), () => write(key, JSON.stringify(secret))),
```

`GITHUB_STATE` is plaintext by GitHub's protocol, so masking is the only
defense a persisted secret gets — and coupling the mask to the write is
what makes it unforgettable. Call `saveSecret` for anything that came from
a `Redacted`, ever; call plain `save` for everything else. There is no
third option and no flag on `save` to opt into masking — a value either is
a secret (`saveSecret`) or it is not (`save`).

**Runner-file delimiters are derived, never random**, the same discipline
`ActionOutputs` uses: a block delimiter is extended until it's absent from
the serialized value, making a collision impossible rather than merely
improbable. A value containing the delimiter would otherwise terminate its
own block early — a value-controlled injection into the runner's own file.

## State vs. outputs: who reads it decides

`ActionState` and `ActionOutputs` solve different problems and the choice
is mechanical, not stylistic:

| | Crosses | Consumed by | Persists past the run |
| --- | --- | --- | --- |
| `ActionState` | `pre` → `main` → `post` (same job) | a later phase of the **same** action | no |
| `ActionOutputs` (`with:` outputs) | one step → a later step | **another step**, possibly a different action | no |

A value a later phase of *this* action needs back — a provisioned token, a
detached child's pid, a temp directory it created — is `ActionState`. A
value the workflow author wired into `steps.<id>.outputs.<name>` for a
downstream step is `ActionOutputs`. `GitHubToken.provision` is the worked
example: it calls `ActionState.saveSecret` so `main` can rebuild the
client, never an output, because a provisioned installation token has no
business appearing in a workflow's YAML.

## `DryRun`: the safe default

`DryRun.guard(label, effect, fallback)` runs `effect` for real, or logs
`[DRY-RUN] ${label}` and returns `fallback` instead. The fallback is
**required**, not optional — a mutation whose result the caller uses must
say what a rehearsal produces in its place, and the type is where that
gets forced rather than left to a convention. `DryRun.layer` reads the
`dry-run` action input as a `Config`-backed boolean and defaults to `false`
(a real run) when the input is absent — but fails typed on a present,
malformed value (`dry-run: yes` is not a YAML 1.2 core-schema boolean)
rather than silently defaulting. That failure mode is exactly the
`Config.withDefault` trap `actions-inputs-outputs` documents, and
`DryRun`'s own test is what catches a regression of it.

`DryRun`'s test double defaults to `isDryRun: true` — the safe direction —
rather than dying on an unstubbed use: a test that forgot to pick a mode
gets the mode that mutates nothing, not a fabricated answer to a question
nobody asked. It's one of a small, recorded set of exceptions to this
package's usual "unstubbed members die loudly" rule, made deliberately in
the safe direction.

## Failure discipline before `Action.run` ever sees a `Cause`

`Action.run` is the **only** place that renders a top-level failure, and it
does that once, consistently — see `actions-runtime`'s failure-rendering
reference for the mechanics. This section covers what happens upstream of
that, inside a package's own error channels, before a `Cause` ever reaches
`Action.run`.

**Demote vs. die is a call each error channel makes for itself, not
`Action.run`.** `GitHubToken.provision`'s identity-resolution degrades a
transient identity-lookup hiccup to a logged warning and a token without
identity fields, rather than failing the whole action over a cosmetic
lookup — that decision lives in `GitHubToken`, before the failure (if any)
ever reaches `Action.run`. By the time a `Cause` reaches `Action.run`, the
decision to fail has already been made upstream; `Action.run`'s job is only
to render it once, consistently, and set the exit code the runner reads.

**Post-phase belt-and-braces: a `post` phase must not turn a green run
red.** `GitHubToken.dispose` reads its persisted token with
`ActionState.getOptional` rather than `get`, specifically so that a `post`
running with no matching `pre` — a workflow that never provisioned a token
— is a no-op, not a `missing`-state failure. `dispose` also skips revoking
an already-expired token: GitHub has already stopped accepting it, so the
revoke request could only turn a *successful* run into a *failed* one on
the way out, for no security benefit.

**Audit every ported error channel for whether it can actually fire.** A
pure body wrapped in a try/catch whose catch arm is structurally
unreachable is dead code masquerading as a real failure mode. A channel
that cannot fire is worse than no channel: it forces every caller to
handle a case that doesn't exist, and it makes the type a documented lie.
When porting a member from a legacy implementation, either demonstrate the
failure path with a test, or delete the reason from the signature. An
input-validation error channel replaced entirely by `Config.ConfigError`
is the clearest instance of this discipline in the wild: once `Config`
owns the failure mode, a standalone error type for the same case has
nothing left to guard and no reason to exist.
