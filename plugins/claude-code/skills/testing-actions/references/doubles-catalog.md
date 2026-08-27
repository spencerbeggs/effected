# The doubles landscape

Load when: writing a new `makeTest`/`layerTest` pair, deciding whether a
service's double should die or answer on an unstubbed member, or looking
for the doubles/recording-wrapper recipe for a specific service.

## The doubles convention

Every service across `@effected/github-actions`, `@effected/github`,
`@effected/sbom` and `@effected/commands` ships `makeTest(overrides?)` +
`layerTest(overrides?)` (`Layer.succeed(Self, Self.makeTest(overrides))`).
**Every unstubbed member dies, naming itself** — there is no shared
`./testing` subpath, and no whole-service double survives as a bare
`Layer.succeed` of a hand-built object. Run `grep -rl makeTest
node_modules/@effected` for the current set — dozens of services ship the
pair today, far more than any single whole-service double could stand in
for.

**Writing a new double: the death must be LAZY.** The unstubbed default is
a thunk that builds and returns a failing effect when the member is
*called* — never a bare `throw` at definition time. A throw at call time,
while the member is being invoked to *describe* the effect, escapes the
Effect runtime entirely, so a consumer test's exit/flip assertions never
see it and the failure surfaces as a raw thrown error in the wrong place.

The canonical shape stubs the ONE member a test is about and lets the death
of the rest prove the test touches nothing else:

```ts
const recordingOutputs = () => {
  const masked: Array<string> = [];
  const layer = ActionOutputs.layerTest({
    setSecret: (value) =>
      // Effect.suspend: an eager recorder logs calls that were only
      // DESCRIBED, never run.
      Effect.suspend(() => {
        masked.push(value);
        return Effect.void;
      }),
  });
  return { masked, layer };
};
```

Every other member dies naming itself if the test ever reaches one — this
is what a whole-service double hides: reimplementing six members just to
exercise one, instead of stubbing the one that matters and trusting the
rest to die loudly if the test's assumptions are wrong.

## "Dies loudly" is not universal

The admissibility test is "would a real implementation legitimately answer
this?", not "is it convenient." Recorded exceptions, each with its own
reason:

| Service | Default | Why |
| --- | --- | --- |
| `ActionEnvironment.layerTest` | seeds the runner's `GITHUB_*`/`RUNNER_*` variables | one obviously-correct shape, otherwise duplicated across every consumer |
| `ActionLogger.layerTest` | defaults to silent | so a suite doesn't have to stub every log call to avoid a death |
| `DryRun.makeTest` | defaults to rehearsing (`true`) | the safe direction; the members are the real `make(true)`, so the double cannot drift from production logic |
| `LocalExec.makeTest` (`@effected/commands`) | answers `Option.none()` | *is* the honest global-only wiring, not a fabrication |
| `IdentityToken.makeTest` (`@effected/sbom`) | answers a real token | a fabricated OIDC token is a real answer to "give me a token" |
| `SigstoreSigner.makeTest().sign` (`@effected/sbom`) | **dies** | the opposite judgement on the same test: a fabricated bundle is a signature-shaped lie |

`IdentityToken` and `SigstoreSigner` sit on either side of the same line on
purpose — decide new exceptions the same way, by asking whether the
default is a real answer or a fabrication wearing a real answer's shape.

## Some doubles run the real engine on purpose

- **`BlobStore.layerMemory`** is not a stub: it runs the real
  `BlobEnvelope` framing on `put`/`get`, so a round trip through it proves
  metadata survives storage rather than asserting the double's own echo.
  Reach for `layerTest` only when the test is about the service boundary
  itself, not the framing.
- **`OidcTokenIssuer.layerFor(claims)`** returns a **real, decodable**
  unsigned JWT built from the same claims the double reports — the token
  and claims accessors cannot disagree. A synthetic non-JWT double would
  make every consumer's decode step yield nothing and silently skip the
  path under test.
- **`@effected/github`'s fixture double shares the live pagination
  engine** — a narrow, recorded exception to "never reimplement a double":
  the live client, the fixture double, and the one custom page source in
  the package all build a page source and hand it to the same walk.

## `ActionInput` injection without touching `process.env`

`ActionInput.layer(env?)` installs a record-backed `ConfigProvider`
reference — never write to `process.env` in a test to fake an input. Point
at `actions-inputs-outputs` for the full `INPUT_` mangling contract this
protects.
