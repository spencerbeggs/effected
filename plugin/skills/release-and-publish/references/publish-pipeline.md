# The publish pipeline: registry reads, packing, and the macOS cache hazard

Load when: reading the npm registry, packing and publishing a tarball,
choosing an `NpmExecutor`, or debugging a publish step that fails only on a
macOS runner.

## Reading the registry — `NpmRegistry`

`NpmRegistry` replaces every shelled `npm view` with reads over core
`HttpClient` — no `ChildProcessSpawner`, no `@effected/commands` edge on
this half of the package. Four methods (`version`, `versions`, `distTags`,
`publishTimes`), each taking an **optional, per-call** `RegistryTarget {
registry?, token? }` that defaults `registry` to the public npm registry
(the exported `DEFAULT_REGISTRY` constant):

```ts
import { NpmRegistry } from "@effected/npm";
import { Effect } from "effect";

const check = Effect.gen(function* () {
  const registry = yield* NpmRegistry;
  const published = yield* registry.version("effect", "4.0.0-beta.101");
  // published: Option<PublishedVersion> — None when that version isn't there
});
```

Three facts are load-bearing:

- **The registry is per-call, never layer-baked.** A publish flow can probe
  two registries for one package inside a single program, which a
  layer-scoped registry cannot express — and neither can a test double
  keyed without the registry axis.
- **A 404 is `Option.none()`**, decided on the response status
  structurally, not by matching npm's stderr wording (which changes across
  npm versions without notice). `version` returns `Option<PublishedVersion>`;
  `versions`/`distTags`/`publishTimes` return an empty array/record for an
  absent package rather than failing.
- **`integrity` is typed as this kit's own `IntegrityHash` brand**, not a
  bare string — comparing it against `PackagePublish.pack`'s
  `PackedTarball.integrity` is a typed comparison, not a string-equals-and-hope.

A `github-packages` target reads `version` through the whole packument —
GitHub Packages answers the per-version endpoint with 405 regardless of
credentials, so that classification routes straight to the packument read
and selects the version from it; a 405 from any **other** registry falls
back to the same packument path instead of failing. Absence stays
`Option.none()` either way.

`RegistryReadError` routes on `kind: "transport" | "status" | "decode"` —
never a prose `reason` field to substring-match. `publishTimes` replaces
`npm view <pkg> time --json` — it returns `ReadonlyArray<PublishTime>`
(`{version, publishedAt}`), already excluding the packument's two
non-version `time` keys.

**The doubles:**

- `NpmRegistry.layerTest(overrides?)` — every unstubbed member dies naming
  itself. No honest default exists for a fabricated version list.
- `NpmRegistry.layerSeeded(seed: RegistrySeed)` — a **working** fake, keyed
  `registries[registry][name][version]`. All three axes are load-bearing —
  a double keyed by package name alone can't serve two versions of one
  package, or two registries for one version.

**Migrating a double that wanted a working empty registry: reach for
`layerSeeded`, not `layerTest`.** `NpmRegistry.layerTest()` with no
overrides dies loudly by design on the first unstubbed member — no honest
default exists for a fabricated registry read. `NpmRegistry.layerSeeded({
registries: {} })` is the real, working double whose every lookup answers
"not found" rather than throwing.

## Publishing — `PackagePublish` and `NpmExecutor`

`PackagePublish` runs `npm` through `@effected/commands`' `Run`, over
core's `FileSystem | Crypto | ChildProcessSpawner` plus `@effected/commands`'
`LocalExec`. Members: `setupAuth`, `pack(packageDir, options?: PackOptions)`,
`publishTarball(tarballPath, options: PublishOptions)` (`PublishOptions`
extends `PackOptions`), `dryRun(packageDir, options?: PackOptions)`.

**The auth token goes to a caller-supplied npmrc path, never argv.**
`setupAuth` appends the token in nerf-dart key format to the npmrc path —
trailing slash **required** or the token silently never applies.
**Masking is the caller's job** — `PackagePublish` takes a `Redacted` and
has **no** `ActionOutputs` edge anywhere in its layer requirements; masking
the token in a CI log is deliberately left to the caller, who has an
opinion about log output this package doesn't need.

**`pack` reports two digests and they are not interchangeable:**

| Field | What it is | Compares against |
| --- | --- | --- |
| `integrity` | npm's own sha512 SRI (`IntegrityHash`, optional) | `NpmRegistry.version(...)`'s `integrity` |
| `sha256Hex` | local hex SHA-256 of the tarball's own bytes | the GitHub attestation subject |

`sha256Hex` is computed by reading the packed tarball back off disk and
hashing it — not derived from npm's own report — which is what makes it a
verifiable attestation subject (see `supply-chain-attestation`). Getting
the two swapped is a silent attestation mismatch, not a type error: both
are strings.

`publishTarball` returns `PublishOutcome`, whose one field is
`provenanceUrl?: string | undefined` — a plain optional, not an `Option`:
npm's Sigstore transparency-log URL when it published provenance, scraped
from npm's own output, absent for GitHub Packages, custom registries and
provenance-off runs.

**A failed `dryRun` is a result, not an error** (`DryRunOutcome.ok:
boolean`). `npm pack --dry-run` never contacts a registry, so `ok: true`
means the package packs, **not** that a registry would accept it. The error
channel is reserved for a structural failure — npm could not be spawned, or
its output was unreadable.

`NpmExecutor` replaces repeated `packageManager?: "npm" | "pnpm" | "yarn" |
"bun"` options with one value: `NpmExecutor.ambient` (the runner's own npm
on `PATH`) or `NpmExecutor.dlx("npm@11")` (fetched fresh through the
project launcher). `dlx` runs the fetch through `LocalExec.applyDlx`,
because OIDC trusted publishing needs a newer npm than GitHub-hosted
runners ship by default. **With no project-local launcher, `dlx` fails
typed (`PublishError { kind: "executor" }`) rather than degrading to the
ambient npm** — silently running the bundled npm when the caller explicitly
asked for a pinned one would reintroduce exactly the OIDC failure the pin
exists to avoid, invisibly.

`PublishError` routes on `kind: "auth" | "pack" | "publish" | "output" |
"digest" | "executor"` — no `reason: string` to substring-match. `"digest"`
exists specifically because npm succeeding at `pack` while the tarball
can't be read back for hashing is not "npm pack failed."

Both `PackagePublish` and `NpmExecutor.dlx` need `LocalExec` in `R` — a
single-package checkout (an action) uses `LocalExec.layerFor("npm")` or
`LocalExec.layerNone` and never installs `@effected/workspaces`; a monorepo
consumer uses `Workspaces.localExecLayer()`, which resolves the workspace
root and detects the package manager, then feeds `NpmExecutor` the right
prefixes. See `running-commands-and-tools` for `Run`/`LocalExec` in full.

## Which registry am I talking to — `classifyRegistry`

`classifyRegistry(registry?)` replaces four separate predicates with one
exhaustive classification: `"npm" | "github-packages" | "jsr" | "custom"`.
An absent registry classifies as `"npm"`. **Subdomain matching requires a
leading dot** — a bare suffix match would classify a look-alike hostname as
the public registry, and that classification decides both whether a token
is sent and whether `--provenance` is requested (npm rejects the flag
against GitHub Packages). A canonical display-name helper was dropped on
purpose after two call sites disagreed on the string for the same
input — switch on the `RegistryKind` literal and choose your own words
rather than reintroducing one.

## The macOS npm-cache hazard

GitHub's macOS runner images ship a partly root-owned npm cache
(`~/.npm/_cacache`). `npm pack` reads and writes that cache, and against a
root-owned entry it hard-fails with an unrecoverable permission error — not
a flaky retry candidate, a deterministic failure on every macOS run until
the cache is redirected.

**The redirect must be visible at the publish call site, never an invisible
environment variable.** Set an explicit, package-local cache directory as
part of the same options object that configures the pack/publish call
itself — a global `npm_config_cache` environment variable set once, far
from the call it protects, is exactly the shape of fix that silently stops
protecting anything the day the call site moves or gains a second npm
invocation that doesn't inherit the same environment. Prefer the explicit
override every time this pipeline runs on a macOS runner, not only when a
failure is first observed.
