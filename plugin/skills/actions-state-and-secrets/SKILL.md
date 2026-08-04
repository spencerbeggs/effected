---
name: actions-state-and-secrets
description: Use when persisting values across an Action's pre/main/post phase boundary, handling a Redacted secret anywhere in @effected/github-actions, deciding whether a value belongs in ActionState or ActionOutputs, framing a blob with metadata for the cache or an S3-compatible store, reaping a detached child by a pid that round-tripped through GITHUB_STATE, or rendering an Action's top-level failure. Covers ActionState.save/get/saveSecret, the BlobEnvelope wire format, Secret's declassification seam (forChildEnv/forRunnerFile/forSigning/adopt), the structural no-Redacted.value scan, DryRun, Action.run's failure rendering, and the DetachedProcess bare-pid guard.
---

# Actions state and secrets

Everything in `@effected/github-actions` that crosses a phase boundary, or
that must not leak. Each phase (`pre`/`main`/`post`) is a **separate process**;
GitHub's own mechanism for carrying a value between them is a write-only file
(`GITHUB_STATE`) whose entries the runner republishes to the next phase as
`STATE_<key>` environment variables. That asymmetry — write through a file,
read through the environment — is why `ActionState` is a service rather than a
pair of helper functions.

For general Effect v4 service/layer shape, typed errors, `Cause`, and `Scope`,
see `effect-v4-services-layers`, `effect-v4-idioms`, `effect-v4-schema`. This
skill carries only the Actions-specific instance of those rules.

## `ActionState`: the phase-boundary service

`packages/github-actions/src/ActionState.ts:38-57` (`ActionStateShape`):

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
back through the same schema (`ActionState.ts:60-113`). `get` fails
`{ reason: "missing" }` when the key was never saved; `getOptional` reports
that as `Option.none()` instead — reach for `getOptional` at exactly the call
sites where "an earlier phase didn't run" is a normal outcome, not a bug (see
`GitHubToken.dispose`, below).

**Only `saveSecret` masks — `save` does not, and the distinction is the whole
API surface for choosing between them.** Verified at `ActionState.ts:114-116`:

```ts
saveSecret: (key: string, secret: string) =>
 // Mask first, then persist. The ordering is the guarantee.
 Effect.flatMap(outputs.setSecret(secret), () => write(key, JSON.stringify(secret))),
```

`GITHUB_STATE` is plaintext by GitHub's protocol, so masking is the only
defense a persisted secret gets — and coupling the mask to the write is what
makes it unforgettable. Call `saveSecret` for anything that came from a
`Redacted`, ever; call plain `save` for everything else. There is no third
option and no flag on `save` to opt into masking — a value either is a secret
(`saveSecret`) or it is not (`save`).

**Runner-file delimiters are derived, never random.** `ActionState.ts:74-77`
extends `EFFECTED_EOF` with `_` until it is absent from the serialized value,
making a delimiter collision impossible rather than merely improbable —
`ActionOutputs` uses the same discipline for the same reason. A value
containing the delimiter would otherwise terminate its own block early: a
value-controlled injection into the runner's own file.

## State vs. outputs: who reads it decides

`ActionState` and `ActionOutputs` solve different problems and the choice is
mechanical, not stylistic:

| | Crosses | Consumed by | Persists past the run |
| --- | --- | --- | --- |
| `ActionState` | `pre` → `main` → `post` (same job) | a later phase of the **same** action | no |
| `ActionOutputs` (`with:` outputs) | one step → a later step | **another step**, possibly a different action | no |

A value a later phase of *this* action needs back — a provisioned token, a
detached child's pid, a temp directory it created — is `ActionState`. A value
the workflow author wired into `steps.<id>.outputs.<name>` for a downstream
step is `ActionOutputs`. `GitHubToken.provision` is the worked example:
it calls `ActionState.saveSecret` so `main` can rebuild the client, never an
output, because a provisioned installation token has no business appearing in
a workflow's YAML.

## `BlobEnvelope`: the schema-versioned frame

Cache and blob-store payloads get a metadata channel that raw bytes don't
have. `BlobEnvelope.ts` is deliberately **pure**: no IO, no service, just
`Result`-returning encode/decode over a byte array (`BlobEnvelope.ts:91-146`).
The storage services that put bytes behind this frame — `ActionCache`,
`BlobStore`, `GitHubCacheBlobStore` — belong to `actions-cache-and-artifacts`;
this skill covers only the frame's shape and its failure modes.

Wire layout (`BlobEnvelope.ts:56-62`):

```text
[4B magic "EFBS"][1B version][4B metadata length, big-endian][metadata JSON][body]
```

`MAGIC` is `0x45 0x46 0x42 0x53` — the ASCII bytes for `EFBS`, **not** `EBS1`
as an earlier design draft had it (`BlobEnvelope.ts:46`). A version digit
folded into the magic would be a second version channel that can disagree
with the real one; the magic identifies the frame *family*, the version byte
identifies the *revision*.

The failure union (`BlobEnvelope.ts:18-24`) is sized to what a caller actually
branches on:

| `reason` | Fires when |
| --- | --- |
| `notAnEnvelope` | The 4-byte magic is absent — a legacy, unframed blob, or garbage |
| `unsupportedVersion` | The version byte doesn't match what this build writes |
| `truncated` | The buffer ends mid-header or mid-metadata |
| `metadataDecodeFailed` | The framed metadata JSON doesn't satisfy the caller's schema |
| `metadataEncodeFailed` | The value being stored doesn't satisfy the schema on the way out |

**A legacy raw blob decodes as a typed `notAnEnvelope` clean miss, on
purpose.** A consumer migrating an existing cache from a hand-rolled binary
frame to this envelope gets a decode failure it can treat as "not cached
yet," not a corrupt read of garbage metadata — the magic check runs before
anything else in `decodeResult` (`BlobEnvelope.ts:115-117`). **The version
lives in the blob, not in the key**: a format revision is detected on read
(`unsupportedVersion`) and reported typed, so keys stay stable across
revisions and stale entries simply age out rather than needing a `v2/`
namespace prefix hand-rolled by the caller.

The decoded body is `bytes.slice(...)`, not `subarray` (`BlobEnvelope.ts:144`)
— it must not alias the frame's own buffer, or a caller mutating the returned
body would corrupt the envelope it was read from.

## Secrets: `Secret.ts` is the only place one becomes a string

`Secret.ts` is the declassification seam. `Redacted.value` appears **nowhere
else** in `packages/github-actions/src/`, and `__test__/Secret.test.ts`
asserts that structurally (below). Masking and declassifying are the *same
call* — every member registers the plaintext with the runner's log filter via
`ActionOutputs.setSecret` before returning it — so plaintext cannot leave this
module without the runner already knowing to redact it from logs.

```ts
export class Secret {
 static readonly forChildEnv: (
  entries: Readonly<Record<string, Redacted.Redacted<string>>>,
 ) => Effect.Effect<Record<string, string>, never, ActionOutputs>;
 static readonly forRunnerFile: (secret: Redacted.Redacted<string>) => Effect.Effect<string, never, ActionOutputs>;
 static readonly forSigning: (secret: Redacted.Redacted<string>) => Effect.Effect<string, never, ActionOutputs>;
 static readonly adopt: (name: string) => Config.Config<Redacted.Redacted<string>>;
}
```

(`Secret.ts:53-110`.) Four members, one seam:

- **`forChildEnv`** — declassify a whole set for a detached child's
  environment. Masks every entry before any plaintext is returned, including
  when one entry's masking would otherwise race the caller reading a partial
  record (`Secret.ts:56-65`).
- **`forRunnerFile`** — declassify one secret for `GITHUB_STATE` or
  `GITHUB_OUTPUT`. Both are plaintext by GitHub's protocol regardless; the
  mask is the only defense available (`Secret.ts:74-80`).
- **`forSigning`** — declassify one secret for an in-process use that needs
  raw bytes, e.g. an HMAC. It is `forRunnerFile` under a different name
  (`Secret.ts:99-100`) — same mask-then-return contract, distinct only in
  *why* the caller needed a string.
- **`adopt`** — the far side of a handoff: re-wrap a plaintext environment
  variable as `Redacted` via `Config.redacted`. A `Config`, so a missing or
  empty handoff is an honest `ConfigError` naming the variable, rather than an
  empty `Redacted` that fails much later as an opaque authentication error
  (`Secret.ts:110`).

**When you hit a third real need for a raw secret, add a member here rather
than granting an exception to the structural test.** `forSigning` is the
worked example: the SigV4 signer needs the raw key for its HMAC chain, and
the fix was one line reusing `forRunnerFile`'s mask-then-return shape, called
once at layer construction (not per request — masking is idempotent, but a
workflow command per request is log noise). This has caught two real leaks:
`OidcTokenIssuer.claims` originally unwrapped its own token to decode it, and
was restructured into a private `issue()` that returns the raw JWT once, with
`token`/`claims` both reading from that single unwrap rather than each
calling `Redacted.value` independently.

### The v4 fact that keeps this seam small

`HttpClientRequest.bearerToken` accepts a `Redacted` **directly** — verified
at `.repos/effect/packages/effect/src/unstable/http/HttpClientRequest.ts:362-369`:

```ts
export const bearerToken: {
 (token: string | Redacted.Redacted): (self: HttpClientRequest) => HttpClientRequest
 (self: HttpClientRequest, token: string | Redacted.Redacted): HttpClientRequest
} = dual(
 2,
 (self: HttpClientRequest, token: string | Redacted.Redacted): HttpClientRequest =>
  setHeader(self, "Authorization", `Bearer ${stringOrRedacted(token)}`)
)
```

A runtime token (the Actions-results `ACTIONS_RUNTIME_TOKEN`, an installation
token) flows straight from a `Redacted` read into request construction with
**no declassification step at all**. That's why the results-backend services
(`ActionCache`, `Artifact`, the GitHub-cache `BlobStore`) never need a
`Secret` member for their bearer token — the seam only grows when a consumer
needs the *string*, not merely to authenticate an HTTP request with it.

### The structural scan, and its own failure mode

`__test__/Secret.test.ts` walks every `.ts` file under `src/` and asserts
`Redacted.value` appears in exactly one of them:

```ts
it("only Secret.ts unwraps a Redacted", () => {
 assert.deepStrictEqual(unwrappingModules(), ["Secret.ts"]);
});
```

**It strips comments before scanning, and the stripping order is
line-comments-then-blocks** (`Secret.test.ts:129`):

```ts
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
```

A raw text scan reads TSDoc as code — a module whose comment *explains* that
it does **not** call `Redacted.value` gets reported as calling it, purely for
mentioning the token. That happened for real: `OidcTokenIssuer` documented
the invariant it obeys and failed the test for saying so. Reversing the
stripping order compounds the failure rather than fixing it: prose containing
a `/*`-shaped substring inside a stripped line comment opens a block comment
as far as the regex engine is concerned, silently eating real code that
follows. **This fails in the safe direction for a `notInclude`-shaped check
and the dangerous one for an `include`-shaped check** — a comment mention
that survives stripping makes an `include` assertion (like this one) pass on
a phantom hit, which is exactly backwards from what the test exists to catch.
The stripper therefore earns its own discriminating test
(`Secret.test.ts:164-169`): a comment mentioning `Redacted.value` must
vanish, a real call in a line comment must survive. For the general anatomy
of a structural source scan (why it needs a control asserting the set is
non-empty, and how each failure mode maps to include vs. notInclude), see
`effect-v4-testing`; this is only the one instance.

## `Redaction`: the kit-wide policy, one level up

`@effected/commands`' `packages/commands/src/Redaction.ts` is the home for
*value-based* scrubbing of argv and captured command output — `Redaction.apply`
/ `applyArgs` replace every occurrence of a declared `Redacted` value with
`***`, longest value first so a short secret can't rewrite a longer one into
a leaking fragment (`Redaction.ts:44-49`); `scrubArgs` is a flag-name
heuristic backstop for secrets a caller forgot to declare. Span annotations
built from a `Redacted` carry **stable identifiers only** — `key`, `tool`,
`pid`, `name` — never a value: the observability standard this package
follows names a span annotation as one of the easiest unaudited leak paths
for exactly this reason. See `running-commands-and-tools` for `Redaction`'s
full surface; this skill only names where it lives and how it composes with
`Secret`.

**The honest limit: a `Redacted` cannot survive serialization, by design.**
`Secret.forChildEnv` and `.forRunnerFile` do not try to make a secret
serializable — a child process reading its environment, or `GITHUB_STATE` as
a plaintext file, are boundaries that only ever carry strings. The design
does not encrypt the handoff either: the child runs on the same runner, as
the same user, as the parent, so an encryption key would have to travel the
same channel as the secret it protects — ceremony with no security payoff.
What the package actually does about the degradation is make it explicit,
one-way, and structurally cornered into one module, not prevent it.

## `DryRun`: the safe default

`DryRun.guard(label, effect, fallback)` runs `effect` for real, or logs
`[DRY-RUN] ${label}` and returns `fallback` instead (`DryRun.ts:31-35`). The
fallback is **required**, not optional — a mutation whose result the caller
uses must say what a rehearsal produces in its place, and the type is where
that gets forced rather than left to a convention. `DryRun.layer` reads the
`dry-run` action input as a `Config`-backed boolean and defaults to `false`
(a real run) when the input is absent — but fails typed on a present,
malformed value (`dry-run: yes` is not a YAML 1.2 core-schema boolean) rather
than silently defaulting. That failure mode is exactly the `Config.withDefault`
trap below, and `DryRun`'s own test is what catches a regression of it.

`DryRun.makeTest` is one of the package's three recorded exceptions to
"unstubbed members die": it defaults to `isDryRun: true`, **the safe
direction** — a test that forgot to pick a mode gets the mode that mutates
nothing, not a fabricated answer to a question nobody asked. (The other two
exceptions — `ActionEnvironmentTest` seeding the twelve `GITHUB_*` variables,
`ActionLoggerTest` defaulting to silent — belong to `actions-runtime` and
`actions-inputs-outputs`; named here only so a reader doesn't wonder if they
exist.)

## Failure: what this package's error channels decide before `Action.run` ever sees them

`Action.run` is the **only** place that renders a top-level failure, and it
does that once, consistently, from `describeCause`/`describeError` and the
`::error::`/`::debug::` rendering-depth split — see `actions-runtime` for the
mechanics; this section covers only what happens upstream of that, inside
this package's own error channels, before a `Cause` ever reaches `Action.run`.

**Demote vs. die is a call each error channel makes for itself, not
`Action.run`.** `GitHubToken.provision`'s identity-resolution degrades a
`GET /app` hiccup to a logged warning and a token without identity fields,
rather than failing the whole action over a cosmetic lookup — that decision
lives in `GitHubToken`, before the failure (if any) ever reaches `Action.run`.
By the time a `Cause` reaches `Action.run`, the decision to fail has already
been made upstream; `Action.run`'s job is only to render it once, consistently,
and set the exit code the runner reads.

**Post-phase belt-and-braces: a `post` phase must not turn a green run red.**
`GitHubToken.dispose` reads its persisted token with `ActionState.getOptional`
rather than `get`, specifically so that a `post` running with no matching
`pre` — a workflow that never provisioned a token — is a no-op, not a
`missing`-state failure. `dispose` also skips revoking an already-expired
token: GitHub has already stopped accepting it, so the revoke request could
only turn a *successful* run into a *failed* one on the way out, for no
security benefit.

**Audit every ported error channel for whether it can actually fire.** The
design doc records that the source package had at least two error channels
that were structurally unreachable — a pure body wrapped in `Effect.try`, so
the `catch` arm was dead code masquerading as a real failure mode. A channel
that cannot fire is worse than no channel: it forces every caller to handle a
case that doesn't exist, and it makes the type a documented lie. Three real
deletions in this program: `ActionInputError` (inputs are `Config`-backed now,
so input failures are `ConfigError`), and at least two more in the source
package's audit. When you port a member, either demonstrate the failure path
with a test — the way `DetachedProcess.reap`'s `signalFailed` has a fixture
throwing `EPERM` — or delete the reason from the signature.

## The reap guard: a guard only a well-typed caller can trip is not a guard

`DetachedProcess.reap` takes a **plain `number`**, not the branded
`ProcessId`, and that's deliberate (`DetachedProcess.ts:267-271`):

```ts
static readonly reap = Effect.fn("DetachedProcess.reap")(function* (pid: number, signal: NodeJS.Signals = "SIGTERM") {
 yield* Effect.annotateCurrentSpan({ pid });
 if (!Number.isInteger(pid) || pid <= 0) {
  return yield* Effect.fail(new DetachedProcessError({ reason: "invalidPid", pid }));
 }
 return yield* Effect.suspend(() => {
  try {
   process.kill(pid, signal);
   return Effect.succeed(true);
  } catch (cause) {
   return isErrno(cause, "ESRCH") ? Effect.succeed(false) : Effect.fail(new DetachedProcessError({ reason: "signalFailed", pid, cause }));
  }
 });
});
```

The value arrives as **text**, read back out of `GITHUB_STATE` by a `post`
phase that holds no `ChildProcess` handle to the child it started in `main`
— the type system stopped applying the moment the pid crossed that process
boundary, so a parameter typed `ProcessId` would only prove the guard exists
for callers careful enough not to need it. `process.kill(0, …)` signals the
caller's **entire process group**; `process.kill(-1, …)` signals **every
process the runner's user owns**. An absent state key, a truncated file, or
`Number("")` all decode to `0` — the exact value most likely to arrive
unguarded — so on a GitHub runner, an unguarded reap of a bad pid takes down
the job that's running it, not just the child.

`__test__/DetachedProcess.test.ts:55-71` is the test that proves the guard,
and the assertion that matters is on the **spy**, not the failure:

```ts
it.effect("refuses pid 0 WITHOUT signalling anything", () =>
 withKillSpy(
  () => true,
  (calls) =>
   Effect.gen(function* () {
    const error = yield* Effect.flip(DetachedProcess.reap(0));
    assert.instanceOf(error, DetachedProcessError);
    assert.strictEqual(error.reason, "invalidPid");
    assert.lengthOf(calls, 0, "process.kill must not have been called at all");
   }),
 ),
);
```

A test that only checked the effect failed would pass against an
implementation that signalled the whole group and *then* reported the error
— exactly the bug this guard exists to prevent. `Secret.test.ts:98-109`'s
"the control" pattern repeats here too: a sibling test proves a **positive**
pid *does* reach `process.kill` (`DetachedProcess.test.ts:98-109`), so the
zero-calls assertions above aren't passing because the guard refuses
everything.

**`ProcessId` is the other half**, and it's core's brand, not this package's
own (`DetachedProcess.ts:79-86`):

```ts
export const ProcessId = Schema.Number.pipe(
 Schema.check(
  Schema.makeFilter((value) =>
   Number.isInteger(value) && value > 0 ? undefined : "Expected a positive integer process id",
  ),
 ),
 Schema.brand("ProcessId"),
);
```

It decodes to `ChildProcessSpawner.ProcessId` — the subprocess vocabulary
belongs to core, and this package doesn't get to re-declare it — but core's
own constructor is `Brand.nominal`, which applies **no runtime check**:
`ChildProcessSpawner.ProcessId(0)` succeeds. That's exactly right for a pid
the spawner just produced (the OS handed it back, there's nothing to
validate) and exactly wrong for one that's been through a text file. This
schema is the missing validating constructor, refusing the bad value **on
the way out of `ActionState`** — before it can ever reach `reap` — so the
runtime guard in `reap` is the second of two defenses, not the only one.

## Where the rest of this territory lives

Name these by, don't restate their contents:

- `actions-cache-and-artifacts` — the `BlobStore`/`ActionCache`/`Artifact`
  storage services that put bytes behind `BlobEnvelope`'s frame.
- `actions-runtime` — `ActionEnvironment`, `ActionRuntime`, `Action.run`'s
  composition (as opposed to its failure rendering, covered here).
- `actions-inputs-outputs` — `ActionInput`, `ActionOutputs`, `ActionLogger`.
- `running-commands-and-tools` — `@effected/commands`' `Redaction` in full,
  `Run`, `ToolDiscovery`.
- `github-app-tokens` — `GitHubToken`'s member-usage contract and the
  one-hour installation-token lifecycle in depth (this skill only cites it
  for `ActionState.saveSecret` and `getOptional` usage examples).
- `testing-actions` — the package's test doubles, the two-latch
  interleaving requirement, and the `acquireUseRelease`-for-spies pattern
  this skill's `withKillSpy` example depends on.
