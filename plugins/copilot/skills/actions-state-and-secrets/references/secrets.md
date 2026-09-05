# `Secret`: the only place a `Redacted` becomes a string

`Secret.ts` is the declassification seam. `Redacted.value` appears
**nowhere else** in the package's source, and a structural test asserts
that (see below). Masking and declassifying are the *same call* — every
member registers the plaintext with the runner's log filter via
`ActionOutputs.setSecret` before returning it — so plaintext cannot leave
this module without the runner already knowing to redact it from logs.

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

Four members, one seam:

- **`forChildEnv`** — declassify a whole set for a detached child's
  environment. Masks every entry before any plaintext is returned,
  including when one entry's masking would otherwise race the caller
  reading a partial record. **"A whole set" includes a set of one** — a
  single secret exported as a single process-level environment variable is
  `Secret.forChildEnv({ VAR_NAME: theSecret })`, the same call with a
  one-entry record, not a signal that a narrower member is missing. Reach
  for `forSigning` only when the caller genuinely needs the raw string
  in-process (an HMAC, a signature) rather than an environment entry to
  hand a child.
- **`forRunnerFile`** — declassify one secret for `GITHUB_STATE` or
  `GITHUB_OUTPUT`. Both are plaintext by GitHub's protocol regardless; the
  mask is the only defense available.
- **`forSigning`** — declassify one secret for an in-process use that
  needs raw bytes, e.g. an HMAC. It is `forRunnerFile` under a different
  name — same mask-then-return contract, distinct only in *why* the caller
  needed a string.
- **`adopt`** — the far side of a handoff: re-wrap a plaintext environment
  variable as `Redacted` via `Config.redacted`. A `Config`, so a missing or
  empty handoff is an honest `ConfigError` naming the variable, rather than
  an empty `Redacted` that fails much later as an opaque authentication
  error.

**When a genuine third need for a raw secret shows up, add a member here
rather than granting an exception to the structural test.** A SigV4 signer
needing the raw key for its HMAC chain is the shape of case that earns a
new member — reuse `forRunnerFile`'s mask-then-return contract, called
once at layer construction rather than per request (masking is idempotent,
but a workflow command per request is log noise). This discipline is what
catches leaks like a token-claims reader that unwraps its own `Redacted`
twice instead of once: restructure it into a single private unwrap that
every other member reads from, rather than each caller calling
`Redacted.value` independently.

## The v4 fact that keeps this seam small

`HttpClientRequest.bearerToken` accepts a `Redacted` **directly** — a
runtime token flows straight from a `Redacted` read into request
construction with **no declassification step at all**:

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

That's why the results-backend services (`ActionCache`, `Artifact`, the
GitHub-cache `BlobStore`) never need a `Secret` member for their bearer
token — the seam only grows when a consumer needs the *string*, not merely
to authenticate an HTTP request with it.

## The structural scan, and its own failure mode

A test walks every source file in the package and asserts `Redacted.value`
appears in exactly one of them:

```ts
it("only Secret.ts unwraps a Redacted", () => {
  assert.deepStrictEqual(unwrappingModules(), ["Secret.ts"]);
});
```

**It strips comments before scanning, and the stripping order is
line-comments-then-blocks:**

```ts
// LINE comments first: a `/*`-bearing token in prose (a glob like `src/*`)
// would otherwise open a fake block comment that swallows real code.
const stripComments = (source: string): string =>
  source.replace(/(^|\n)\s*\/\/.*/g, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
```

A raw text scan reads a doc comment as code — a module whose comment
*explains* that it does **not** call `Redacted.value` gets reported as
calling it, purely for mentioning the token. That is a real failure mode,
not a hypothetical: a module documenting the very invariant it obeys can
fail the test for saying so. Reversing the stripping order compounds the
failure rather than fixing it: prose containing a `/*`-shaped substring
inside a stripped line comment opens a block comment as far as the regex
engine is concerned, silently eating real code that follows.

**This fails in the safe direction for a `notInclude`-shaped check and the
dangerous one for an `include`-shaped check** — a comment mention that
survives stripping makes an `include` assertion (like this scan) pass on a
phantom hit, which is exactly backwards from what the test exists to
catch. The stripper therefore earns its own discriminating test: a comment
mentioning `Redacted.value` must vanish under stripping, and a real call
inside a line comment must survive. For the general anatomy of a
structural source scan — why it needs a control asserting the set is
non-empty, and how each failure mode maps to include vs. notInclude — see
`effect-v4-testing`; this is only the one instance.

## `Redaction`: the kit-wide policy, one level up

`@effected/commands`' `Redaction` is the home for *value-based* scrubbing
of argv and captured command output — `Redaction.apply`/`applyArgs` replace
every occurrence of a declared `Redacted` value with `***`, longest value
first so a short secret can't rewrite a longer one into a leaking
fragment; `scrubArgs` is a flag-name heuristic backstop for secrets a
caller forgot to declare. Span annotations built from a `Redacted` carry
**stable identifiers only** — `key`, `tool`, `pid`, `name` — never a value:
a span annotation is one of the easiest unaudited leak paths, and this
package's observability standard names it as exactly that. See
`running-commands-and-tools` for `Redaction`'s full surface; this
reference only names where it lives and how it composes with `Secret`.

**The honest limit: a `Redacted` cannot survive serialization, by
design.** `Secret.forChildEnv` and `.forRunnerFile` do not try to make a
secret serializable — a child process reading its environment, or
`GITHUB_STATE` as a plaintext file, are boundaries that only ever carry
strings. The design does not encrypt the handoff either: the child runs on
the same runner, as the same user, as the parent, so an encryption key
would have to travel the same channel as the secret it protects —
ceremony with no security payoff. What the package actually does about the
degradation is make it explicit, one-way, and structurally cornered into
one module, not prevent it. Audit every channel a secret can leave
through — `forChildEnv`'s environment, `forRunnerFile`'s plaintext file,
`forSigning`'s in-process string — on that basis, not on the assumption
that any one of them is more secure than the others.
