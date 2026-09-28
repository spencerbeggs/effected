# Upgrade this project to Effect 4.0.0-rc.118 and the matching @effected kit

You are upgrading this repository from Effect `4.0.0-rc.117` to `4.0.0-rc.118`, together with the `@effected/*` kit release built on it. Work through the steps in order. Do not skip the verification at the end.

## Why now

`@effect/platform-node@4.0.0-rc.117` depends on `@effect/platform-node-shared` with a caret (`^4.0.0-rc.117`). Since rc.118 was published, any install without a lockfile pairs the rc.118 `platform-node-shared` with `effect` rc.117. That combination fails at startup with `ERR_MODULE_NOT_FOUND` for `effect/process/ChildProcess`. Moving everything to rc.118 removes the mismatch.

## 1. Repin the vendored Effect source first

If this repository vendors Effect source (usually `.repos/effect`), repin it to the new tag before touching code. It is the authority on what v4 exports, and it must agree with the installed version:

```bash
savvy repos pin effect effect@4.0.0-rc.118
```

Or use the `repos_manage` MCP tool with `action: "pin"`, `name: "effect"`, `ref: "effect@4.0.0-rc.118"`. Review any `staleNoteIds` it reports. Commit the pin together with the version bump in step 2, never separately. Never write under `.repos/` by hand.

If the project does not vendor Effect, skip this step.

## 2. Move the dependency pins

- **Effect packages:** every `effect` and `@effect/*` pin goes to exactly `4.0.0-rc.118`. Use exact versions, never a caret: a caret on a prerelease floats across the release line and caused this breakage. If the pins come from a pnpm catalog, update the catalog.
- **Catalog plugin:** pnpm 12 refuses a `file:` or tarball config dependency (no integrity), so it can't be linked locally. If the project gets its catalogs from `@effected/pnpm-plugin-effect` through `configDependencies`, bump it to the kit release built on rc.118 (`0.12.0`, whose catalog names each `@effected` package at its next minor, e.g. `workspaces ^0.30.0`). Bump version and integrity together (`npm view @effected/pnpm-plugin-effect@<version> dist.integrity`).
- **Direct `@effected/*` ranges:** hand-bump any that don't come from `catalog:effected`. On `0.x`, a caret pins the minor, so `^0.28.0` does not accept `0.29.0`.
- **Force one `effect` across third-party pins:** a catalog pin doesn't reach dependencies that pin `effect` exactly themselves, such as dev tooling built on the previous release. Those keep resolving rc.117, and pnpm then builds a second copy of every `@effected/*` package against rc.117. That copy fails at load with `ERR_MODULE_NOT_FOUND` for a path like `effect/dist/encoding/Hex.js`. Until that tooling ships rc.118 builds, add global `overrides` pinning `effect`, `@effect/platform-node`, `@effect/platform-node-shared` and any other `@effect/*` package you resolve to `4.0.0-rc.118`. **Don't do this while linking or running tools that themselves import `effect/unstable/*`** (the tooling still on rc.117: silk, `@savvy-web/bundler`, okfit, `rolldown-pnpm-config` before their rc.118 releases). A global override moves them onto rc.118 too, and they crash, which breaks lint-staged, builds or pre-commit hooks. Once the kit you install is the released rc.118 kit, drop the global override. Old tools then keep their own rc.117 copies, and `grep -c rc.117 pnpm-lock.yaml` stays above 0 until they ship rc.118. That is expected: every rc.117 entry should sit under a tool, never under a kit package.
- **Release-age gates:** a fresh prerelease is refused by pnpm's `minimumReleaseAge` and yarn berry's `npmMinimalAgeGate` until it's old enough. If an install is refused, add `effect` and `@effect/*` to `minimumReleaseAgeExclude` (pnpm), or wait out the gate. It also fails a packed-install test that runs under yarn.
- **Reinstall from scratch:** run `pnpm clean --lockfile && pnpm install` (or delete the lockfile and install). A plain install keeps the old resolved versions.
- **Check the lockfile diff:** make sure platform binaries (turbo, biome, tsgo) were not dropped, and that no kit package resolves against rc.117: `grep -n "rc.117" pnpm-lock.yaml` may only show entries under tools still built on rc.117, never under an `@effected/*` package or your own importers. `pnpm why effect` alone can miss a second copy built against rc.117.

**Tooling still built on rc.117.** Dev tools that pin `effect` rc.117 exactly (okfit, tsdoctor, silk, `@savvy-web/bundler` and so on) keep working after you upgrade, but they need two things:

- **Their own `platform-node-shared` pin.** Without it they crash on the same caret bug that prompted this upgrade. `@effected/pnpm-plugin-effect` `0.12.1` and later applies it for you. Without the plugin, add the scoped override yourself: `"@effect/platform-node@4.0.0-rc.117>@effect/platform-node-shared": "4.0.0-rc.117"`.
- **Keep their old kit copies out of the new kit's peers.** Those tools install the previous `@effected/*` versions at the workspace root, and pnpm can use those root copies to satisfy the new kit's peer dependencies. For example, `@effected/cli@0.10.0` peers `@effected/config-file`, and the rc.117 `0.12.x` copy gets picked. Set `resolvePeersFromWorkspaceRoot: false`, and have each package that uses a kit package also declare the `@effected/*` peers that package expects (for `@effected/cli`: `config-file` and `walker`). `pnpm peers check` should come back clean.

**Interim fix, only if you cannot upgrade yet:** pin `@effect/platform-node-shared` to `4.0.0-rc.117` explicitly in every package that depends on `@effect/platform-node`.

## 3. Apply the mechanical renames

Find what applies first:

```bash
git grep -nE 'effect/unstable/|effect/httpapi|effect/Encoding|\bEncoding\.|isLengthBetween|isSizeBetween|isPropertiesLengthBetween|isStartsWith|isEndsWith|\bisIncludes\b'
```

Then rewrite. These one-liners change only quoted module specifiers and exact identifiers. Run them from the repository root and review the diff:

```bash
# Unstable modules moved to the top level: effect/unstable/<x> -> effect/<x>
git grep -lzE "[\"']effect/unstable/" -- '*.ts' '*.tsx' '*.mts' '*.cts' '*.js' '*.mjs' \
  | xargs -0 perl -pi -e 's#(["\x27])effect/unstable/(?!arbitrary)#$1effect/#g'

# Arbitrary moved to the core entry
git grep -lz 'from "effect/unstable/arbitrary"' -- '*.ts' '*.tsx' '*.mts' \
  | xargs -0 perl -pi -e 's#import \{ Arbitrary \} from "effect/unstable/arbitrary";#import { Arbitrary } from "effect";#g'

# HTTP API entry point renamed
git grep -lz '"effect/httpapi' -- '*.ts' '*.tsx' '*.mts' \
  | xargs -0 perl -pi -e 's#"effect/httpapi#"effect/http-api#g'

# Schema checks renamed so the subject comes last, and the string checks made grammatical
# (isBetweenCodePoints is new in rc.118, not a rename)
git grep -lzE 'isLengthBetween|isSizeBetween|isPropertiesLengthBetween|isStartsWith|isEndsWith|\bisIncludes\b' -- '*.ts' '*.tsx' '*.mts' \
  | xargs -0 perl -pi -e 's/\bisLengthBetween\b/isBetweenLength/g; s/\bisSizeBetween\b/isBetweenSize/g; s/\bisPropertiesLengthBetween\b/isBetweenProperties/g; s/\bisStartsWith\b/isStartingWith/g; s/\bisEndsWith\b/isEndingWith/g; s/\bisIncludes\b/isIncluding/g'
```

Afterwards:

- **Imports:** if one file now imports from `"effect"` twice, merge the imports.
- **Prose:** apply the same renames to code samples and text in READMEs, docs and agent context files. Leave CHANGELOGs alone.
- **Vendored-source citations:** the one-liners rewrite quoted specifiers only. The vendored source moved too, from `.repos/effect/packages/effect/src/unstable/<x>/…` to `src/<x>/…`, so doc `sources:` paths, comments and CLAUDE.md files that cite files under the vendored tree need their own pass: `git grep -n 'src/unstable/'`. Line numbers moved as well, so re-check any `file:line` citation against the repinned tree.

## 4. Migrate by hand

These can't be done safely with a regex. Check each against the vendored source or the installed `effect`, never from memory:

- **`effect/Encoding` is removed.** Import the format modules instead: `effect/encoding/Base64`, `effect/encoding/Base64Url`, `effect/encoding/Hex`, and `effect/encoding/EncodingError` for the error. `randomHex` is now `Hex.random`. The error's TypeId string changed, so update any code that matches on the literal.
- **`Scope.close` and `Scope.closeUnsafe` require a `Scope.Closeable`.** Close a scope created by `Scope.make` or `Scope.fork`, not a plain `Scope.Scope`.
- **`Toolkit.handle` needs the tool handlers' services on the outer Effect,** not only on the returned Stream.
- **`Config.withDefault`, `Config.option` and `Config.orElse` changed behaviour.** A default on a `Config.all` group now also applies when some children are missing, and it replaces the entire group. To keep the values that were supplied, put defaults on individual children instead.
- **The CLI lexer treats negative numbers such as `-3.7` as values,** not flags. Re-check any CLI tests that relied on the old behaviour.
- **`Cause.pretty` and `Cause.prettyErrors` output changed:** stacks are cleaned and `Error` causes restored. Update snapshots and string assertions on rendered causes.
- **`Schema.isPattern` exports a JSON Schema `pattern` only when its RegExp has the `u` flag, and that includes plain strings.** Without `u`, `Schema.String.check(Schema.isPattern(/^[a-z]+$/))` exports as `{"type":"string"}` and the pattern is silently dropped. Decoding still enforces the pattern, but any published JSON Schema (committed config schemas, MCP tool input schemas, schemastore output) loses it. Add `u` to every RegExp you pass to `isPattern`. Check each one still compiles, because `u` rejects unnecessary escapes such as `\-` outside a character class. Then regenerate any committed JSON Schema and diff it.
- **`Schema.toJsonSchemaDocument` serves a pattern-keyed `Record` as `patternProperties` only when the key's RegExp has the `u` flag.** Without `u`, the pattern counts as approximate and the record is served open: `propertyNames: { type: "string" }` plus `additionalProperties`. Decoding still enforces the pattern. If a published JSON Schema (an MCP tool's `inputSchema`, a config schema) should reject unmatched keys, add `u` to the pattern.
- **`effect/Encoding` imports:** prefer the deep modules (`effect/encoding/Hex` and so on) over the `effect/encoding` barrel. The barrel also re-exports the YAML, TOML, INI, SSE and NDJSON codecs.
- **The MCP server behaves differently:**
  - pings before `initialize` now get an empty result;
  - all parameter validation errors come back in one response;
  - handler errors return `isError` results on protocol 2025-11-25;
  - malformed ndjson lines are skipped;
  - tool annotation titles are kept.

  If the project carries workarounds for any of these, re-test them. See step 5.

## 5. Revisit your MCP and CLI workarounds

Several MCP workarounds were written for Effect bugs that rc.118 fixes. Re-test any you carry before keeping them:

- **Strict tool input:** core now decodes strict tools with every error in one `InvalidParams`: excess keys, nested excess keys, missing fields and wrong types. A pre-check that rejects unknown keys first now hides the rest of core's report. Remove it and let core answer. If you use `@effected/mcp`, `McpToolkit.layer` already does this, and `unknownKeyMessage` is a deprecated no-op.
- **Union-parameter tools:** core still refuses a tool whose parameters aren't an object schema; the error is only clearer now. Keep a union workaround such as `McpToolkit.unionTool`, but decode it with `errors: "all"`.
- **Stdin framing:** core no longer stops reading after a malformed ndjson line. It skips non-JSON and non-object lines silently, and sends no reply. JSON-RPC requires `-32700`/`-32600` replies, so a guard that sends them is still useful. Drop any claim that core wedges.
- **`@effect/rpc/*` methods are still open upstream (Effect-TS/effect#8499):** one `{"jsonrpc":"2.0","method":"@effect/rpc/Eof"}` line on stdin stops a stdio MCP server silently. Answer such a request with `-32601`, and drop such a notification, before it reaches core. `@effected/mcp`'s `McpStdio.layer` does this.
- **`ping` before `initialize`:** core now answers it with `{}`. Stop blocking it in a test harness; other methods are still refused until `initialize`.
- **Two stdio servers in one layer graph still share one protocol (Effect-TS/effect#8501, open):** keep one stdio server per graph, or build each with `Layer.fresh`.
- **Result and failure shapes:** a string tool result that exactly mirrors its JSON text comes back as plain text on the 2025 protocol revisions. Handler failures become `isError` results on 2025-11-25 and `-32603` on older revisions. Update assertions that expected the old shapes.

## 6. Verify

- **Typecheck:** run `types:check` / `tsc --noEmit` for every package.
- **Build and tests:** run the full build and the full test suite.
- **One Effect version:** exactly one `effect` version is resolved (`pnpm why effect`).
- **Bins:** every published bin starts from a packed install (`npm pack`, then install into a temp directory and run `--help`). This is the failure the upgrade exists to fix.
- **No stale references:** the vendored pin, the installed `effect`, and any text that names the current pin all say `4.0.0-rc.118`.

Report what you changed, and anything that needed a hand migration beyond the list above.
