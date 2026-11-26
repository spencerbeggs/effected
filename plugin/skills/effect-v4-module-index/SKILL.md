---
name: effect-v4-module-index
description: >-
  Use before writing any Effect v4 helper, service or module, to find what core already ships for the task: a
  subprocess, a retry or polling schedule, a TTL cache, a temporary directory, an HTTP call, hashing or signing,
  stdout from a library, a queue, a pool, a stream, a file system. Also use when asking which module to import,
  whether Effect has a given data type, or where a module lives in the source. Rows route; the other effect-v4-*
  skills teach the patterns.
when_to_use: >-
  which Effect module, does Effect have, is there a core module for, effect/process, ChildProcess, Schedule,
  Effect.retry, Cache, Pool, Queue, PubSub, Stream, Sink, Channel, Deferred, RcMap, Stdio, FileSystem, Path,
  HttpClient, effect/crypto, effect/cli, effect/ai, effect/sql, @stability unstable, writing a helper core may
  already ship
---

# Effect v4 module index

Every module of `effect@4` core, one row each: **what it is**, **when to reach
for it**. This skill exists so the other skills can stop explaining what things
are and spend their space on patterns — and so no one designs a capability core
already ships (the `effect-v4-planning` contract-inventory gate).

## Look it up first

Run these steps before you design a helper, a loop, a cache or a parser. A
hand-rolled copy of something core ships is the most common review finding
against Effect code, and it is the cheapest one to avoid.

1. **Find the row.** Start at [Routing by task](#routing-by-task), which is
   keyed by what you were about to build, then search the module tables for
   your task word (`retry`, `glob`, `diff`, `temp`, `cache`, `env`).
2. **Verify the signature before you write the call.** A row says what exists,
   not its exact shape. From inside a package that depends on `effect@4`:

   ```bash
   node -p 'require("effect/package.json").version'   # must print 4.x; if not, cd into a v4 package
   EFFECT_SRC="$(node -p 'const p=require("node:path");p.join(p.dirname(require.resolve("effect/package.json")),"src")')"
   grep -n "export const <name>\|export function <name>\|export {" "$EFFECT_SRC/<Module>.ts"
   ```

   A namespace row lives one level down (`$EFFECT_SRC/http/HttpClient.ts`). Read
   the TSDoc above the match and its `@stability` tag. For a claim about
   behaviour, climb to the probe in
   [effect-v4-source-lookup](../effect-v4-source-lookup/SKILL.md).
3. **Then check the kit.** A kit package may wrap the module with the schema,
   the typed errors or the test double you need:
   `grep -ri "<intent words>" "{{skill_dir effected-packages}}/references/constructs/"`,
   then [effected-packages](../effected-packages/SKILL.md) for the package.

## Source and stability

**Where things live.** Every row's source is `src/<Name>.ts` (testing modules
under `src/testing/`, the namespace modules below under `src/<ns>/`), in the
installed `node_modules/effect/src` and in a vendored Effect tree where the
project has one. The installed copy is what you compile against, so it settles
existence and signatures; a probe settles semantics
([effect-v4-source-lookup](../effect-v4-source-lookup/SKILL.md) owns the
evidence ladder). It is also the **style oracle**: before building
anything module-shaped, read how core writes the analogous module.

**Stability split.** A module's stability is an annotation, not a separate
import path — every module in core imports as `effect/<Name>` or
`effect/<ns>/<Name>` alike. Every module and every directly importable export
carries an explicit `@stability` tag: `stable` follows strict semver,
`unstable` may break in a minor release. The namespace modules below (`ai`,
`cli`, `http`, `http-api`, `sql`, and the rest of the table under "The
unstable-stability namespaces") are `unstable`, and so are these top-level
modules — **including the platform contracts**: `Arbitrary`, `ByteSize`, `Bytes`,
`ChannelSchema`, `ErrorReporter`, `ExecutionPlan`, `FileSystem`,
`Glob` (`experimental`), `Graph`, `HashRing`, `LayerMap`, `LayerRef`, `Newtype`,
`PartitionedSemaphore`, `Path`, `PlatformError`, `SemVer`, `SemVerRange`,
`Stdio`, `Terminal`, `TxChunk`, `Version`, `TextDiff` and `Codegen` (both `experimental`), plus `testing/TestConsole` and `testing/TestSchema`.
Under `effect/encoding`, `Base64`, `Base64Url`, `EncodingError` and `Hex` are
`stable`; the rest are `unstable`. Every `effect/crypto` and `effect/jose`
module is `unstable`. A few symbols in otherwise-stable modules
carry the tag too — the network-address, cookie, header, URL-params, `Graph` and `ByteSize` schemas
in `Schema`, `Effect.withExecutionPlan`/`withErrorReporting`,
`Stream.withExecutionPlan`/`limitBytes`, `Config.ByteSize`, `Logger.toFile` —
and so does any API that exposes a third-party dependency's types. Read the tag
in the vendored source before building on an API
(`grep -n "@stability" $SRC/packages/effect/src/<Name>.ts`), and keep unstable
ones behind one seam of your own so a minor release has a single place to fix.
Requiring an unstable platform contract such as `FileSystem` in `R` is still
the house default (`effect-v4-services-layers`); the tag means a minor release
can change its shape, so re-verify your usage when the installed `effect`
moves.

## Routing by task

The module tables below are keyed by *name*. These rows are keyed by what you
were about to go build, because each one has been reached for by its task
phrasing and missed on its module name.

| You want to… | Reach for | Note |
| --- | --- | --- |
| **find files by pattern, or test a path against a glob** | `FileSystem.glob(pattern, { root, exclude, dot })` walks a tree; `Glob.make` + `Glob.match` test a path with no IO (`experimental`) | Never a hand-written `readDirectory` recursion or a glob regex. Core is enough for `*`, `**`, `?`, classes and braces. Prefer kit `@effected/glob` (`GlobPattern.compile`, `GlobSet`) when you need extglob or `!` negation (core leaves both uninterpreted and treats malformed syntax as literal), a typed `GlobPatternError` for an untrusted pattern, include/exclude sets, or a stable API. `@effected/walker` adds upward search (`Walker.findUpward`) and `descend`, a glob walk over a real tree. |
| **parse, compare, bump or range-match a version** | `SemVer` (`parse`, `Order`, `bump*`) and `SemVerRange` (`parse`, `matches`, `maxSatisfying`) | Never a semver regex or a split on `.`. Core is enough inside one module. Prefer kit `@effected/semver` when the value crosses a kit API, or you need range algebra (`Range.intersect`, `isSubset`, `simplify`), parse errors with a position, or `Result` twins. Never mix kit and core values in one `HashSet`/`HashMap`; see the `SemVer` row. |
| **parse YAML, TOML, JSONC, JSON5, INI or CSV** | `effect/encoding` — `Yaml`, `Toml`, `Jsonc`, `Json5`, `Ini`, `Csv` | Core decodes to values. Kit `@effected/yaml`, `@effected/toml` and `@effected/jsonc` edit text with its comments and layout kept, and report positioned errors; `@effected/config-file` loads a config file through a codec. |
| **retry, back off, poll, or repeat on a schedule** | `Effect.retry` / `Effect.repeat` with a `Schedule` (`Schedule.exponential`, `Schedule.spaced`); `HttpClient.retryTransient` for HTTP | Never a recursive `Effect.sleep` loop or a counter in a `Ref`. The polling shapes are in `effect-v4-idioms`. |
| **read an environment variable or a setting** | `Config` (`Config.String("NAME")`, `Config.schema(S, "NAME")`), fed by `ConfigProvider` | Never `process.env`: a test swaps the `ConfigProvider` instead of mutating the process. Kit `@effected/env` answers "agent, CI or person, and what can this terminal do". |
| **make a temporary directory that cleans itself up** | `FileSystem.makeTempDirectoryScoped({ prefix })` | Removed when the scope closes, failure or not. Never `node:os` `tmpdir()` plus a `finally`. |
| **call an HTTP API** | `effect/http` — require `HttpClient` in `R`, provide `FetchHttpClient.layer` at the edge | Never bare `fetch` in library code. Kit `@effected/github` owns the GitHub API, `@effected/npm` the npm registry. |
| **spawn a subprocess / run a command / shell out** | `effect/process` — `ChildProcess` (command values) + `ChildProcessSpawner` (the service) | NOT `cli`'s `Command`, which is the CLI *declaration*. Core declares the contract and ships **no layer**: require `ChildProcessSpawner` in `R`, let the app provide `NodeServices.layer`. Never hand-roll `node:child_process`. Arguments are `CommandLine.Word` (`string \| Redacted<string>`), and a template with shell syntax (`\|`, `$HOME`, `*`) throws `CommandLineError` when `make` is called. |
| **hash, HMAC, sign, encrypt, derive a key, or draw secure random bytes / a UUID** | `effect/crypto` — `Digest`, `Mac`, `Signature`, `Aead`/`Cipher`, `Kdf`, `SecureRandom` (each a service) | No `effect/Crypto` module exists. Require the service in `R` and provide it at the edge: `NodeCrypto.layer` (every family) or a family layer such as `NodeCrypto.layerDigest` from `@effect/platform-node`, or core's `<Family>.layerWebCrypto` on any WebCrypto runtime. **`NodeServices.layer` carries no crypto.** JOSE (JWS/JWE/JWT/JWK/JWKS) is `effect/jose`. |
| **cache an effectful lookup with a TTL and in-flight de-duplication** | core `Cache` — `Cache.makeWith(lookup, { capacity, timeToLive })`, or `Cache.make` for a fixed TTL | Already does both jobs: it "shares an in-progress lookup when multiple callers request the same missing key" (`Cache.ts:4`) and expires by `timeToLive` (`Cache.ts:118`). Do not build a promise-map de-duplicator beside it — but read the two `Cache` sharp corners below before choosing a TTL. |
| **write to stdout/stderr, or read argv/stdin, from a library** | core `Stdio` — require `Stdio` in `R` | `Stdio.layerTest(impl)` (`Stdio.ts:166`) takes a `Partial<Stdio>` and lets you echo-test the output **with no platform package installed**. The real implementation still comes from `@effect/platform-*` at the app edge. Do not `console.log` from library code to dodge the wiring. |

## Module tables

The rows above are keyed by task. Every module of core is keyed by name in two
references; search them for your task word when no routing row fits.

- **Before you write a helper over a data type, a collection, a concurrency
  primitive, a file, a path, a size, a schema or a test double, load
  [core-modules.md](references/core-modules.md)** and search it for the task
  word: it holds one row per top-level module, and the row is what stops a
  hand-rolled copy of `Graph`, `TextDiff`, `Cache`, `ByteSize` or a predicate
  core already ships. The `FileSystem`, `ByteSize`, `JsonSchema` and
  `Schema.SchemaError` rows carry contract detail (custom implementations,
  size types, draft-07 lowering, the import path) that a signature grep will
  not show you.
- **Before you reach for an npm package for HTTP, SQL, RPC, AI, a CLI, crypto,
  JOSE, encodings, persistence, workers or a chat bot, load
  [namespaces.md](references/namespaces.md):** core ships each as an unstable
  `effect/<ns>` namespace, and the row says which part is a contract you
  require in `R` and which package provides it.

## Sharp corners

Each of these passes a type-check and fails at run time or in review:

- `Queue` is `Queue<A, E>`: it can `fail`/`done`. There is no `STM`/`TRef`; the
  transactional family is `Tx*` with `Effect.tx`. `Optic` is in core.
- `effect/crypto` is the only crypto, and **`NodeServices.layer` carries none of
  it**: provide `NodeCrypto.layer`, a family layer, or `<Family>.layerWebCrypto`.
- `Digest` has a `never` error channel, so a missing `crypto.subtle` is a defect,
  and it is one-shot, so it buffers the whole payload.
- A default-TTL `Cache` keeps a **failed** lookup for the process lifetime; an
  exit-dependent TTL needs `Cache.makeWith`.
- `HttpClientRequest.bearerToken` takes a `Redacted` directly; never unwrap it.
- `HttpClientError`'s `reason._tag` is one of six leaf names; `"ResponseError"`
  and `"RequestError"` never match.

Before you choose a `Cache` TTL, provide or fail a crypto service, hash anything
large, or branch on an HTTP client failure, load
[sharp-corners.md](references/sharp-corners.md): it has the source lines, the
exit-dependent TTL example and the six `reason` tags. A retry branch written on
the wrong tag is dead code that green tests never catch.

## How the skills divide the territory

This index routes core; [effected-packages](../effected-packages/SKILL.md)
routes the kit. For patterns:
[effect-v4-idioms](../effect-v4-idioms/SKILL.md) (errors, resources, fibers),
[effect-v4-schema](../effect-v4-schema/SKILL.md) (everything Schema),
[effect-v4-services-layers](../effect-v4-services-layers/SKILL.md)
(Context/Layer discipline), [effect-v4-testing](../effect-v4-testing/SKILL.md)
(the test idioms), [effect-v4-observability](../effect-v4-observability/SKILL.md)
(spans/logs/metrics), [effect-v4-cli](../effect-v4-cli/SKILL.md) (`cli`),
[effect-v4-mcp](../effect-v4-mcp/SKILL.md) (`ai`'s MCP server), and
[effect-v4-source-lookup](../effect-v4-source-lookup/SKILL.md) (how to verify
any row here against the source).

## Additional resources

- [references/core-modules.md](references/core-modules.md) — one row per top-level core module and per `testing/*` module: what it is, when to reach for it, and the contract detail for `FileSystem`, `ByteSize`, `Graph`, `JsonSchema`, `Schema.SchemaError`, `SemVer`, `Runtime` and `TestSchema`. Load when: no routing row fits, you are about to write a helper core might ship, or you need a module's contract beyond its signature.
- [references/namespaces.md](references/namespaces.md) — one row per unstable `effect/<ns>` namespace (`ai`, `cli`, `crypto`, `encoding`, `http`, `jose`, `net`, `persistence`, `process`, `sql` and the rest) and which package provides each implementation. Load when: the task is HTTP, SQL, RPC, AI, MCP, CLI, crypto, JWTs, an encoding, a KV store, a subprocess, workers or a bot, or you are about to add an npm package for one.
- [references/sharp-corners.md](references/sharp-corners.md) — the data-type, crypto, `Cache` and HTTP traps with their source lines, the exit-dependent TTL example and the `HttpClientError` reason table. Load when: choosing a cache TTL, providing a crypto layer or hashing large input, passing a token to a request, or writing a retry or recovery branch on an HTTP client error.
