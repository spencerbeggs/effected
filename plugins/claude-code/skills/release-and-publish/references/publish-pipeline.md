# The publish pipeline: registry reads, packing, and the macOS cache hazard

Load when: reading the npm registry, packing and publishing a tarball,
choosing an `NpmExecutor`, or debugging a publish step that fails only on a
macOS runner.

## Reading the registry — `NpmRegistry`

`NpmRegistry` replaces every shelled `npm view` with reads over core
`HttpClient` — no `ChildProcessSpawner`, no `@effected/commands` edge on
this half of the package. Four methods (`version`, `versions`, `distTags`,
`publishTimes`), each taking an **optional, per-call** `RegistryTarget {
registry?, credential? }` that defaults `registry` to the public npm registry
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

## Reading a published tarball back — `PackageTarball`

`PackageTarball.extract(published: PublishedVersion)` →
`Effect<string, TarballError, Scope>` — downloads one published version,
**verifies it against the integrity the registry published**, unpacks it, and
answers the directory its `package/` root landed in. The natural
post-publish check ("did the tarball we shipped actually contain the files we
think?") without shelling out to `npm pack`/`tar` yourself.

- **It is `Scope`d, not owned.** The temp directory is removed when the calling
  scope closes — read what you need inside the scope and never write cleanup.
- Its input is a `PublishedVersion`, so it composes straight off
  `NpmRegistry.version(...)`; the integrity check reuses the same
  `IntegrityHash` brand rather than a string compare.
- `TarballError` routes on `reason: "notFound" | "http" | "integrityMismatch"
  | "extractFailed"` — a closed literal set, so it is routable like the `kind`
  fields elsewhere here, not prose to substring-match. `integrityMismatch`
  carries `expected`/`actual`.
- Needs `FileSystem`, `Crypto`, `HttpClient` and `ChildProcessSpawner` in `R` —
  more than the rest of this pipeline, because it writes to disk and unpacks.

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

**The credential goes to a caller-supplied npmrc path, never argv.**
`setupAuth({ registry, credential, npmrcPath })` appends it in nerf-dart key
format — trailing slash **required** or the entry silently never applies.

**Auth is a `RegistryCredential`, and it is the SAME union on both halves of
the package** — the read probe's `RegistryTarget.credential` and
`setupAuth`'s `credential`:

- `{ kind: "token", token }` writes `_authToken` and probes with `Bearer`;
- `{ kind: "basic", encoded }` writes `_auth` and probes with `Basic`.

The basic arm holds the **already-encoded** blob rather than a
username/password pair, because npm assigns an `_auth` value straight to the
`Authorization` header with no decode step, and registry configuration in
the wild already stores one. `basicCredentialFromPair(username, password)`
is the convenience on top; it throws a `RangeError` on a colon in the
username rather than minting a credential that re-splits on the server.

One union on both halves is load-bearing: a probe and a publish that
disagreed about the scheme would authenticate differently against one
registry, and a 401 read by `NpmRegistry.version` becomes "not published" —
which makes a publish flow republish.

`RegistryTarget.token` still exists for one minor, typed **`never`**, as a
deprecated tripwire. Do not treat it as an alias — it cannot be passed. It
is retained because deleting it would be a *silent* break: callers pass it
through a conditional spread, and a spread of a no-longer-known property is
not an excess-property error, so the field would simply vanish and an
authenticated probe would become an anonymous one.

**Masking is the caller's job** — `PackagePublish` takes a `Redacted` and
has **no** `ActionOutputs` edge anywhere in its layer requirements; masking
the credential in a CI log is deliberately left to the caller, who has an
opinion about log output this package doesn't need.

## Reading a published package back

`NpmRegistry` reads metadata and `PackagePublish` sends a tarball out. **`PackageTarball` is the inbound half** — fetch, verify and extract a published tarball — and it exists for the case that has no other answer: reading something out of a published package **before any install has run**, which is what a tool reproducing a package manager's config-dependency workflow must do, since its output is the input the install then consumes.

```ts
import { NpmRegistry, PackageTarball } from "@effected/npm";
import { resolveEntryPoint } from "@effected/package-json";
import { Effect, Option, Result } from "effect";

const read = Effect.gen(function* () {
  const registry = yield* NpmRegistry;
  const tarball = yield* PackageTarball;
  const found = yield* registry.version("some-config", "1.2.3");
  if (Option.isNone(found)) return Option.none();
  const dir = yield* tarball.extract(found.value); // scoped: removed with the scope
  const manifest = /* read `${dir}/package.json` */ {} as Record<string, unknown>;
  return Option.some(resolveEntryPoint(manifest));
}).pipe(Effect.scoped);
```

Four properties are load-bearing:

- **It is SCOPED.** `extract` answers the directory the tarball's `package/` root unpacked into, and the temp directory dies with the calling scope. The caller reads what it needs and never owns the cleanup.
- **Integrity is verified BEFORE extraction**, and a non-2xx is caught before anything reaches disk. A poisoned intermediary's bytes must never reach `tar`; and a 404 body piped to `tar` surfaces as a misleading "could not extract" rather than naming the real failure.
- **`TarballError.reason` is discriminated** — `notFound | http | integrityMismatch | extractFailed` — and the `notFound` split is not cosmetic. A consumer that cannot separate "this version does not exist" from "something went wrong fetching one that does" routes both the same way; one that did exactly that silently downgraded a merge to a lossy algorithm and dropped a user's override on a run that reported success.
- **It shells out to `tar`** through core's `ChildProcessSpawner` rather than taking a tarball-reader dependency. That is a TIER decision: a non-core runtime dependency here would make `@effected/npm` *integrated*, which propagates to `@effected/lockfiles`, which is pure.

**Loading the extracted entry is deliberately not part of this surface.** A kit-level dynamic `import()` of a computed path is compiled into a context module by bundlers, so shipping the loader would hand every bundling consumer that problem with no seam to fix it. Entry *resolution* comes from `@effected/package-json`'s `resolveEntryPoint` — pure, IO-free, and returning a `Result` whose failure names which `exports` shape blocked resolution. Note its deliberate semantic: `exports` **encapsulates** the package, so a present-but-unmatched `exports` fails rather than falling through to `main`.

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
against GitHub Packages).

Three label projections ship alongside it — **do not hand-roll registry
strings any more** (a canonical display-name helper was once dropped after two
call sites disagreed; these three replace it by naming the audience instead of
pretending one string fits all):

- **`registryHost(registry)`** → the bare host, URL-parsed with a
  string-surgery fallback for an unparseable value.
- **`registryShortLabel(registry)`** → `"npm"` / `"github"` / `"jsr"`, else the
  host. For a log-tree row or anywhere a full name will not fit.
- **`registryDisplayName(registry)`** → `"npm"` / `"GitHub Packages"` /
  `"JSR"`, else the host. Human-facing prose. It is the only one of the three
  that accepts `null`/`undefined`/`""`, all of which mean `"npm"`.

Reach for the one matching the audience; switch on the `RegistryKind` literal
only when you need behaviour, not a string.

## The macOS npm-cache hazard

GitHub's macOS runner images ship a partly root-owned npm cache
(`~/.npm/_cacache`). `npm pack` reads and writes that cache, and against a
root-owned entry it hard-fails with an unrecoverable permission error — not
a flaky retry candidate, a deterministic failure on every macOS run until
the cache is redirected.

**The redirect must be visible at the publish call site, never an invisible
environment variable.** `NpmExecutor.withCacheDir(dir)` is that fix, typed:
a copy of the executor that passes `--cache <dir>` on every invocation, so the
redirect travels with the value the call site already names.

```ts
const executor = NpmExecutor.dlx("npm@11").withCacheDir(`${runnerTemp}/npm-cache`);
```

A global `npm_config_cache` set once, far from the call it protects, is exactly
the shape of fix that silently stops protecting anything the day the call site
moves or gains a second npm invocation that doesn't inherit the same
environment. Prefer the explicit override every time this pipeline runs on a
macOS runner, not only when a failure is first observed.

**`withCacheDir` is deliberately dumb — it reads no environment**, so it also
overrides a self-hosted runner deliberately pointed at a warmed cache. The
unconditional call is the one that silently wins: a caller wanting "redirect
only if nothing else is configured" makes that check itself (e.g. apply it only
when `npm_config_cache` is unset).

**`NpmExecutor.withExtraArgs(args)`** is the generic vent for a flag this
package has not named (`--loglevel`, `--ignore-scripts`, a registry-specific
option), appended after `--cache` when one is set. It **replaces** previously
set extra args rather than accumulating, so each copy is a complete statement
of its own flags. Prefer `withCacheDir` for the cache — it is typed,
discoverable, and carries the reason.
