# Upgrade this project to Effect 4.1.1 and the matching `@effected` release

You are moving this repository to Effect `4.1.1`, from `4.0.7` or earlier. This crosses an Effect minor (`4.1.0`) as well as its patch. You are also moving to the `@effected/*` release built on it (effected PR #1168), which carries two bodies of work: the Effect 4.1 port of the kit, and the replacement of the catalog plugin `@effected/pnpm-plugin-effect` with `@effected/pnpm-plugin-effected` (effected #1146).

It is a breaking round. Effect 4.1.0 removes and reshapes APIs your own code may use: the root `Crypto` module is gone, custom `FileSystem` and `Terminal` implementations need new members, `ChildProcess` arguments are typed differently, and `McpServer` registration changed. The kit follows: several packages now require Effect's `Digest` service where they required `Crypto`. The catalog plugin changes name and serves **one** catalog, `effected`, in place of `effect`, `effect:peers`, `effected` and `effected:peers`. And the Effect family is now held to one Effect minor (`~4.1.1`), not a caret.

**Do not install the old plugin's 0.19.1–0.19.3 releases.** They moved the catalog to Effect 4.1 while every published `@effected/*` package was still built on 4.0.7, and that kit dies at import on 4.1 (`does not provide an export named 'Crypto'`). They are deprecated. Move to `@effected/pnpm-plugin-effected` (step 2).

Work in this order:

1. Repin vendored Effect source (step 1), then replace the catalog plugin and reinstall (step 2). The plugin is how you get the new versions: it carries every `@effected/*` version and Effect 4.1.1, so installing it is the whole bump.
2. If your build toolchain loads published `@effected/*` packages built on Effect 4.0.x, bridge it first (step 2.5), or nothing builds.
3. Find the Effect 4.1 changes in your code (step 3) and the kit's (step 4). This round carries no security fixes.
4. Get the build and the full test suite green (step 6).
5. **Only then**, adopt the new surfaces in step 5, clear your tracking tickets (step 7), and align your code on the kit and on Effect (step 8).
6. Run the verification again.

Check every API claim against the **installed** `.d.ts` or the vendored Effect source, never against this document or memory. This ledger names shapes, not exact signatures. Where it states a behaviour, that behaviour was probed on both 4.0.7 and 4.1.1, but your code is the authority on what you depend on: probe before you rely on it.

## Versions in this release

Every package takes a minor. Each one's `effect` peer is now `~4.1.0`.

| Package | From | To |
| --- | --- | --- |
| `@effected/app` | 0.29.1 | 0.30.0 |
| `@effected/cli` | 0.24.1 | 0.25.0 |
| `@effected/commands` | 0.18.0 | 0.19.0 |
| `@effected/config-file` | 0.22.1 | 0.23.0 |
| `@effected/crypto` | 0.3.0 | 0.4.0 |
| `@effected/engine` | 0.10.0 | 0.11.0 |
| `@effected/env` | 0.8.0 | 0.9.0 |
| `@effected/git` | 0.28.0 | 0.29.0 |
| `@effected/github` | 0.26.0 | 0.27.0 |
| `@effected/github-actions` | 0.29.1 | 0.30.0 |
| `@effected/github-commands` | 0.7.0 | 0.8.0 |
| `@effected/github-references` | 0.12.0 | 0.13.0 |
| `@effected/glob` | 0.16.0 | 0.17.0 |
| `@effected/images` | 0.7.0 | 0.8.0 |
| `@effected/jsonc` | 0.21.0 | 0.22.0 |
| `@effected/jsonl` | 0.16.0 | 0.17.0 |
| `@effected/jwt` | 0.7.0 | 0.8.0 |
| `@effected/lockfiles` | 0.20.0 | 0.21.0 |
| `@effected/lsp` | 0.6.0 | 0.7.0 |
| `@effected/markdown` | 0.24.0 | 0.25.0 |
| `@effected/mcp` | 0.11.0 | 0.12.0 |
| `@effected/memfs` | 0.21.0 | 0.22.0 |
| `@effected/npm` | 0.28.0 | 0.29.0 |
| `@effected/oidc` | 0.2.0 | 0.3.0 |
| `@effected/package-json` | 0.27.0 | 0.28.0 |
| `@effected/pnpm-plugin-effected` (replaces `@effected/pnpm-plugin-effect`, continuing its version line) | 0.19.3 | 0.20.0 |
| `@effected/runtimes` | 0.16.2 | 0.17.0 |
| `@effected/sbom` | 0.18.0 | 0.19.0 |
| `@effected/schema-org` | 0.12.0 | 0.13.0 |
| `@effected/schemastore` | 0.27.1 | 0.28.0 |
| `@effected/schemastore-cli` | 0.27.1 | 0.28.0 |
| `@effected/semver` | 0.19.0 | 0.20.0 |
| `@effected/source` | 0.1.1 | 0.2.0 |
| `@effected/spdx` | 0.17.0 | 0.18.0 |
| `@effected/store` | 0.21.0 | 0.22.0 |
| `@effected/templates` | 0.15.0 | 0.16.0 |
| `@effected/toml` | 0.17.0 | 0.18.0 |
| `@effected/tsconfig-json` | 0.18.1 | 0.19.0 |
| `@effected/walker` | 0.23.0 | 0.24.0 |
| `@effected/webhooks` | 0.2.0 | 0.3.0 |
| `@effected/workspaces` | 0.40.1 | 0.41.0 |
| `@effected/xdg` | 0.17.1 | 0.18.0 |
| `@effected/yaml` | 0.26.0 | 0.27.0 |

The effected agent plugin (`@effected/ai-plugin`, not on npm) moves from 0.45.0 to 0.46.0.

## 1. Repin vendored Effect source

If this repository vendors Effect source (usually `.repos/effect`), repin it before you touch code. It is the authority on what v4 exports, and it must agree with the installed version:

```bash
savvy repos pin effect effect@4.1.1
```

Or use the `repos_manage` MCP tool with `action: "pin"`, `name: "effect"`, `ref: "effect@4.1.1"`. Review any `staleNoteIds` it reports. Commit the pin together with the lockfile move in step 2, never separately. Never write under `.repos/` by hand, and never run git there. If the project does not vendor Effect, skip this step.

## 2. Replace the catalog plugin and reinstall

**`@effected/pnpm-plugin-effect` is replaced by `@effected/pnpm-plugin-effected`.** The old name is deprecated and gets no further releases. Your `@effected/*` and Effect versions come from the plugin through `configDependencies`, so replacing it is the whole bump. You do not edit those ranges by hand.

1. **Fix the release-age exclude first.** If `pnpm-workspace.yaml` exempts the old plugin from `minimumReleaseAge`, rename that entry before you install, or the gate refuses the new plugin's fresh release:

   ```yaml
   minimumReleaseAgeExclude:
     - "@effected/pnpm-plugin-effected"
     - "@savvy-web/pnpm-plugin-silk"
   ```

   It used to name `@effected/pnpm-plugin-effect`. Keep any other entries you have.
2. **Swap the config dependency** in `pnpm-workspace.yaml`'s `configDependencies`: remove `@effected/pnpm-plugin-effect` and add `@effected/pnpm-plugin-effected` at its current version as a plain version number, with no `+sha512` integrity suffix. pnpm still honours a suffix, but the plain version is the canonical form.
3. **Rewrite every catalog reference to the one catalog, `effected`.** The plugin still declares its catalogs split internally, but its install hook folds them, so your workspace sees exactly one catalog, `effected`, holding the Effect family and the kit. `catalog:effect`, `catalog:effect:peers` and `catalog:effected:peers` no longer exist for you, and an install with any of them left behind fails with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC` (probed through a real config-dependency install of the plugin). Find them:

   ```bash
   git grep -nE 'catalog:(effect|effect:peers|effected:peers)"' -- '*package.json'
   ```

   Every one of them becomes `catalog:effected`, in `dependencies`, `devDependencies` and `peerDependencies` alike.
   - **Your published peer ranges change.** `pnpm pack` resolves `catalog:effected` to the catalog's install range, so a library you publish now advertises `effect: ~4.1.1` where it advertised the floored `^4.0.0`, and an `@effected/*` peer advertises the patch (`^0.24.1`), not the floored `^0.24.0`. The plugin's overrides pin those exact versions anyway. If you need a floored peer, write the range by hand in that one manifest.
4. **The Effect family is held to one minor.** `catalog:effected` gives `effect` and every `@effect/*` package `~4.1.1` (`>=4.1.1 <4.2.0`), not a caret. A future Effect 4.2 arrives only with a new plugin release, never through a caret. `@effect/tsgo` stays on its own `0.x` line.
   - The plugin still derives one override per Effect family member, pinning `effect` and every satellite to `4.1.1` across your whole graph. Never hand-write those pins.
5. **Reinstall from scratch:** `pnpm clean --lockfile && pnpm install`. A plain install reports "Lockfile is up to date" and keeps the old versions.
   - A fresh Effect release can be refused by a release-age gate (pnpm `minimumReleaseAge`, yarn berry `npmMinimalAgeGate`). Add `effect` and `@effect/*` to the exclude list, or wait it out.
6. **Check the lockfile diff:**
   - `effect@4.1.1` is the only `effect` your importers resolve.
   - Platform binaries (turbo, biome, tsgo) are still present. Count them before and after: `grep -cE "^  '?@?(turbo|biomejs/cli|typescript/native-preview)[^:]*(darwin|linux|win32)" pnpm-lock.yaml`.
7. **Peers.** Every kit package's `effect` peer is now `~4.1.0`. A kit package built on 4.0.x does not satisfy it and cannot be mixed in. Compare each package you use (`pnpm view @effected/<pkg>@<version> peerDependencies`) against what you declare, and run `pnpm peers check`. Never silence a warning.

If a package pins an `@effected/*` range directly, outside `catalog:effected`, bump it by hand: on `0.x` a caret pins the minor. Prefer moving it onto the catalog.

### 2.5. Bridge a toolchain that runs the published 4.0.x kit

Skip this step unless your **build toolchain** loads published `@effected/*` packages. Toolchain here means packages you build with rather than ship, such as `@savvy-web/*`, okfit, tsdoctor or vitest-agent. A kit built on Effect 4.0.x imports `Crypto` from the `effect` root, which 4.1 removed. Under the plugin's graph-wide `effect` override, those published copies bind `effect@4.1.1` and die at import (`does not provide an export named 'Crypto'`). Your build fails before it compiles anything.

Run them, **and the tools that load them**, on the effect they were built on, with a root `.pnpmfile.cjs` `readPackage` hook. Bridging only the kit is not enough. A tool that binds `effect@4.1.1` while handing values to a kit on 4.0.7 runs two Effect copies and crashes (seen here: okfit failed every command with `Cannot convert a Symbol value to a string`). A `packageExtensions` entry cannot do this either, because it selects by version and your own workspace may hold the same versions.

For each bridged package, turn its `effect` (peer or dependency) and every `@effect/*` member on effect's 4.x line into regular dependencies on npm aliases of the old release. The alias slips past the plugin's version-selector override, which rewrites a plain `4.0.7` back to `4.1.1`. The `private` check leaves your own workspace packages alone. Name your toolchain's families in `TOOLCHAIN`, because a tool that reaches the kit only through another package has no `@effected/*` dependency of its own to detect:

```js
const BRIDGED = "4.0.7";
const TOOLCHAIN = ["@savvy-web/", "@okfit/", "@tsdoctor/", "@vitest-agent/", "rolldown-pnpm-config"];
const isEffectLine = (name, spec) =>
  (name === "effect" || name.startsWith("@effect/")) && /^[\^~=]*4\./.test(String(spec).trim());
const reachesKit = (pkg) =>
  [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies].some((deps) =>
    Object.keys(deps ?? {}).some((name) => name.startsWith("@effected/")),
  );
function readPackage(pkg) {
  if (pkg.private === true || !pkg.name) return pkg;
  const bridged =
    (pkg.version === BRIDGED && isEffectLine(pkg.name, pkg.version)) ||
    pkg.name.startsWith("@effected/") ||
    TOOLCHAIN.some((p) => pkg.name.startsWith(p)) ||
    reachesKit(pkg);
  if (!bridged) return pkg;
  const pinned = {};
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      if (!isEffectLine(name, pkg[field][name])) continue;
      delete pkg[field][name];
      pinned[name] = `npm:${name}@${BRIDGED}`;
    }
  }
  if (Object.keys(pinned).length > 0) pkg.dependencies = { ...pkg.dependencies, ...pinned };
  return pkg;
}
module.exports = { hooks: { readPackage } };
```

`isEffectLine` matters: `@effect/tsgo` and `@effect/language-service` version separately and have no `4.0.7`.

The first clause, which bridges every `effect`-line package at exactly `4.0.7`, is not optional. Without it a bridged `@effect/platform-node@4.0.7` still depends on `@effect/platform-node-shared`, and the plugin's `@effect/platform-node-shared@^4.0.0` override lifts that edge to `4.1.1` bound to `effect@4.0.7`. The lockfile shows `@effect/platform-node-shared@4.1.1(effect@4.0.7)`, and anything that loads it fails with `Cannot find module …/effect/dist/process/CommandLine.js`. Here that broke every `prepare` build during the install.

Reinstall, then confirm: every toolchain and published `@effected/*` snapshot in the lockfile names `effect: 4.0.7`, no snapshot pairs a `4.1.1` satellite with `effect@4.0.7` (`grep -E "@4\.1\.1\([^)]*effect@4\.0\.7" pnpm-lock.yaml` prints nothing), your importers resolve `4.1.1`, the `importers:` section's `link:` edges are unchanged, and each tool's CLI runs. Remove the hook once every tool you build with has republished on an `@effected` release built on Effect 4.1; then no lockfile `packages:` entry names `effect@4.0.7`. The toolchain releases follow the kit's, so expect to carry it for a round.

## 3. Find the Effect 4.1 changes in your code

None of these is a rename a regex can make safely. Find the call sites, then judge each one against the vendored source and a probe.

```bash
git grep -nE 'Crypto|TestCrypto|FileSystem\.make|readDirectory|\.glob\(|Terminal\.make|ChildProcess\.(make|TemplateExpression)|TemplateExpression|McpServer|HelpDoc|KeyValueStore|Persistence\.layer|withCookiesRef|HttpMethod|Toml\.parse|Yaml\.parse|Base64Url|BigDecimal|DecideOptions|AiError|NetworkError|sql\.(insert|updateValues)|fromFileSystem|HttpApiClient\.Upgraded|TaggedUnion\.match'
```

The kit hit the first seven groups itself (step 4). Where this section says **check**, the item comes from the Effect changelog and was not probed here.

### Removed or reshaped, the compiler finds these

- **`effect/Crypto` is gone.** Randomness and UUIDs come from `SecureRandom`, hashing from `Digest` with algorithm values such as `Digest.sha256`, both under `effect/crypto`. `effect/testing/TestCrypto` is gone: use `Layer.mock` for the services you need. Crypto is no longer in the platform `*Services` bundles (`NodeServices` carries none), so provide it yourself: `NodeCrypto.layer` (every family) or a family layer such as `NodeCrypto.layerDigest`, or core's `Digest.layerWebCrypto`. Core's `Digest` cannot fail with a typed error, and without `crypto.subtle` a SHA digest dies (vendored `crypto/Digest.ts`). A published package built on 4.0.x that imports `Crypto` from `effect` dies at import on 4.1 (probed: `does not provide an export named 'Crypto'`).
- **A custom `FileSystem` must implement `readDirectoryEntries`**, which lists a directory with each entry's type (`"Unknown"` allowed). `FileSystem.make` now derives `glob` and no longer accepts one: apply a custom `glob` afterwards with `FileSystem.FileSystem.of({ ...FileSystem.make(impl), glob })`. A wrapper that changes `readDirectory` must change `readDirectoryEntries` the same way.
- **A custom `Terminal` passed to `Terminal.make` must supply `size`**, a scoped queue seeded with the current dimensions that receives each resize.
- **`ChildProcess` arguments are `CommandLine.Word`** (`string | Redacted<string>`), and `env` values may be `Redacted`. Code that reads a command's `args` as `string[]` stops compiling. `ChildProcess.TemplateExpression` and `TemplateExpressionItem` moved to `CommandLine`.
- **`McpServer` registrations go through the transport's `registrations` option**, construction-time handler services are captured with `Layer.unwrap` rather than `Layer.provide`, and a tool's declared `dependencies` become per-request `McpRequest<"Requires", S>` requirements met by middleware. See step 4 for the kit's shape.
- **Check:** `KeyValueStore.make` / `makeStringOnly` stores must provide `keys`.
- **Check:** `HttpApiClient.Upgraded` values carry a `[HttpApiClient.UpgradedTypeId]` brand, so a hand-built mock needs it.
- **Check:** received HTTP request methods are typed `string`, so an exhaustive switch over them needs a fallback or `HttpMethod.isHttpMethod`.
- **Check:** `sql.insert` and `sql.updateValues` require a non-empty array at the type level.
- **Check:** `Schema.TaggedUnion.match` and `matchOrElse` no longer take explicit output type arguments.
- **Check:** `AiError.HttpRequestDetails` and `Response.HttpRequestDetails` are removed; `AiError.NetworkError` records `method` and `url` instead of `request`. `DecideOptions.images` is removed in favour of `Decision.Image` input fields.
- **Check:** `fromFileSystem` moved from `effect/sql/Migrator` to `effect/sql/MigratorFileSystem`.
- **Check:** `HttpClient.withCookiesRef` takes a `Ref<ReadonlyArray<Cookie>>`.

### Behaviour changes, only your tests find these

- **`FileSystem.glob` is now core's own walk, on every platform.** On a case-insensitive volume (APFS), a wildcard segment matches stored names case-sensitively, while a literal segment is looked up and keeps the queried spelling. Probed on APFS with `NodeFileSystem`: `*.JSON` matched `docs.json` on 4.0.7 and matches nothing on 4.1.1; `Sub/*.TS` likewise; `sub/*.ts` gives `sub/A.ts` on both. Glob patterns use `/` separators and backslash escapes, and Node extglobs no longer expand (changelog).
- **`ChildProcess.make` templates reject shell syntax at run time.** `|`, `$HOME`, `*` and `FOO+=bar cmd` throw a `CommandLineError` (`UnsupportedSyntax`). Quote such characters or pass them through `${}`. With `shell`, a template cannot hold `${}` values; build the script with `CommandLine.join`. **Check** your templates: the kit had none.
- **Check:** `Persistence.layerKvs` / `layerBackingKvs` store entries under `<storeId>:<key>`, so entries written by 4.0.x are not read back and cached results are recomputed. `Chat.layerPersisted` on a `KeyValueStore` loses its stored histories. Old entries are not migrated or removed. `KeyValueStore.prefix(...).clear`, `size` and `isEmpty` are now scoped to the prefix.
- **Check:** Redis `PersistedQueue` lock format is incompatible with older workers on the same prefix: stop every old worker and let its locks expire first.
- **Check:** RPC calls with `discard: true` complete on acknowledgement, not on write, and SchemaBinary peers must upgrade together.
- **Check:** `Toml.parse` returns a `Result` instead of throwing, and rejects TOML 1.0's forbidden table extensions and out-of-range dates. `Yaml.parse` supports YAML 1.1 merge keys (`<<`); quote the key to keep it ordinary.
- **Check:** `Base64Url.decode` rejects partially padded input (`Zg=`). `BigDecimal.fromString` rejects scales beyond ±10,000.
- **Check:** `HttpTraceContext.fromHeaders` rejects uppercase hex IDs and malformed `traceparent` flags.
- **Check:** `FetchHttpClient` fails a streaming request body it cannot send with an `EncodeError` instead of sending `[object ReadableStream]`.
- **Check:** a GraphQL call with a non-2xx response now fails (`TransportError`, or `ResponseError` with `data` and `errors`) instead of succeeding.

### Help output

- **Subcommand help lists inherited flags under `INHERITED FLAGS`.** `CliOutput.defaultFormatter` renders ancestor shared flags in their own section and takes `"full"`, `"summary"` and `"none"` modes for inherited and global flags. A custom formatter must read ancestor flags from `HelpDoc.inheritedFlags`, not `HelpDoc.flags`. Snapshot tests of subcommand help change.

## 4. The kit's changes from the Effect advance

### 4.x `Crypto` becomes `Digest` in `crypto`, `jsonc`, `images`, `npm` and `github-actions`

Effect 4.1 removed the root `Crypto` service. Every kit API that required it now requires core's `Digest.Digest` (`import { Digest } from "effect/crypto"`) in `R`. Core's digest cannot fail with a typed error, so `PlatformError` leaves every signature that carried it only for the digest. Without `crypto.subtle`, `Digest.layerWebCrypto` still builds, but a SHA digest **dies**. Hashes are byte-identical to before.

- **What you provide changes.** Where you provided `NodeCrypto.layer` or another `Crypto` layer, provide a `Digest` layer: core's `Digest.layerWebCrypto` (any WebCrypto runtime, Workers included), or `@effect/platform-node`'s `NodeCrypto.layerDigest` (`node:crypto`). `NodeServices.layer` no longer carries any crypto, so a program that leaned on it gets a compile error naming `Digest`. Typed.
- **`@effected/crypto`:** `SigV4.canonicalize`, `SigV4.sign` and `Fingerprint.of` require `Digest.Digest` and no longer fail with `PlatformError`. A `catchTag("PlatformError")` on these effects stops compiling. Typed. (HMAC moved too: see the next entry.)
- **`@effected/jsonc`:** `JsoncFingerprint.hash` and `hashText` require `Digest.Digest`; `hashText`'s error channel is `never`. `hashResult` and `hashTextResult` are unchanged. Typed.
- **`@effected/images`:** `ImageCacheKey.fromParams` requires `Digest.Digest`, and **`ImageCacheKeyError.reason` loses `"digest"`**, which can no longer occur. A `case "digest"` stops compiling. The `./cache` entry is no longer satisfied by `NodeServices.layer` alone: add `NodeCrypto.layerDigest`. Typed.
- **`@effected/npm`:** `PackageTarball.layer` and `PackagePublish.layer` require `Digest.Digest` where they required `Crypto`. **`TarballError.reason` loses `"integrityUnverifiable"`**: a digest that cannot be computed is now a defect, not a typed failure. It is still never reported as an integrity mismatch, and the bytes still never reach `tar`. Typed for the reason union; behavioural for the defect.
- **`@effected/github-actions`:** `BlobStore.layerS3` requires `Digest.Digest`. `ActionServices` gains `Digest.Digest` and `SecureRandom.SecureRandom`, and `ActionRuntime.layer` provides both from `NodeCrypto`, so an action run through `Action.run` needs no change. A hand-composed `layerS3` must provide `Digest`. Typed.
- **Test doubles:** a hand-built `Crypto.make` double becomes `Layer.mock(Digest.Digest, { digestHex })`, or provide the real `Digest.layerWebCrypto`. `effect/testing/TestCrypto` is gone.

### 4.x HMAC moves onto core `Mac` in `crypto`, `webhooks` and `github-actions`

Core's `effect/crypto` now ships `Mac`, so `@effected/crypto` no longer reads `crypto.subtle` itself: every HMAC, the keyed blinding in `ConstantTime.secretsEqual` and SigV4's signing-key derivation go through core's `Mac.Mac` (`import { Mac } from "effect/crypto"`), required in `R`. Tags are byte-identical to before: the RFC 4231 HMAC-SHA256 and HMAC-SHA512 vectors and AWS's documented SigV4 examples pass unchanged on both `Mac.layerWebCrypto` and `NodeCrypto.layerMac`.

- **What you provide.** Add a `Mac` layer beside your `Digest` layer: `Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` on any WebCrypto runtime (Workers included), or `@effect/platform-node`'s `NodeCrypto.layerMac`, which needs nothing further. `NodeServices.layer` carries neither. A program missing it gets a compile error naming `Mac`. Typed.
- **`@effected/crypto`:** `Hmac.sign`, `Hmac.verify`, `ConstantTime.secretsEqual` and `SigV4.signingKey` require `Mac.Mac`; `SigV4.sign` requires `Mac.Mac | Digest.Digest`. `ConstantTime.equal` stays pure (it now compares through core's `Mac.timingSafeEqual`). Typed.
- **`@effected/crypto` error type:** the package's own `CryptoError` and `CryptoErrorReason` are **deleted**; the error channel is core's `CryptoError` from `effect/crypto`, which this package does not re-export. Import it from `effect/crypto` (`CryptoError.CryptoError`). The tag is still `"CryptoError"`, so `catchTag("CryptoError", ...)` keeps compiling, but `reason` is now a tagged object, not a string: a check such as `error.reason === "key"` stops compiling and becomes `error.reason._tag === "InvalidKey"` (an empty HMAC key fails with `InvalidKey`, message `Mac.key: An HMAC key cannot be empty`). Typed.
- **No `crypto.subtle` now dies.** Where the old HMAC failed with `CryptoError { reason: "unsupportedRuntime" }`, `Mac.layerWebCrypto` on a runtime without `crypto.subtle` builds, and the HMAC **dies**, as a SHA digest already did. A recovery from `unsupportedRuntime` never runs; it is a defect now. Behavioural.
- **`@effected/webhooks`:** every preset's `verify` (`GitHub`, `Stripe`, `StandardWebhooks`, `Sanity`, `HmacHeader`, `SharedSecret`) requires `Mac.Mac`. The error channel is unchanged (`WebhookVerificationError` alone; a crypto failure was already a defect). `Webhooks.checkFreshness` needs nothing. Typed.
- **`@effected/github-actions`:** `BlobStore.layerS3` requires `Mac.Mac` beside `Digest.Digest`. `ActionServices` gains `Mac.Mac` and `ActionRuntime.layer` provides it from `NodeCrypto.layerMac`, so an action run through `Action.run` needs no change. A hand-composed `layerS3` must provide `Mac`. A signing failure is still `BlobStoreError` `misconfigured`, its cause now core's `CryptoError`. Typed.
- **Test doubles:** a test that stubbed `globalThis.crypto` to reach `unsupportedRuntime` provides a `Mac` layer over `WebCrypto.layer` instead, and asserts a defect; one that spied on `crypto.subtle.generateKey` wraps the real `Mac` service instead. Note that `@effect/vitest`'s `layer(...)` memoizes `Mac.layerWebCrypto` by reference, so a variant built from it inside such a suite needs `Layer.fresh`.

### 4.x JWS and JWT move onto core `effect/jose` in `jwt`, `oidc` and `github`

`@effected/jwt` no longer carries its own WebCrypto engine: signing, verifying, key import, segment encoding, PKCS#1 conversion and the registered-claim checks all run in core `effect/jose` and `effect/crypto`. Tokens interoperate both ways: an RS256 or ES256 token from the previous release verifies under this one and under core directly, and the reverse. A GitHub App JWT is byte-for-byte the token it was (same header, claim order and RS256 signature for the same key and clock).

- **What you provide.** Signing and verifying require core's `Signature` service: `Signature.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))` from `effect/crypto`, once at the edge. A program missing it gets a compile error naming `Signature`. Typed.
- **`@effected/jwt`:** `Jws.sign`, `Jws.verify`, `Jwt.sign`, `Jwt.verify`, `JwtKey.generate` and `TestIssuer` (`make`, `rotate`, a test issuer's `sign`) require `Signature.Signature`. `JwtKey.fromPkcs8Pem`, `JwtKey.fromJwk`, `Jws.decodeUnverified` and `JwksResolver` need no new service. Typed.
- **`@effected/jwt` key types:** `SigningKey` and `VerificationKey` are now types, not classes: core's `Jwk.PrivateKey` and `Jwk.PublicKey`. `key.alg` becomes `key.algorithm`, and `key.key` is core's `Signature` key, not a `CryptoKey`; code that called `crypto.subtle` with it signs through the `Signature` service instead. `JoseHeader` is core's `Jws.ProtectedHeader`. Typed.
- **`@effected/jwt` error routing:** `JwtErrorReason` loses `"unsupportedRuntime"`; a `case "unsupportedRuntime"` stops compiling. Typed. `alg: "none"` and any unknown algorithm are now `malformed` (were `unsupportedAlgorithm`); HMAC is still `unsupportedAlgorithm`. A JWKS key whose `use` is not `sig` is now `unknownKid` (was `key`). `Jwt.verify` checks `iss` and `aud` before `exp` and `nbf`, so a token that fails both reports `wrongIssuer` or `wrongAudience` where it reported `expired`. `JwtError.detail` text changes. Behavioural.
- **`@effected/jwt` additions:** every asymmetric algorithm core has (`RS`/`PS`/`ES` 256-512, `EdDSA`), `kty: "OKP"` JWKs, and PKCS#1 for `PS*`. A header without `kid` now matches when exactly one key in the set fits its algorithm. Additive.
- **`@effected/oidc`:** `Oidc.verify` requires `Signature.Signature` beside `JwksResolver`. `Oidc.decodeUnverified` needs nothing, and now requires a JSON-object payload. Its reasons follow `jwt`'s above. Typed, plus the behavioural reason changes.
- **`@effected/github`:** `GitHubApp.layer`, `GitHubApp.layerWith`, `GitHubApp.clientLayer` and `GitHubApp.appClientLayer` require `Signature.Signature`; `ActionsOidc.verify` requires it beside `JwksResolver`. The `GitHubApp` methods do not: the layer captures the service when built. `GitHubApp.layerTest` and `makeTest` are unchanged. Typed.
- **`@effected/github-actions`:** no `R` change. It reads tokens only through `Jws.decodeUnverified` and `Oidc.decodeUnverified`, which need no service.
- **Test doubles:** a test that stubbed `globalThis.crypto` to make a later signing fail no longer can (core's `Signature` layer captures WebCrypto when built); wrap the real `Signature` service and fail its `sign` instead. In `@effect/vitest`, provide `Signature` with `layer(CryptoLive, { buildPerTest: true })`: a block-level `layer(...)` builds once, so its tests share one `TestClock`, and a test that sets the time breaks the next.

### 4.x `@effected/mcp`: registrations go through `McpStdio.layer`

Effect 4.1 changed how an `McpServer` takes its registrations: they pass through the transport's `registrations` option, and a service a tool declares in `dependencies` became a per-request requirement.

- **`McpStdioOptions` takes `registrations`**, a `Layer` of your toolkit and handlers, and is generic over that layer's types (defaults `never`, so an existing `Pick<McpStdioOptions, ...>` still compiles). Pass your toolkit layer here rather than merging it beside the transport: registrations then build before the first request, with build-time logs on stderr. `McpStdio.layer({ registrations: McpToolkit.layer(Kit).pipe(Layer.provide(Handlers)) })` is `Layer<McpServer, never, Stdio>`.
- **`McpStdio.layer` no longer outputs `McpServerClient`.** Core provides it only when every protocol is stateful, and the default protocol list includes the stateless `v2026_07_28`. Read `McpSchema.McpRequestContext` instead. Typed.
- **A registration's typed errors stay in the error channel.** Only `IllegalArgumentError`, such as a bad `protocols` list, still dies. Typed.
- **`McpToolkit.layer` requires `McpRequest<"Requires", S>` for every service a tool declares in `dependencies`**, and `Layer.provide(Layer.succeed(S, …))` no longer satisfies it. Typed. Two migrations:
  - **A per-request value:** provide it through `McpServer` middleware, `McpServer.middleware<{ provides: S }>()((effect) => Effect.provideService(effect, S, value))`, and `Layer.provide` its `.layer` on the toolkit layer.
  - **A value fixed at build:** drop it from `dependencies` and capture it in the effect form, `Kit.toLayer(Effect.gen(function* () { const s = yield* S; return { ... } }))`.
- **A toolkit merged beside the transport** with `Layer.mergeAll` now needs `Layer.provide(McpServer.McpServer.layer)`, because core's `McpServer.toolkit` requires `McpServer`. Prefer `registrations`.
- **`ToolReplay`:** inside a server, read `KeyValueStore` when the handler is built and pass it as `store`, or `wrap`'s `KeyValueStore` requirement becomes a declared request-level dependency. A `KeyValueStore.makeStringOnly` store must now implement `keys` (step 3).
- **A union tool with no `success` schema answers `tools/call` with `content: []`.** It was an internal error. Behavioural.

### 4.x `@effected/cli`: inherited flags and test terminals

- **Subcommand help lists inherited flags in their own `INHERITED FLAGS` section**, between `FLAGS` and `GLOBAL FLAGS`, instead of under `FLAGS`. That includes `CliAudience.flags()` (`--agent`, `--human`, `--ci`, `--audience`) on every subcommand below the command declaring them. The declaring command still lists them under its own `FLAGS`. Core's formatter renders this; the kit adds nothing. Behavioural: a help snapshot of a subcommand changes.
- **`TestTerminalHandle` gains `resize(size)`**, and the test terminal implements core's new `Terminal.size`: each subscription gets the current size, then every resize. `columns` and `rows` read live. Additive.
- A hand-built `Terminal.make` test double must now supply `size` (step 3). The kit's own doubles did.

### 4.x `@effected/commands`: `ScriptedSpawner` records `Redacted` arguments

Effect 4.1 lets a `ChildProcess` argument or `env` value be `Redacted`, and the kit's spawn double now records what was passed rather than unwrapping it.

- **`SpawnRecord.args` is `ReadonlyArray<CommandLine.Word>`** (`string | Redacted<string>`), not `ReadonlyArray<string>`, and **`SpawnRecord.env` values may be `Redacted<string>`**. A `Redacted` argument stays the `Redacted` object, so a record never holds a secret as text: `JSON.stringify` and `String` show `<redacted>`. Typed: code that treats `spawns[i].args` as `string[]` (`.includes`, `.join`, string comparison) stops compiling. Normalise with `args.map(String)`, or assert on the `Redacted` itself (`record.args[1] === token`).
- **`SpawnScript` still receives `ReadonlyArray<string>`.** A `Redacted` argument reaches a script as `"<redacted>"`, never its value. Behavioural, and only if your code passes a `Redacted` argument.
- `Run.extendEnv` also accepts `Redacted` values, and a `Redacted` argument shows as `***` in `CommandFailedError.args` and spans.

### 4.x `@effected/memfs`: `readDirectoryEntries`, and core's `glob`

Effect 4.1 added `FileSystem.readDirectoryEntries` and made `FileSystem.make` derive `glob` from it. memfs follows core rather than keeping its own.

- **The memory volume implements `readDirectoryEntries`**, and its `glob` is now core's derived one; memfs's own matcher is gone. On a **case-insensitive** volume (`caseSensitive: false`, the APFS-shaped one), a wildcard segment now matches stored names case-sensitively, as on the host: `*.JSON` no longer finds `docs.json`. A literal segment is still looked up, so it folds and keeps the queried spelling (`sub/*.ts` gives `sub/A.ts`). This matches `NodeFileSystem` on APFS under 4.1.1 (probed). Behavioural: only a test that globbed a case-insensitive volume with a differently-cased wildcard sees it. On a case-sensitive volume, **check** any test that asserts a glob's exact result order.
- **`@effected/memfs/node-sync`'s filesystem implements `readDirectoryEntries`** over `readdirSync(…, { withFileTypes: true })`, with `readDirectory`'s error mapping. Its `glob` stays an unsupported defect. Additive.
- **Fault injection reaches `glob` through `readDirectoryEntries`.** The wrapper rebuilds through `FileSystem.make`, so a fault on `readDirectoryEntries` now fails a `glob` too, as a fault on `access` fails `exists`. A fault on `readDirectory` does not reach `glob`, so a test that must fail every listing faults both. Behavioural: a `readDirectoryEntries` fault now fails globs it did not before.

## 5. New surfaces worth adopting

For each, search your code for the hand-rolled pattern, and replace it only where the semantics match. Each is new in Effect between 4.0.7 and 4.1.1; read its module in the vendored source before you adopt it, since several are `@stability unstable`.

### Effect 4.1

- **`effect/crypto`:** `Digest`, `SecureRandom`, `Mac`, `Signature`, `Aead`, `Cipher`, `Kdf`, `KeyAgreement`, `KeyWrap` and `KeyFormat`, each a service with a WebCrypto layer (`layerWebCrypto`) and, in `@effect/platform-node`, `NodeCrypto` layers. Search: direct `crypto.subtle` or `node:crypto` calls, hand-written HMAC or signature helpers.
- **`effect/jose`:** `Jws`, `Jwe`, `Jwt`, `Jwk` and `Jwks`, with a typed `JoseError`. Search: a `jose` dependency, hand-written JWT verification. `@effected/jwt` now runs on it (step 4), so its keys are core's and work with core `Jws` and `Jwt` directly.
- **`effect/Glob`:** a compiled pattern (`Glob.make`, `Glob.match`, `Glob.escape`), the matcher behind `FileSystem.glob`. Search: `picomatch` or `minimatch` used only to test a path. `@effected/glob` remains the kit's matcher for its own surface.
- **`effect/process/CommandLine`:** `quote` and `join` build shell-safe command lines, and `Word` (`string | Redacted<string>`) carries a secret argument without exposing it. Search: hand-escaped shell strings, tokens interpolated into `ChildProcess` arguments.
- **`HttpClient.timeout`**, **`HttpClient.isTransientError`** and **`isTransientResponse`:** a per-request timeout and the transient-failure predicate a retry schedule wants. Search: `Effect.timeout` wrapped round each `execute`, local "is this retryable" status lists.
- **`McpTest.makeClient`:** runs an `McpServer`'s registrations over an in-memory protocol and returns a typed client, through the same encoding, routing and middleware as stdio. Search: tests that spawn your MCP server over stdio only to call a tool.
- **Check:** `McpServer` gained cache hints (`cacheHints` in `ai/McpServer.ts`). Not probed here; read the module before adopting.
- **`Terminal.size`:** a scoped queue of terminal dimensions, current then every resize. Search: `process.stdout.on("resize")` listeners.
- **`effect/encoding/Csv`** and **`effect/http/ProblemDetails`** (RFC 9457). Search: a CSV dependency, hand-built `application/problem+json` bodies.
- **Help output modes:** `CliOutput.defaultFormatter` takes `"full"`, `"summary"` and `"none"` for inherited and global flags (step 3).

### The kit

- **`@effected/pnpm-plugin-effected`** (step 2): one `effected` catalog, Effect held to one minor.
- **`TestTerminalHandle.resize`** in `@effected/cli/testing` (step 4): drive a live resize in a test.
- **`McpStdioOptions.registrations`** (step 4): build registrations before the first request, logs on stderr.
- **`ScriptedSpawner`** records `Redacted` arguments as passed (step 4), so a test can assert a secret reached the child without the secret appearing in a snapshot.

### Known consumer notes

- **Every consumer that loads the kit in its build toolchain** needs the step 2.5 bridge until its tools republish on this release.
- **Every consumer that pinned `@effected/pnpm-plugin-effect` 0.19.x** is on a broken catalog. Move to `@effected/pnpm-plugin-effected` before anything else.
- **Consumers of `@effected/jwt`** that verify against a key they already hold, or one fixed HTTPS JWKS URL, and sign with PKCS#8 keys can use core `effect/jose` directly (`Jwt.verify`, `Jwks.layerRemote`, `Jwk.importPkcs8`). Keep `@effected/jwt` for OIDC discovery across issuers, a KV-backed `JwksStore` on Workers, PKCS#1 GitHub App keys, the 60 s / required-`exp` defaults, or `TestIssuer`; the kit may drop the package later.
- **Consumers that keep test doubles of `FileSystem` or `Terminal`** (any repository with a hand-built `FileSystem.make` or `Terminal.make`) must add `readDirectoryEntries` or `size` (step 3). Prefer `@effected/memfs` and `@effected/cli/testing`, which already do.

## 6. Verify the upgrade

1. A fresh `pnpm install` resolves every importer's `effect` to `4.1.1`, every `@effected/*` package to the release's minors, and no `catalog:effect`, `catalog:effect:peers` or `catalog:effected:peers` reference is left. If you added the step 2.5 bridge, no lockfile snapshot pairs a `4.1.1` satellite with `effect@4.0.7`, and each toolchain CLI starts.
2. Typecheck every package (`tsc --noEmit` or the repo's `types:check`). This finds the typed breaks: a `Crypto` import, a `PlatformError` catch on a digest, a `"digest"` or `"integrityUnverifiable"` reason case, a `FileSystem` or `Terminal` double missing a member, `args` read as `string[]`, `McpServerClient` read from `McpStdio.layer`, and a tool dependency provided with `Layer.provide`.
3. Build, then run the full test suite. It finds the behaviour breaks the compiler cannot: `glob` results on case-insensitive volumes (yours and memfs's), shell syntax rejected in `ChildProcess` templates, subcommand help snapshots with `INHERITED FLAGS`, a union MCP tool answering `content: []`, a digest that dies without `crypto.subtle`, faults written on `readDirectory` that no longer reach `glob`, and the step 3 **check** items your code touches.
4. `pnpm peers check` is clean.
5. Regenerate and diff any snapshot derived from Effect output (help text, JSON Schema, API reports) before you ship.

Update READMEs, docs and agent context files that show the old shapes. Leave CHANGELOGs alone.

## 7. Clear your tracking tickets

This round closes the effected issue below. If your repository tracks it (a workaround waiting on the plugin rename, a TODO naming it), adopt the shipped shape and close your ticket with a link to the effected issue.

1. Search your issues, code and TODOs for `spencerbeggs/effected#` and the number below.
2. Confirm the fix is in the version you now resolve, from the installed plugin's catalog.
3. Adopt it and close your ticket. If the shipped shape does not cover your case, say so on the effected issue.

Also check tickets that track an Effect issue against the 4.1 changes in step 3.

| Issue | Closed by this round |
| --- | --- |
| #1146 | catalog: replace `pnpm-plugin-effect` with `pnpm-plugin-effected` |

Applying the `@effect/tsgo` patch on install was split out of #1146 into #1167, which stays open.

## 8. Align on the kit and on Effect

Do this only once step 6 is green, so every replacement is measured against a working baseline.

The kit and Effect v4 keep absorbing what downstream projects hand-roll, and 4.1 added a whole crypto and JOSE surface. **Review all of your code, not just the call sites named above**, and replace whatever you implement yourself that the kit or Effect now provides, wherever the semantics fit.

- **Delegate the review to the effected plugin's `effect-developer` agent.** It carries the kit's package index (`effected-packages`, with the per-construct intent index under `references/constructs/`) and the Effect v4 skills, and verifies every API against the installed `.d.ts`. Work module by module, and ask it what the kit or Effect already provides for what each module does.
- **Replace only where semantics match.** Where the kit or Effect computes a value you persist or publish (a hash, a key, a signature), compare its output against your stored data first, and keep a local version or a migration where they differ.
- **When the kit almost fits, report the gap upstream** rather than wrapping it in a local shim.
- Keep each replacement behaviour-preserving, with the suite green after every step, and re-run the step 6 verification at the end.
