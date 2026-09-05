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
this?", not "is it convenient."

**Two KINDS of member are exceptions by default — do not re-derive them per
service.** These are rules about the member's nature, not a per-service list,
so a member author inherits them:

1. **Infallible bookkeeping members default to an honest no-op, not death.**
   A `refresh()`-shaped member whose live contract is "drop the memoized
   assembly" is genuinely a no-op on a double: a double holds no memo — its
   stubs answer fresh on every call — so `Effect.void` is the *truthful*
   implementation, and dying would fabricate a failure the real contract
   cannot produce. Live spellings: `WorkspaceDiscovery.makeTest`'s `refresh`
   and `refreshIn`, `WorkspaceCatalogs.makeTest`'s `refresh`,
   `LockfileReader.makeTest`'s `refresh` (all in `@effected/workspaces`).
2. **A pure derivation off a supplied primary stub defaults to the real
   derivation, not death.** When the double is handed the primary read, any
   member that is a *total function of it* answers by running the live
   derivation over that value, so the two cannot disagree by construction.
   `WorkspaceCatalogs.makeTest`'s `resolveSpecifier` runs the supplied
   `CatalogSet`'s own `resolveSpecifier` when a `set` override is present —
   and **dies when it is not**, because with no primary there is nothing to
   derive from. `WorkspaceDiscovery.makeTest` derives `importerMap`,
   `getPackage`, `resolveFile`/`resolveFiles` off `listPackages` the same way.

   The boundary is *derivability*, not convenience: `releaseAgeGate` and
   `importerVersions` sit beside `resolveSpecifier` and always die, because
   neither is recoverable from a `CatalogSet` (the gate comes from release-age
   keys and hook contributions, the importer index from lockfile importer
   blocks). Ask "is this member a function of the stub I was given?" — if the
   answer needs data the override does not carry, it dies.

The trap this replaces: the blanket line reads as absolute ("every unstubbed
member dies naming itself"), and the exceptions were only discoverable by
reading *another service's* doc comment, so an author adding a `refresh` to a
third service nearly wired die-on-unstubbed against the house convention
(spencerbeggs/effected#453). The blanket is the default, not the whole rule.

Beyond the two kinds, recorded per-service exceptions, each with its own
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
