# @effected/app

## 0.12.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.5.1 | 0.5.2 |
| @effected/store | dependency | updated | 0.4.0 | 0.5.0 |
| @effected/xdg | dependency | updated | 0.3.0 | 0.3.0 |

## 0.12.0

### Documentation

- A full staleness audit of the "effected" Claude Code plugin across all 29 skills, closing gaps left by the recent `@effected/npm` and `@effected/github-actions` breaking changes and by drift accumulated since the last audit.

- Fixed 7 falsified claims, including two code snippets that no longer compiled against the current API (a `DetachedProcessError` constructed as if it were still a single class rather than a per-reason union, and a `reason` table for an error that is now split into that union) and one confident assertion that a shipped API had been dropped on purpose — which had told readers to hand-roll `registryShortLabel`, `registryDisplayName` and `registryHost` themselves.

- Corrected 22 drifted `file:line` citations that had shifted as source files moved between Effect betas.

- Removed a citation to a module that never existed — `effect/SchemaError` is a class inside `Schema.ts`, not its own module.

- Closed 6 coverage gaps, including `@effected/github-references`, a shipped and published package that was previously absent from the entire plugin.

- Added 8 new package reference files, so every one of the kit's 30 publishable packages now has a corresponding skill reference.

- Re-verified version stamps across the plugin against the current `effect` pin, correcting all but 28 of 88 files that had carried a stale beta version (the remainder are deliberately left as-is because they attest to a runtime probe that was not re-run).

- Corrected the router's error-shape rule, which was already wrong for three error classes before this branch. [#497][#497]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#497]: https://github.com/spencerbeggs/effected/pull/497

## 0.11.1

### Documentation

- Version the plugin for two rounds of guidance changes that shipped without a bump.

  The `effected-packages` routing map now lists `PeerCheck` as a capability the kit owns, so an agent asking whether a workspace's peer graph is satisfied is routed to it rather than reimplementing the check or shelling out to a package manager. It also records the narrowed `@effected/lockfiles` input domain in lockfile-format terms, and carries the consumer traps into routing rather than leaving them in reference material: an empty `unsatisfied` is not a clean report, both `unverified` reasons mean fail closed, and presence of the `peerDependencyRules` key is the assertion rather than its contents.

  The `effect-v4-testing` skill gained the verification disciplines that mutation work depends on, and one correction. It previously said an empty mutation run indicts the tooling rather than the mutant; that ordering produced a real misdiagnosis, where a `grep` returning nothing was read as a broken tool when the cause was two NUL bytes in a source file making it binary to `grep` and `rg`. Suspicion now scopes to the input before the tool, and that trap is named. [#432][#432]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#432]: https://github.com/spencerbeggs/effected/pull/432

## 0.11.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.4.2 | 0.5.0 |
| @effected/store | dependency | updated | 0.3.0 | 0.4.0 |
| @effected/xdg | dependency | updated | 0.2.1 | 0.3.0 |

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.10.4

### Documentation

- ### The wrapped-code-span cascade is documented where it misdirects
  The effected plugin's `effect-api-extractor-bases` skill now explains that a single TSDoc code span wrapped across comment lines fans out into `tsdoc-escape-right-brace` and `tsdoc-malformed-inline-tag` warnings with declaration-relative line numbers — and that chasing those by escaping braces is the wrong fix, since a properly closed one-line span protects `{`/`}` as-is. Rejoin the one wrapped span and the whole fan collapses. [#377][#377]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#377]: https://github.com/spencerbeggs/effected/pull/377

## 0.10.3

### Documentation

- ### The effected plugin's skills carry the 2026-08-14 release-wave learnings
  Six additions distilled from the consumer-unblock wave, each placed at the trigger where an agent hits it:
  - `github-api` documents REST calendar versioning: the header-less default rides the deprecated `2022-11-28` version, the per-route octokit warning misreads as a route deprecation, and a package-wide pin is unsafe until removed response fields are audited (an `optionalKey` read silently decodes absent).
  - `effect-v4-services-layers` names the split-graph trap: two resolved copies of one `@effected` package are two service tag identities, presenting as an unprovided service rather than a version error.
  - `effect-v4-source-lookup` gains the registry rung: a closed upstream issue proves nothing about published artifacts, and a repo-local grep cannot see downstream consumers — installed artifacts settle both.
  - `effected-packages` indexes `@effected/memfs` with a full per-package reference, and `effect-v4-testing` routes filesystem stubbing to `MemoryFileSystem.layerWith` past a single trivially-stubbed `layerNoop` member.
  - `effect-v4-planning` records that a pure, total module legitimately answers the design gate with no error channel, no services and no observability. [#371][#371]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#371]: https://github.com/spencerbeggs/effected/pull/371

## 0.10.2

### Documentation

- `effect-v4-source-lookup` documents a **scratchpad venue** for rung-3 semantic probes: in a repo that ships a private `scratchpad/` workspace, write a typed probe as `scratchpad/probes/<name>.ts` and run it with `pnpm scratchpad:probe probes/<name>.ts`, or a test-shaped probe under `scratchpad/__test__/` run via `vitest --project scratchpad`. `pnpm scratchpad:check` answers does-this-compile questions that `tsx`/`vitest` would silently skip. The existing no-scratchpad protocol (probe lives inside the package, delete by absolute path, etc.) is unchanged and still applies verbatim when a repo has no `scratchpad/` workspace.
- `effect-v4-planning` points a survives-the-source-read question at the scratchpad venue when one exists, as the place to settle it with a probe. [#357][#357]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#357]: https://github.com/spencerbeggs/effected/pull/357

## 0.10.1

### Bug Fixes

- `building-a-format-package`'s skill file contained a **literal NUL byte** — inside the very passage instructing authors to write control characters as escapes and never as literal bytes. It made the file read as binary, so `grep` returned nothing and exited silently: the skill was invisible to content search for any agent that looked for it that way. Both control characters are now escapes, and the file reads as UTF-8 text. [#354][#354]

### Documentation

- The "effected" Claude Code plugin, which versions with this package, gained the learnings from the `@spencerbeggs/reposets` dogfood loop:
  - **`effect-v4-schema`** — a do-this-not-this on decode's silent excess-key tolerance. A typo'd key and a correct-but-absent one are indistinguishable by default, which has now caused two failures from independent directions: a lint rule that ran on defaults because its option key was typo'd, and a config loader that could report neither a typo'd section nor a field its schema deliberately removed. Covers pairing `onExcessProperty: "error"` with `errors: "all"`, the `StructWithRest` carve-out, and why a `Never` rest is not a substitute.
  - **`building-a-format-package`** — a green conformance corpus proves conformance, not reachability, so every format package keeps a standing fixture drawn from a real document. Generalised with a second witness: a loop in which a duplicate module, a silent name collision, an unreachable export, a truncated list read and a normaliser that dropped its own typed input were each green in the suite of whoever wrote that code.
  - **`testing-actions`**, **`building-a-github-action`**, **`effected-packages`**, **`effect-v4-cli`** — updated for the surfaces released in `@effected/github@0.4.0` and `@effected/cli@0.1.0`.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.4.0 | 0.4.1 |
| @effected/xdg | dependency | updated | 0.2.1 | 0.2.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#354]: https://github.com/spencerbeggs/effected/pull/354

## 0.10.0

### Features

- ### `AppConfig.layer` accepts a caller resolver chain
  `AppConfigOptions` gains an optional `resolvers`, composed **ahead** of the XDG chain in the order given. The case it exists for is a CLI's `--config` flag, which has to outrank the app's own search path:
  ```ts
  const ConfigLive = AppConfig.layer(SettingsFile, {
  	filename: "settings.toml",
  	schema: Settings,
  	codec: TomlCodec,
  	resolvers: flag === undefined ? [] : [ConfigResolver.explicitPath(flag)],
  });
  ```
  `ConfigResolver.staticDir` covers a flag naming a directory, and `ConfigResolver.upwardWalk` a project-local file. Previously this meant dropping to `ConfigFile.layer` and rebuilding the XDG wiring — the save path, the ambient namespace — by hand.

  Prepending is the whole contract: `XdgConfig.resolver` and the native probe stay behind whatever you pass, so **the default chain is unchanged** when the option is absent.

  Two properties worth knowing before you rely on it:
  - A caller resolver that finds nothing **falls through** to the XDG chain. Every `ConfigResolver`'s error channel is `never` by contract, so a `--config` naming a file that does not exist quietly loads the XDG config instead. If that must be an error, check the path before building the layer.
  - The **save path is unaffected**. `save` still writes to the app's own config directory; writing back to a flag-named file is `write(value, path)`.

  A chain that needs the XDG resolvers anywhere but last — or not at all — has outgrown the preset: compose `ConfigFile.layer` from `@effected/config-file` directly and order the chain yourself.

  `AppConfigOptions` takes a third type parameter, `RR`, for those resolvers' requirements; it defaults to `never` and joins the layer's `R`. Existing code naming `AppConfigOptions<A, I>` is unaffected. [#352][#352]

* ### `parseOptions` on config loading, for strict config files
  `ConfigFileOptions`, `ConfigReadOptions` and `AppConfigOptions` each take an optional `parseOptions`, threaded into every schema decode. The field that matters is `onExcessProperty`:
  ```ts
  const ConfigLive = AppConfig.layer(SettingsFile, {
  	filename: "settings.toml",
  	schema: Settings,
  	codec: TomlCodec,
  	parseOptions: { onExcessProperty: "error" },
  });
  ```
  It defaults to core's `"ignore"`, so **nothing changes for existing consumers** — unknown keys are still dropped silently unless you ask otherwise.

  Why it is worth asking for: a loader that silently discards part of a user's file cannot report a typo'd section name, and cannot enforce a field the schema deliberately removed. A user migrating from an older format keeps a removed credential field, is told nothing, and believes a dead token is live. With `"error"` that becomes a `ConfigValidationError` whose issue names the offending path.

  `validate` cannot substitute for it: `validate` runs on the *decoded* value, by which point the excess keys are already gone and there is nothing left to detect.

  Keys covered by a `Schema.StructWithRest` rest are **not** excess, so a schema that deliberately admits a pass-through section — `[settings.*]` and the like — keeps working under `"error"`. [#352][#352]

- ### `Cache.through` — read-through caching in one call
  `get` → decode → on miss fetch → encode → `set` was roughly twenty-five lines every consumer wrote for itself. It is now one:
  ```ts
  const members = yield* Cache.through("team:platform", Schema.fromJsonString(Members), {
  	ttl: "1 hour",
  	tags: ["team"],
  })(fetchMembersFromApi);
  ```
  `Cache.throughVerbose` returns `{ value, hit }` for callers that need to say *(cached)* in their output — previously only reachable by subscribing to the `CacheEvent` PubSub and correlating by key, which is a telemetry channel being used as a return value.

  Two policies the package now owns rather than leaving to each consumer:
  - **A stored value that fails to decode is a miss, not a failure.** Those bytes were written by an older build of the caller's own program; the user did not cause it, cannot fix it without knowing the cache exists, and everything cached is re-derivable by definition. The stale entry is overwritten on the way out.
  - **`CacheError` is surfaced, not swallowed.** A cache is additive and a caller may reasonably want to push through a broken one, but that is the caller's decision to make with `Effect.catchTag("CacheError", …)`. A database that cannot be read is real and reportable, so it is not hidden here.

  ### `Uint8ArrayFromUtf8` — the missing UTF-8 codec
  Core's Schema ships `Uint8ArrayFromBase64`, `Uint8ArrayFromBase64Url` and `Uint8ArrayFromHex`, and nothing for UTF-8. So this package's own advice — cache values are bytes, encode them deliberately through a schema — could not be followed to the end: `Schema.fromJsonString(schema)` reaches `string` and stops. Consumers hand-wired a `TextEncoder` at exactly the seam the advice exists to close, or paid base64's 33% size premium to stay inside Schema.

  `Uint8ArrayFromUtf8` closes it. Encoding fails on malformed UTF-8 rather than substituting replacement characters, so a corrupt value stays distinguishable from a valid one containing `U+FFFD`.

### Documentation

- `Cache` and `App.layer` now document the `TestClock` ordering that decides whether cache expiry is testable at all: provide `TestClock.layer()` **outside** the `Effect.provide` supplying the cache, never beneath it. Underneath, the test body has no `TestClock` in its context and `TestClock.adjust` dies as a defect, so nothing you try to expire ever expires. [#352][#352]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.3.1 | 0.4.0 |
| @effected/store | dependency | updated | 0.2.0 | 0.3.0 |
| @effected/xdg | dependency | updated | 0.2.0 | 0.2.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352

## 0.9.1

### Documentation

- Reconciles the "effected" plugin's package routing map with the kit's current state. The map had drifted on four facts that a session consuming it would have taken as authoritative.
  - The kit is **27 packages**, not 25 — the session-start orientation had carried the older count, so every session began with it
  - All 27 are published: `jsonl` reached `0.2.0` in the 27-package beta.107 wave, replacing the claim that it sat unreleased at `0.0.0` awaiting a future wave
  - Releases are changeset-driven — CI releases whatever the pending changesets name, and a package may be released on its own. This replaces the rule that the kit ships only in coordinated waves, never one package at a time
  - `@effected/toml` parses the full **TOML 1.1.0** grammar while `stringify` deliberately emits only **1.0.0** spellings; the map described both directions as 1.0.0. Neither side should be changed to match the other — the asymmetry keeps output portable [#335][#335]

* Re-verifies the "effected" plugin's Effect v4 skills against `effect@4.0.0-beta.107`. The skills were last verified at beta.94–101, and the audit found claims that would have produced code compiling against nothing.
  - **Three APIs the skills taught do not exist** — `Schema.asClass`, `SchemaUtils`, and `References.CurrentConcurrency`. An entire documented section was built on `Schema.asClass`; the current form is to subclass the schema value directly
  - **`Differ` was wrongly listed as removed** and is alive; `FiberRef`, `FiberRefs` and `FiberRefsPatch` genuinely are gone
  - **`asEffect()` does not exist**, despite Effect's own migration notes documenting it as the `Yieldable` trait method. Neither `Option` nor `Result` is yieldable in `Effect.gen` — both satisfy the generator protocol, so `yield*` compiles clean and then dies as a defect that bypasses every `catch`. The bridges are `Effect.fromOption` and `Effect.fromResult`
  - **A prescribed `Data.Class` copy-constructor bypass is retracted.** The constructor now assigns through an internal helper that defines `__proto__` as a data property, so the `Object.assign(Object.create(Proto), props)` reproduction the skills recommended is a prototype-pollution hole. The performance argument for it came from a cost regime already retracted, and re-measured flat
  - **A nested `Schema.Class` field behaves differently since beta.101** — foreign and self-recursive fields are now identical: a literal is accepted, deep-validated and promoted, and a real instance passes through by reference
  - Roughly a hundred source citations re-anchored, and `Graph`, `Metric` and `SchemaError` added to the module routing map
  - A second sweep over the eighteen skills outside the `effect-v4-*` set found **no falsified API claims at all**, and re-stamped two probe-backed passages in the Actions state-and-secrets material to beta.107

  The `effect-v4-source-lookup` skill now records the two failures this audit turned on. The migration notes assert claims the source refutes, in both directions, rather than merely staying silent about removals — they settle renames and nothing else. And the vendored `SCHEMA.md`, which ships at the pin, is a strong version-exact oracle that is nonetheless wrong in eight places at beta.107, so it never outranks reading the declaration. [#335][#335]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#335]: https://github.com/spencerbeggs/effected/pull/335

## 0.9.0

### Documentation

- The bundled "effected" plugin's skills fold in the beta.101→107 Schema surface: `Schema.TaggedErrorClass` is `Schema.TaggedError` again (same curried call shape), `SchemaIssue.InvalidValue` takes `(annotations, input, options)` with input retention behind the new `reportInput` parse option, and thrown validation errors split into the generic `"Schema validation failed"` + `error.cause` contract (constructors, `make`, `asserts`) versus `decodeUnknownSync`'s still-formatted `SchemaError` carrying the issue on `.issue`. The construct-map skill gains a dedicated beta.101→107 sweep table for driving downstream upgrades.
- New testing guidance: a virtual `TestClock` desyncs from real filesystem awaits in the effect under test — use a per-test `it.live` escape hatch; and an `Effect.catch` over a `never` error channel is unreachable dead code that reads as coverage — check the callee's declared `E` before writing a handler. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.2.1 | 0.3.0 |
| @effected/store | dependency | updated | 0.1.3 | 0.2.0 |
| @effected/xdg | dependency | updated | 0.1.10 | 0.2.0 |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Maintenance

- Advances the `effect` peer to `4.0.0-beta.107`, part of a coordinated kit-wide wave — the whole 27-package release republishes against the new beta together.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.8.0

### Documentation

- Removes `@savvy-web/github-action-effects` skills
- Skills detail using expanded `@effected/git` package

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.7.2

### Documentation

- Skill improvements in the effected plugin, drawn from dogfood findings on real ports and adoptions.
  ### effect-v4-testing
  - Documented the inverse of the banned `runPromise` shape: a plain `it()` that *returns* an Effect never runs and reports green having evaluated zero assertions. Only the laundering form looks wrong, which is why this one survives review. Added to the skill's rules and to `references/false-greens.md` with the account of how a vacuous test came to be cited as proof to a downstream consumer.

  ### designing-an-action
  - Added six entries to the legacy-toolkit symbol map: `getSha` → `GitBranch.sha`, `commitFiles`, `getOrCreate` → `upsert` + `setAutoMerge`, `client.repo` → `yield* Repo`, the four legacy error types → one `GitHubError` routed on `kind`, and the three legacy layers → `GitHubApp.layer`.
  - Called out `commitFiles` as a reshape rather than a rename — a single options object whose `changes` are `FileContent`/`FileDeletion` class instances — since a mechanical sweep of the table produces code that looks right and is wrong.
  - Documented why the `getOrCreate` split is deliberate: the two calls have different error channels, which is what lets an auto-merge failure not fail PR creation.
  - Added a "porting an existing action" section to the walking skeleton, which previously assumed greenfield. Stub only the files importing the legacy package, move their tests to `it.todo`, and keep the suite green at every intermediate commit. Draws the distinction between a failing stub, which is a bug, and a failing test *of* a stub, which is expected.

  ### testing-actions
  - Added the doubles-before-runner migration ordering, with the reason stated: converting the runner installs a `TestClock` at the epoch across every test at once, so a live `Effect.sleep` in `src` stops advancing and hangs to the timeout naming nothing. The existing passing suite is the characterization gate for the port, and a gate rewritten alongside what it gates is not a gate.

  ### effected-packages
  - Added `references/markdown.md`, covering the authoring surface that three independent readers have concluded did not exist: the 28 constructible node classes, `Markdown.stringify`, the frontmatter reason/`hasFrontmatterBlock` pair, and `codeBlockStyle`.
  - Corrected the reference-file inventory, which listed `schemastore` and `markdown` as missing when the first already existed, and the Actions suite's skill count.

  ### effect-v4-house-style
  - Generalized the `GitBranch.upsert` documentation pattern into a house rule for any API whose misuse is silent: spell out the wrong call sequence literally, state what it cost, and name the consumer that hit it. The test for whether an API qualifies is whether the wrong call would go green.

  ### actions-state-and-secrets
  - Documented that a `Schema.Redacted` field persisted as JSON round-trips to the literal string `<redacted>`, with the probed distinction that `Schema.RedactedFromValue` encodes the real value and takes `disallowEncode` to fail loudly instead. [#268][#268]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#268]: https://github.com/spencerbeggs/effected/pull/268

## 0.7.1

### Documentation

- Reconciles the "effected" plugin's package index with `@effected/schemastore@0.2.0`.
  - Adds `effected-packages/references/schemastore.md`, the per-package reference the index row previously stood in for. Covers the emit pipeline as the entry point, the content-comparing file IO and its `outcome`-is-authoritative rule, change classification, the shipped ajv validation, and the assembly/lint/catalog/versioning surface.
  - Corrects the `@effected/schemastore` routing row, which advertised **boundary** tier and "a `SchemaValidator` seam the consumer closes with ajv". Both became false when the package took ajv as a direct dependency and shipped the seam closed, so the row was directing agents to write an adapter that no longer exists.
  - Removes the schemastore block from the plugin's construct-coverage allow list. That block documented itself as provisional — "writing `references/schemastore.md` removes this whole block, not just entries" — and the reference file is what removes it, rather than the block growing entries for each new export. [#263][#263]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#263]: https://github.com/spencerbeggs/effected/pull/263

## 0.7.0

### Documentation

- ### `designing-an-action` and `building-a-github-action` gain a legacy-toolkit porting path
  A new `designing-an-action` reference, `porting-off-a-legacy-toolkit.md`, is a symbol-keyed lookup table for porting an action off `@savvy-web/github-action-effects` — one port reconstructed the same mapping by hand from vendored source before discovering the work was mechanical. `designing-an-action` now points there first when a port changes every import and no pipeline step.

  `building-a-github-action` gains a "Renamed, not absent" section (`GitHubMarkdown`, `ActionInput.string`, `Service.makeTest`/`layerTest`, `ActionRuntime.layer`) so a renamed construct filed under the skill's absence list no longer reads as a genuine gap. [#255][#255]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#255]: https://github.com/spencerbeggs/effected/pull/255

## 0.6.0

### Features

- ### `structuring-an-action`: the canonical GitHub Action repository shape
  A net-new, fourteenth skill teaching the annotated action-repo tree, structural standards as positive imperatives, and structural footguns for laying out a GitHub Action repository. Six references — `entries-and-layers`, `program-and-steps`, `services-and-shims`, `schema-state-and-format`, `tests`, `scaffolding` — carry demonstrative generic code shapes and cite the `github-action-template` repository as the living worked example. `designing-an-action` cross-links it to distinguish build order (that skill) from build shape (this one).
  ### `action-engineer` preloads the full 14-skill Actions suite
  `action-engineer` now preloads every skill in the Actions suite instead of loading a subset on demand: `actions-cache-and-artifacts`, `supply-chain-attestation`, `running-commands-and-tools`, `release-and-publish` and the new `structuring-an-action` join the ten it already carried, so an agent building or extending a GitHub Action always has the whole suite in context.

### Documentation

- ### Actions skill suite rewritten to a lean index-plus-references architecture
  Every skill in the suite — `building-a-github-action`, `designing-an-action`, `structuring-an-action`, `actions-runtime`, `actions-inputs-outputs`, `actions-reporting`, `actions-state-and-secrets`, `actions-cache-and-artifacts`, `github-api`, `github-app-tokens`, `running-commands-and-tools`, `release-and-publish`, `supply-chain-attestation`, `testing-actions` — is now a lean index over roughly 40 self-contained reference files: a construct-to-import table, standards stated as positive imperatives, one-line footguns pointing at the reference that explains each, and explicit `Load-when`-guarded links carrying the deep mechanism, written in a timeless, consumer-repo-facing voice rather than narrating this kit's own history.

  Frontmatter across the suite now separates a trigger-only `description` from a dedicated `when_to_use` trigger-phrase catalog, so a skill's listing stays short while its full set of trigger phrases stays discoverable. [#244][#244]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#244]: https://github.com/spencerbeggs/effected/pull/244

## 0.5.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/store | dependency | updated | 0.1.2 | 0.1.3 |
| @effected/xdg | dependency | updated | 0.1.9 | 0.1.10 |

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.0

### Features

- ### `designing-an-action` skill
  The "effected" Claude Code plugin gains a new process skill sequencing the whole build of a new, rebuilt or ported GitHub Action: recon, a frozen parity contract with a known-unknowns ledger, one persisted API dossier, a contracts-first walking skeleton whose stubs succeed, then TDD fill per step. Where the existing `building-a-github-action` skill routes to the capability skill for a given task, this one sequences the build end to end. Session-start orientation now references four specialist subagents (up from three) and points to the new skill. [#215][#215]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/effected/pull/215

## 0.4.1

### Documentation

- Reconciles the plugin's action-building skills with the current&#10;`@effected/github-actions` behavior:
  - `building-a-github-action`'s bare-`Config.*` warning now reflects that&#10;`ActionRuntime.layer` installs `ActionInput.layerDefault`, so a bare read
    under `Action.run` does resolve the runner's `INPUT_` derivation in
    production — the false green is specifically in test suites that bypass the
    runtime with their own `ConfigProvider`. Adds a "call sequences" reference
    table for multi-service flows (signing and storing an attestation,
    publishing an integrity-checked package, holding a token across the three
    action phases, emitting and attesting an SBOM).
  - `testing-actions` documents a `NodeServices.layer` / `ChildProcessSpawner`&#10;merge-order gotcha found while dogfooding: `NodeServices.layer` also
    provides `ChildProcessSpawner`, and in a `Layer.merge`/`Layer.mergeAll` the
    last provider of a duplicate service wins — so&#10;`Layer.mergeAll(scriptedSpawner, NodeServices.layer)` silently replaces a
    test's scripted spawner with the real one. It now also documents two
    round-2 findings: an unstubbed test double must die **lazily**&#10;(`() => Effect.sync(() => { throw ... })`, never a bare `throw`) so a
    consumer's `Effect.exit`/`Effect.flip` assertion sees the failure instead of
    a raw thrown error; and `ActionEnvironment.layerTest()` seeds&#10;`GITHUB_SERVER_URL` with the same value production defaults to, so testing
    an absence path needs `ActionEnvironment.layerFrom({})` instead.
  - `effect-api-extractor-bases` documents a fifth `{@link}` link-resolution
    failure: a re-exported cross-package `Schema.Class` referenced from a file
    that only `import type`s it fails with a distinct resolver message
    ("not supported yet by the resolver") and can attribute the diagnostic to
    the wrong line — backticks are the only fix.
  - `supply-chain-attestation` stops teaching the hand-rolled Sigstore identity
    adapter its worked example predated, pointing instead at the shipped&#10;`ActionsIdentityToken.layer`, and routes Actions consumers building SLSA
    provenance to `ActionsProvenance.capture` instead of hand-mapping OIDC
    claims. [#191][#191]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.4.0

### Features

- ### GitHub Actions and API skill suite for the "effected" Claude Code plugin
  The plugin ships a twelve-skill suite for building GitHub Actions, calling the
  GitHub API, running commands, publishing releases and attesting supply-chain
  artifacts — routed from a new `building-a-github-action` entry point that
  directs to the right package and skill for a capability (and says plainly what
  does *not* exist, so an agent doesn't reach for `@actions/*` or reinvent a
  retired API). The eleven skills it routes to cover the action runtime
  (`actions-runtime`), inputs/outputs (`actions-inputs-outputs`), logging and
  reporting (`actions-reporting`), state/secrets (`actions-state-and-secrets`),
  cache and artifacts (`actions-cache-and-artifacts`), the GitHub REST/GraphQL
  surface (`github-api`), App token minting (`github-app-tokens`), running
  commands and discovering tools (`running-commands-and-tools`), release and
  publish mechanics (`release-and-publish`), SBOM/attestation
  (`supply-chain-attestation`), and the test-double conventions for this domain
  (`testing-actions`).

  A new `action-engineer` specialist subagent carries this suite end to end for
  whole action- and release-engineering tasks, joining the existing&#10;`effect-developer` / `effect-reviewer` / `effect-migrator` specialists.

  The existing Effect v4 skills (house style, module index, construct map,
  schema, services/layers, testing, source lookup, the `effected-packages`&#10;index, and `building-a-format-package`) were updated with findings from the
  program's migration and probe passes, and the session-start orientation hook
  now reflects the expanded skill and agent roster.

### Refactoring

- `App`, `AppCache`, `AppConfig` and `AppStore` are now static classes with a
  private constructor rather than `as const` namespace objects. Call syntax is
  unchanged (`App.layer(...)`); each member's TSDoc now ships in the built&#10;`.d.ts`, where an `as const` object's inferred member types previously
  dropped it. [#180][#180]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.9 | 0.2.0 |
| @effected/xdg | dependency | updated | 0.1.8 | 0.1.9 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.3.1

### Documentation

- The plugin's session-start guidance qualifies its delegation preference on subagent dispatch being available and permitted, and directs the constrained case to load the matching skills inline
- The API Extractor skill records that links to schema-declared class fields never resolve, whatever selector is used, and must be written as prose instead
- The schema skill's recursive-construction cost warning is re-measured against the current beta and scoped to nesting depth, so a breadth or call-count measurement is no longer mistaken for a contradiction [#175][#175]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.8 | 0.1.9 |
| @effected/xdg | dependency | updated | 0.1.8 | 0.1.8 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.3.0

### Bug Fixes

- **Retracted a false performance claim.** The schema skill warned that node-by-node construction of a recursive `Schema.Class` re-validates its whole subtree, "doubling per level" (2.7 s at depth 20, hanging past 25), and prescribed an `Object.assign(Object.create(Proto), props)` bypass. It does not reproduce: depth 20 measures \~0.1–0.2 ms and stays flat to depth 60. The guidance to add a validation bypass for cost reasons is withdrawn.
- **`Result` is not yieldable** — the idioms skill's note now covers the success case too (`yield* Result.succeed(42)` dies identically), making clear this is "`Result` is not an Effect", not "errors need a bridge". `Effect.fromResult` remains the only bridge; `Result` has no `.asEffect()`.
- Vendored-source references follow the `.repos/effect` rename, and the 16 Schema reference guides now cite the live `Effect-TS/effect` repo instead of the archived `effect-smol`.

### Documentation

- ### Schema: four gaps closed in `effect-v4-schema`
  - **`Schema.optional` is not exact-optional.** It is literally `optionalKey(UndefinedOr(self))`, so it yields `field?: T | undefined` and admits `{ field: undefined }` — which silently violates the intended contract in an `exactOptionalPropertyTypes` codebase. `Schema.optionalKey` is the exact-optional form. Includes the mechanism and the compile-level evidence.
  - **The reserved `make` collision now has a worked resolution.** A validating `static make(input: string)` is impossible on any class factory (`TS2417`, no overload escape); the kit-wide answer is the `parse` / `parseResult` pair, shown as real code.
  - **`transformOrFail`'s callback contract is documented.** Both callbacks must return an `Effect` failing with a `SchemaIssue` — not a `Result`, not a bare value — with the house `InvalidValue(Option.some(value), { message })` failure shape.
  - **Nested `Schema.Class` fields are split by self-recursion.** A *self-recursive* field (any AST node type) accepts only real instances and checks them by instance alone; a *foreign* class field accepts a literal, deep-validates it, and hands back a re-constructed value. The two behave nothing alike, and the difference decides whether identity survives construction.

  ### `@effect/vitest` must be installed by exact version
  `effect-v4-testing` previously implied a bare `pnpm add -D @effect/vitest` would resolve the right line. It does not outside a `catalog:effect` workspace: the `latest` dist-tag is the **v3** line (`0.30.0`, peering `effect@^3.22.0`), and `@beta` runs ahead of a pinned catalog. The bare form installs cleanly with no peer warning and fails only at runtime, with an error that never mentions versions. Now leads with the exact-version pin and a resolution table.
  ### House style gains the `Schema.Class` member-placement rule
  Constructors, parsers, decoders and stateless taxonomy are `static`; operations on a decoded instance are instance methods — with the in-kit precedents named.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.7 | 0.1.8 |
| @effected/store | dependency | updated | 0.1.1 | 0.1.2 |
| @effected/xdg | dependency | updated | 0.1.7 | 0.1.8 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Maintenance

- Skill guidance re-verified against `effect@4.0.0-beta.101`. [#162][#162]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.2.1

### Bug Fixes

- ### Internal @effected edges float patches instead of pinning exact versions
  The kit's internal `@effected/*` dependency edges were declared as `workspace:*`, which the publish transform projects to an exact version pin. That coupled every kit release — a single sibling patch forced a coordinated re-release of every dependent, just to move the pin — and two paths pinning adjacent exact versions could not dedupe in a consumer's tree.

  Every internal `@effected/*` edge, both peer and regular dependency, is now declared `workspace:~`, which projects to a patch-floating `~0.x.y` range. A sibling patch flows into existing releases without a re-release, while a minor bump — the kit's breaking channel on the `0.x` line — still requires the intended coordinated release because `~` holds the minor. Floating the regular-dependency edges as well lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API. The `effect` peer, the catalog specifiers, and the `devDependencies` mirrors are unchanged. [#134][#134]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.6 | 0.1.7 |
| @effected/xdg | dependency | updated | 0.1.6 | 0.1.7 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#134]: https://github.com/spencerbeggs/effected/pull/134

## 0.2.0

### Features

- ### effected plugin: sharper planning and testing skill guidance
  The bundled Effect v4 skills gain guidance drained from the round-4 dogfood
  sweep, so the plugin versions with this release.

  The planning gate now runs a placement check before design begins: it confirms
  the target package's tier admits the capability, treating IO or a service in a
  pure-tier package as a stop, and checks the dependency direction against the
  peer graph so a capability that would close a cycle is caught up front. Its
  contract inventory now greps the sibling packages rather than core alone,
  because in this monorepo the likelier duplication is a sibling that already owns
  the concept. Its delegated-subagent rule separates a decision that contradicts
  the parent's instructions, which stops and asks, from one that exceeds them
  without contradicting, which proceeds and flags the consequence in the report.

  The testing skill's zero-collected-tests section gains the wrong-directory
  producer: a root-relative project filter run from inside a package prints a
  clean-looking zero and exits zero, so project-filtered runs belong at the repo
  root. [#130][#130]

* ### effected plugin: Result-parity is taught as the ratified kit rule
  The observability and testing skills described the sync-primitive convention as an emerging pattern observed in `@effected/jsonc`. It has since been ratified kit-wide, and the skills now teach it as policy with a scope test rather than an observation.

  The observability skill states the rule outright: a public boundary returning `Effect` with nothing in `R`, no async step and no IO must expose the sync form as the primitive, spelled `*Result` — never `*Sync`, which the kit reserves for genuinely-blocking-IO facades — with the `Effect` variant defined in terms of it behind its named span. Interface and adapter seams are called out as out of scope, and an in-scope boundary with no `*Result` twin is now named as a review finding alongside the existing span-discipline findings.

  The testing skill's narrowing guidance no longer cites `Jsonc.parseResult` as the lone example: the `Result.isSuccess`/`Result.isFailure` trap now lists the full settled surface — `parseResult`/`stringifyResult` across the format packages, `parseTreeResult`, glob's `compileResult` and semver's `parseResult`/`intersectResult`. [#132][#132]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.5 | 0.1.6 |
| @effected/xdg | dependency | updated | 0.1.5 | 0.1.6 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#130]: https://github.com/spencerbeggs/effected/pull/130

[#132]: https://github.com/spencerbeggs/effected/pull/132

## 0.1.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.4 | 0.1.5 |
| @effected/xdg | dependency | updated | 0.1.4 | 0.1.5 |

## 0.1.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.3 | 0.1.4 |
| @effected/store | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/xdg | dependency | updated | 0.1.3 | 0.1.4 |

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.4

### Documentation

- Corrected the `effect-v4-construct-map` skill's Schema rename reference: the&#10;`decode`/`encode` family is not a blanket sweep. Only the Effect-returning
  base names (`decode`/`decodeUnknown`/`encode`/`encodeUnknown` → `*Effect`)
  and the `*Either` variants (→ `*Result`/`*Exit`) are renamed; the&#10;`*Sync`/`*Option`/`*Promise` variants survive unchanged, and the typed and&#10;`Unknown` flavors of each differ by input type rather than being
  interchangeable. Also notes that `Schema.decode`/`Schema.encode` still exist
  in v4, but as transformation combinators rather than parsers. [#112][#112]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.2 | 0.1.3 |
| @effected/xdg | dependency | updated | 0.1.2 | 0.1.3 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#112]: https://github.com/spencerbeggs/effected/pull/112

## 0.1.3

### Documentation

- Corrects effected-plugin skill guidance surfaced by dogfooding (the plugin ships bundled with `@effected/app`).
  - `@effected/workspaces` sync escape hatch documented as free-standing consts in the main entrypoint taking a consumer-supplied sync filesystem/path — not a `WorkspacesSync` namespace, and not Node-only
  - Construct map gains the namespace-qualified `ChildProcessSpawner.ChildProcessSpawner` access pattern, the `NodeHttpClient.layer` removal, and the `ConfigProvider.fromMap` → `fromUnknown` / `withConfigProvider` reshapes; the platform reference is re-verified against beta.98
  - Migration guidance now tells plain-Vitest repos to adopt `@effect/vitest` from `catalog:effect` rather than treating plain Vitest as nothing to migrate
  - Clarifies that the `@effected/app` no-dependency rule bars other libraries, not the application itself, which is its intended consumer
  - Adds a predecessor (`*-effect`) → `@effected` migration bridge for `xdg-effect`, `config-file-effect` and `workspaces-effect` [#106][#106]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.1 | 0.1.2 |
| @effected/xdg | dependency | updated | 0.1.1 | 0.1.2 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.1.2

### Documentation

- The bundled effected plugin's Effect v4 skills absorb three findings from the systems dogfood rounds: `effect-v4-idioms` and the construct map now document `Effect.catchTag`'s non-empty tag-array form (`Effect.catchTag(["A", "B"], recover)`, verified at beta.98), and `effect-v4-schema`'s make-vs-new rule now explicitly blesses the yieldable `yield* new SomeError({...})` construction for `TaggedErrorClass`, matching the house code across glob, workspaces and walker. [#91][#91]

* The bundled effected plugin's package-index skill (`effected-packages`) is enriched across all 18 per-package references: each now enumerates the package's feature surface — services, schema classes, statics, options bags and error types — with generic usage examples distilled from real consumer integration, verified against the built declarations. Six stale claims were corrected along the way, including the single-entrypoint claim (workspaces now ships `./node-sync`), `Package.setVersion`'s string parameter, `GitHubAuth`'s real statics, and the previously undocumented `TsconfigLoaderSync` and `Manifest` surfaces. [#91][#91]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.1.0 | 0.1.1 |
| @effected/xdg | dependency | updated | 0.1.0 | 0.1.1 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.1.1

### Documentation

- The effected plugin's skills were refreshed alongside the git surface expansion: the `effected-packages` git reference now describes the read tier plus the marked mutating tier with the correct constructor count, and `effect-v4-construct-map` records the full v4 `Cause` find family (`findFail` alongside `findError`/`findErrorOption`) with a warning that v3's `failureOption` no longer exists. The plugin versions with this package, so the patch carries those skill updates to plugin consumers. [#85][#85]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#85]: https://github.com/spencerbeggs/effected/pull/85

## 0.1.0

### Features

- The application control plane for Effect. One `App.layer` gives an application its XDG-namespaced directories, a migrated SQLite state database, a TTL cache and — through `AppConfig.layer` — a config file, all pointed at the same place, with the namespace typed exactly once. A thin composition over `@effected/xdg`, `@effected/store` and `@effected/config-file`, with no domain logic of its own.
  ### One layer for the whole control plane
  `App.layer` ensures each directory before it opens the file inside it, converting the missing-directory defect of a raw SQLite layer into a typed failure. Bind the factory to a const once — layers memoize by reference.
  ```ts
  import { App, AppConfig } from "@effected/app";
  import { ConfigFile, JsonCodec } from "@effected/config-file";
  import { Cache, Store } from "@effected/store";
  import { NodeRuntime, NodeServices } from "@effect/platform-node";
  import { Effect, Layer, Schema } from "effect";

  class Settings extends Schema.Class<Settings>("Settings")({
    registry: Schema.String,
    concurrency: Schema.Number,
  }) {}
  class SettingsFile extends ConfigFile.Service<SettingsFile, Settings>()("myapp/Settings") {}

  const migrations = [
    { id: 1, name: "runs", up: (sql) => sql`CREATE TABLE runs (id TEXT PRIMARY KEY, at TEXT)` },
  ];

  const AppLive = App.layer({ namespace: "myapp", store: { migrations }, cache: { maxEntries: 500 } });
  const ConfigLive = AppConfig.layer(SettingsFile, { filename: "config.json", schema: Settings, codec: JsonCodec });

  const MainLive = ConfigLive.pipe(
    Layer.provideMerge(AppLive),
    Layer.provide(NodeServices.layer), // the one place a platform is named
  );

  const main = Effect.gen(function* () {
    const settings = yield* (yield* SettingsFile).load;
    const store = yield* Store;
    const cache = yield* Cache;
    yield* store.client`INSERT INTO runs (id, at) VALUES (${crypto.randomUUID()}, datetime())`;
    yield* cache.set({ key: "last-registry", value: new TextEncoder().encode(settings.registry) });
  });

  NodeRuntime.runMain(main.pipe(Effect.provide(MainLive)));
  ```
  ### Hermetic tests with no platform package
  `App.layerTest` provides the same four services over synthetic XDG paths and `:memory:` databases, with the platform layers supplied internally — a consumer's first test needs no platform import at all.
  ```ts
  import { App } from "@effected/app";
  import { layer } from "@effect/vitest";
  import { Effect } from "effect";

  layer(App.layerTest({ namespace: "myapp" }))("app", (it) => {
    it.effect("stores state", () =>
      Effect.gen(function* () {
        // Store and Cache are here, in memory, hermetic.
      }));
  });
  ```
  `AppStore.layer` and `AppCache.layer` compose the state and cache databases on their own, `AppConfig.layer` wires config files without reaching a database, and `AppError` is the type-only union for the `catchTags` block at the application edge. [#81][#81]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/config-file | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/store | dependency | updated | 0.0.0 | 0.1.0 |
| @effected/xdg | dependency | updated | 0.0.0 | 0.1.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
