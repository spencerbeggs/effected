---
status: draft
module: effected
category: architecture
created: 2026-07-20
updated: 2026-07-20
last-synced: 2026-07-20
completeness: 84
related:
  - effect-standards.md
  - releases.md
  - packages/package-json.md
  - packages/yaml.md
  - packages/toml.md
  - packages/jsonc.md
  - packages/config-file.md
  - packages/markdown.md
  - packages/glob.md
  - packages/semver.md
---

# Kit formatter convention

## Overview

A proposal for how `@effected/*` packages expose **formatting** as distinct from **validation**, and what fidelity guarantee a kit formatter makes. It exists because `@effected/package-json` invented a strict/tolerant split locally, under pressure from a real downstream consumer, and the kit must decide before `0.1.0` whether that becomes a convention or four packages each spell it differently later. Nothing has published, so the surface is still free; after `0.1.0` every divergent spelling is permanent.

**Status (2026-07-20): the decisions here are ratified and all of the surface work has landed** — `package-json`'s `PackageJsonFormat` rename and `Person` catch-all, the `*Result` primitives across `yaml`, `toml`, `glob` and `semver`, and finally `Jsonc.parseTreeResult` (2026-07-20), which closed the last surface item. What remains open is only the fidelity obligation of [decision 5](#decision-5--the-fidelity-obligation), which is a testing program rather than a surface change. The recommendations below are kept in their original form because they are the rules new surfaces get checked against; each carries its own landed marker.

The headline finding is that the convention is **mostly already satisfied**, and the doc's main work is not new surface but a stated fidelity obligation and a change to how it is tested. `@effected/yaml`, `@effected/toml` and `@effected/jsonc` already expose total, edit-based formatters that degrade to identity on input they cannot parse. `@effected/package-json` is the sole outlier, because it is the only package whose formatting path ran through a schema decode. **Mandating a tolerant twin in the other three would create dead surface**, which is worse than no convention.

## The driving constraint

Kit formatters ship into consumers' lint hooks — lint-staged, pre-commit. Those hosts hand you file contents and expect text back, synchronously. Two properties follow, and they are the whole basis of everything below.

**C1 — a formatter must not hard-fail on legal input.** `@effected/package-json`'s strict path throws `PackageDecodeError` on `{"private": true}` and on version-less roots, both perfectly legal `package.json` files. That made it unusable as a lint handler and the consumer kept routing around the kit to `sort-package-json`. A formatter that rejects legal input is not a formatter.

**C2 — a formatter must not silently rewrite legal input into a different-but-equivalent encoding.** Two bugs of this class were found in *released* packages, neither caught by its own suite:

- `@effected/package-json@0.3.1` — `Person` is a `Schema.Class` declaring only `name`/`email`/`url` with no catch-all, so an object-form author carrying `twitter` or `github` **loses that key** on a read→write round trip. Silent deletion.
- `@effected/yaml@0.4.0` — C0 control characters emitted raw in plain scalars, corrupting on round trip.

Fidelity is the whole job of a kit containing three format packages, and the suites are not catching fidelity bugs. C2 is why [the fidelity obligation](#decision-5--the-fidelity-obligation) is the longest section here.

### Why a convention, and not four local answers

Precedent, from this repo, today: the same downstream consumer wrote **four differently-shaped error folds for one compile-plus-expand glob pattern inside a single package**, because no kit package owned the seam. The fan-out produced a real bug — two divergent `dot` semantics in one package. Absent a stated convention the same fan-out happens across four format packages, and unlike the glob case it happens across published surfaces that cannot then be changed.

## Prior art: what `package-json` already decided

The shipped tolerant surface, from `dist/prod/npm/pkg/index.d.ts`:

```ts
declare const sortUnvalidated: <T extends { readonly [k: string]: unknown }>(value: T) => T;
declare const formatUnvalidated: (source: string, options?: PackageFormatTextOptions)
  => Result.Result<string, PackageJsonSyntaxError>;
```

Six decisions are embedded there. The convention **adopts five and revisits one** (the naming, [decision 1](#decision-1--naming)).

1. **A distinct module named for the capability, with its own entry points — never a flag on the strict path.** The strict path keeps its guarantees exactly, and a caller picks between them by name at the call site. Adopted as [P1](#the-rules).
2. **Two shapes, because two host shapes exist**: value→value and bytes→bytes. Both route through one internal sort so they cannot drift. Adopted as [P2](#the-rules).
3. **The value path is total and returns its input type `T`.** Load-bearing: an earlier draft added a `stripEmpty` option and `tsc` rejected it, because removing a key makes `T → T` a lie. The option was dropped rather than weakening the return to `Partial<T>`. The type system caught a fidelity violation at compile time — the only instance in the kit where it has. Adopted as [P3](#the-rules), and generalized into the rule the type was enforcing: **the value path only reorders; it never adds or removes a key.**
4. **The text path returns `Result`** (pure, sync), so sync lint hosts call it directly and Effect hosts lift with `Effect.fromResult`. Adopted as [decision 3](#decision-3--return-type-convention).
5. **Defaults deliberately diverge from the strict path** — `indent` defaults to `"preserve"`, and `stripEmpty` defaults to **false** because deleting a key the author wrote is exactly the silent edit C2 forbids. Adopted as [decision 4](#decision-4--options-type-convention).
6. **Non-objects pass through unchanged** rather than being mangled, so a mistyped union degrades to identity instead of losing data. Adopted as [P4](#the-rules), and it turns out to be the same rule the three format packages already implement.

## Survey: the four packages as they actually are

Read from the current working tree, not assumed symmetric.

| Package | Formatting surface | Shape | Fails on bad input? |
| --- | --- | --- | --- |
| `jsonc` | `JsoncFormatter.format` / `.formatToString` | `string → ReadonlyArray<JsoncEdit>` / `string → string` | No — documented "pure and total" |
| `yaml` | `YamlFormat.format` / `.formatToString` | same shape | No — "malformed input yields `[]` rather than corrupting the document" |
| `toml` | `TomlFormat.format` / `.formatToString` | same shape | No — same construction |
| `package-json` | `PackageJsonFormat.sortValue` / `.formatToString` | `T → T` / `string → Result<string, …>` | Text path fails on non-JSON only |

The three format packages converged **independently** on the same shape: a `*Format`/`*Formatter` concept class carrying total statics, edit-based (`format` returns edits, `formatToString` applies them), degrading to identity when the document cannot be parsed. `jsonc`'s source says so explicitly — the module was kept separate "so the jsonc and yaml surfaces stay structurally symmetric".

That convergence is the strongest evidence available about what the convention should be, because it happened three times without coordination. **The convention should ratify it rather than invent a fourth spelling.**

`package-json` differs for a real reason, not an accidental one: it is the only package of the four with a *schema* between text and text, so it is the only one where a formatting path could ever have hard-failed on legal input. The other three never decode into a validated model, so C1 was satisfied by construction and was never a live question for them.

## The rules

Four rules, stated so a reviewer can check a package against them.

**P1 — the tolerant path is its own named entry point, never a flag.** A `{ strict: false }` option on the strict path is banned: it makes the strict path's return type a union of guarantees and hides the choice from the call site and from `grep`.

**P2 — offer the shape(s) the hosts actually have, and route them through one implementation.** Value→value and bytes→bytes are different hosts, not a convenience pair; a package with only one kind of host ships only one entry point. Two entry points that re-derive the same ordering will drift, so they share the internal.

**P3 — the value path only reorders. It never adds or removes a key.** This is what makes `T → T` honest. A capability that must remove keys belongs on the text path with an explicitly-defaulted-off option, as `stripEmpty` is.

**P4 — input the formatter cannot handle is returned unchanged.** Never partially rewritten. `yaml` returning `[]` edits on a fatal parse error and `package-json` passing non-objects through are the same rule.

## Decision 1 — naming

**Ratified, and implemented in `package-json` on 2026-07-20: `*Unvalidated` is rejected as the kit spelling; the `*Format` concept class with total statics that three of four packages already used is the convention.** The reasoning below is kept as the rule new formatters are checked against.

`Unvalidated` is accurate for `package-json` and wrong everywhere else. In `yaml`, `toml` and `jsonc` there is no validation step to be un-done — the tolerant/strict distinction there is about *fidelity* and *error tolerance*, not schema decoding. A name minted for the one package that has a decode step, imposed on three that do not, describes nothing true about them. The brief's instinct is right and the survey confirms it.

The axis the name should capture is not "validated" but **whether the path decodes**. A decode-free path cannot normalize, because it never looks at the field: `package-json`'s own module comment makes exactly this point ("nothing here decodes, so nothing here can normalize"). That property — *source-preserving* — is the guarantee a consumer is shopping for.

Concretely, `package-json` converged on the shape its three siblings already have — this is `src/PackageJsonFormat.ts` as built:

```ts
export class PackageJsonFormat {
  static sortValue: <T extends { readonly [k: string]: unknown }>(value: T) => T;
  static formatToString: (text: string, options?: PackageFormatTextOptions)
    => Result.Result<string, PackageJsonSyntaxError>;
}
```

`formatToString` is the name the other three already use for bytes→bytes, so a consumer who has met one kit formatter has met all four. `sortValue` carries the shape distinction that `package-json` uniquely needs. The word `Unvalidated` disappears; the guarantee moves into the class's doc comment, where it can be stated precisely instead of compressed into a prefix.

This was a rename of an **unpublished** surface, which is why it cost one module and one `index.ts` edit; it would have been unavailable after `0.1.0`.

## Decision 2 — which packages need a tolerant seam

**Recommendation: only `package-json`. `yaml`, `toml`, `jsonc` and `config-file` add no new surface.**

- **`yaml` / `toml` / `jsonc` — nothing to add.** Their formatters are already total, already edit-based, already identity-degrading. They satisfy C1 by construction. A mandated `formatUnvalidated` twin here would be an alias for an existing total function — dead surface, and dead surface that has to be maintained and documented forever. What these three *do* take on from this proposal is [the fidelity obligation](#decision-5--the-fidelity-obligation), which is a testing change, not a surface change.
- **`package-json` — the one seam.** Built, and renamed to `PackageJsonFormat` per [decision 1](#decision-1--naming).
- **`config-file` — out of scope, deliberately.** Its codec seam is `parse: (raw: string) => Effect.Effect<unknown, E>` — a *loading* pipeline where decode-and-validate is the entire point, and whose host is an application at startup, not a synchronous lint hook. Neither C1 nor the sync constraint applies. Adding a tolerant path there would mean "load this config but don't check it", which is not a capability anyone wants. Recorded here so the question is not reopened.

A convention that mandates surface nobody calls is worse than no convention. Three of five packages correctly opting out is the expected outcome, not a weakness of the proposal.

## Decision 3 — return-type convention

**Recommendation: a three-way rule keyed on whether failure is possible. Never `Effect` on a tolerant formatter entry point.**

1. **Cannot fail → total.** Plain return, no wrapper. `yaml`/`toml`/`jsonc` `formatToString`, `package-json`'s value path.
2. **Can fail, pure and sync → `Result`.** `package-json`'s text path, where `JSON.parse` genuinely can fail on non-JSON.
3. **`Effect` is not permitted here.** Lint hosts are synchronous; an `Effect` return forces every one of them to build a runtime to format a file.

Effect hosts are not penalized: `Effect.fromResult` (verified present in `effect@4.0.0-beta.99`, `<A, E>(result: Result.Result<A, E>) => Effect<A, E>`) lifts case 2 in one call, and case 1 needs no lifting at all. The `Result` return is strictly more useful than an `Effect` return, because it serves both host kinds.

**A known hazard, accepted.** Totality plus identity-degradation (P4) means a host cannot distinguish "already correctly formatted" from "unparseable, I gave up". The recommendation is to **keep the totals total** — narrowing them now would break the one property that makes them safe in a lint hook — and to note that every one of these packages already exposes a parse entry point carrying typed diagnostics, so a host that needs to tell the difference probes with `parse` first. This is left as [open question 2](#open-questions).

## Decision 4 — options-type convention

**Recommendation: each package keeps its own options type. No shared kit-wide formatter options shape.**

Justification is threefold:

1. **The options are irreducibly format-specific.** `jsonc` wants `tabSize`/`insertSpaces`/`eol`; `package-json` wants `indent`/`sort`/`stripEmpty`/`newline`. A shared type is either a lowest common denominator that constrains all four, or a union that carries members meaningless to three of them. Both are worse than duplication.
2. **A shared options type is a cross-package coupling that has to live somewhere.** Every package would take an edge on whichever package owned it, for a type alias. The [acyclic-graph rule](effect-standards.md#cross-effected-dependencies) says the fix for a shared thing wanted in both directions is usually a third package; a third package existing solely to hold four optional booleans does not earn its slot in a kit that releases as one unit.
3. **`package-json` carrying both `PackageFormatOptions` and `PackageFormatTextOptions` is correct, not duplication to be cleaned up.** `sourceText` is meaningless on the text path (the text *is* the source), and the defaults deliberately differ. Collapsing them would require either a member that is ignored half the time or a shared default that is wrong half the time.

What the convention *does* mandate is documentation discipline, because the divergent defaults are exactly where a silent edit hides: **where a tolerant options member's default differs from its strict counterpart, the divergence and its reason are documented on the member.** `package-json` already does this well — `indent: "preserve"` because "reformatting a file in place should not silently restyle its indentation", `stripEmpty: false` because "an empty map is a key the author actually wrote". Copy that standard.

## Decision 5 — the fidelity obligation

This is the part that changes behavior. Both shipped bugs passed their suites, so a convention that does not change how fidelity is tested will not prevent the next one.

### The obligation

**A kit formatter changes key order, whitespace and the trailing newline. It changes nothing else.** Every key, entry, comment and scalar value present in the input is present, and semantically identical, in the output.

### Why both bugs escaped: two round-trip directions

There are two directions, they catch different bugs, and the kit currently tests only the one that catches neither shipped bug.

- **Direction A — value round trip**: `parse(stringify(v)) ≡ v`. Start from a value, go out to text, come back. This is what `yaml`'s single property test asserts ("parse recovers what stringify produced").
- **Direction B — source round trip**: `emit(parse(t))` preserves everything `t` carried. Start from *source text*, decode, re-emit.

Both bugs are Direction B failures, and **Direction A is structurally incapable of catching either**:

- **`Person`/`twitter`.** The arbitrary is derived from the schema, and the schema declares only `name`/`email`/`url`. A schema-derived generator can only produce what the schema models, so the unknown key that gets dropped **is never generated in the first place**. Schema-derived arbitraries are blind to catch-all loss by construction — the more faithfully the generator follows the schema, the more reliably it misses this class of bug.
- **YAML C0 controls.** The property's alphabet is `Schema.String`, whose default arbitrary does not emit C0 control characters. The corrupting input is never generated.

The lesson generalizes past these two: **Direction A tests the emitter against the model, and fidelity bugs are precisely the cases where the model is not the whole truth about the source.**

### The rules

**F1 — Direction B is the obligation, and it must be tested directly.** For any input the package accepts: re-parsing the formatted output yields the same value as parsing the input, and every key present in the source is present in the output.

**F2 — Direction B properties are driven by source-shaped generators, never schema-derived ones.** Where a model has a catch-all, the generator **must** emit keys outside the model. This is the rule that catches `Person`. Where a model has no catch-all but the format permits unknown keys, that is itself the finding — see the [conflict](#surfaces-that-conflict-with-this-proposal) below.

**F3 — the generator's alphabet includes the ranges the emitter is obliged to escape**: C0 controls, lone surrogates, newlines inside scalars, and the format's own quote and comment metacharacters. This is the rule that catches the YAML C0 bug. Corollary, and the important half: **an exclusion from a fidelity generator is a documented decision carrying a reason, never a silent default.** `@effected/toml`'s `oracle.property.test.ts` is the standard to copy — it documents every exclusion (datetimes, lone surrogates, NaN) with the probe that justified it. It is the strongest fidelity testing in the kit and the only suite of the four written to catch this bug class.

**F4 — identity on non-handled input**, per [P4](#the-rules). Assert it: input the formatter cannot process comes back byte-identical.

**F5 — idempotence.** `format(format(t)) === format(t)`. Cheap to assert, and it catches a distinct class — an emitter that is stable on its own output but not on the author's.

### Tier discipline applies

A fidelity suite must not smuggle IO into a pure-tier package. `yaml`, `toml` and `jsonc` are **pure tier** ([R1](effect-standards.md#dependency-policy)); their fidelity properties take `content: string` like everything else in them. A corpus-driven differential test reading files from disk is legitimate only as it is in `toml` today — a test-only surface, with the reader in `__test__/`, never in `src/`. This exact mistake — a tolerant path doing IO inside a pure-tier package — was caught in `glob` today, which is why it is written down.

## Decision 6 — the sync primitive policy

This section generalizes [decision 3](#decision-3--return-type-convention) past formatting, to every pure boundary in the kit. It is in this doc rather than its own because it answers the same question: **what shape does a pure kit boundary expose?**

### The policy

**Pure computation exposes the sync form as the primitive; the Effect form is derived from it and adds only the tracing span.**

A surface is in scope when it is a public boundary that returns `Effect` with `R = never`, has no async step and does no IO — i.e. the `Effect` wrapper carries nothing but a span and the error channel. For those, the `Effect` is a tax: it forces `Effect.runSync` on every synchronous consumer, and synchronous consumers are real (lint-staged handlers must be synchronous, per [C1](#the-driving-constraint)).

The derivation is one line, verified against `effect@4.0.0-beta.99`:

```ts
static parseResult(text: string): Result.Result<A, E> { /* the engine */ }
static readonly parse = Effect.fn("X.parse")((text: string) =>
  Effect.fromResult(X.parseResult(text)),
);
```

Three properties make this cheap and safe. The change is **purely additive** — the `Effect` signature is unchanged, so no consumer breaks. The span is **preserved**, so observability is not traded away. And the two forms **cannot drift**, because one is defined in terms of the other rather than re-deriving the engine ([P2](#the-rules) applied to a second axis).

### This is not a new rule — it is a consistency finding

**The policy already exists, and this doc ratifies it rather than minting it.** Its history:

- **Issue #111 / PR #112** established it in `@effected/jsonc`, adding `Jsonc.parseResult` — "a pure synchronous `Result`-returning parse variant" — for a non-Effect config loader avoiding `Effect.runSync(Effect.result(...))` ceremony.
- **Issue #115** (closed by the 2026-07-20 `parseTreeResult` PR) proposes adopting it kit-wide across the format packages, and states the pattern in the same terms this doc does: *"a `*Result` variant per parse entry point, with the Effect variant defined in terms of it behind its existing named span so the two can never diverge."*
- **`@effected/glob` rediscovered it independently** on 2026-07-20, from a lint-staged handler in `savvy-web/systems` that must be synchronous — with no knowledge of #111, #112 or #115.
- It is referenced by name as "Result-parity" in two plugin skills (`effect-v4-observability`, `effect-v4-testing`), and carries a settled TSDoc phrasing: *"Defined in terms of `X.parseResult` — synchronous callers can use that variant directly."*

Two unrelated consumers — a non-Effect config loader and a lint-staged handler — converging on the same requirement from different directions is strong evidence the policy is correct. **That `glob` had to rediscover it is the reason this section exists.** The policy lived only in issue threads, where a designer working in a non-format package had no path to it; that is precisely why `glob` and `config-file` did not follow it. Giving it a home in the design docs is the substantive change here.

So the audit below does not find four surfaces needing four fixes. It finds **one convention with several packages at different stages of adopting it**, and the work is alignment, not invention.

### Correction to #115's stated scope

One premise in #115 is stale and should not be carried forward. The issue says of `@effected/yaml`: *"`Yaml.parse` has no Result variant (`parseSync` throws rather than returning a Result)."* **That is not true, and was not true when the issue was filed.**

`Yaml.parseSync` has returned `Result.Result<unknown, YamlParseError>` since it was introduced in `9d350ad4` (#106) at 2026-07-17 17:30; #115 was filed 2026-07-18 03:45, ten hours later. Verified by reading the signature as introduced, not the current one.

`yaml` was therefore **not** missing the variant. What it actually had was a naming divergence ([decision 6a](#decision-6a--which-spelling-the-kit-ratifies)) and a derivation defect ([finding 4](#surfaces-that-conflict-with-this-proposal)) — the latter a violation of #115's own clause "so the two can never diverge". Both were fixed on 2026-07-20, so the package is now out of the ticket's scope entirely, having never been in it for the reason recorded.

### Audit results

Read from source in the working tree. Signatures are as written, not paraphrased. The **#115** column records whether the surface is in that ticket's scope, so the ticket and this doc do not drift.

| Surface | Verdict | #115 | Evidence |
| --- | --- | --- | --- |
| `Jsonc.parseResult` / `.stringifyResult` | **Already compliant** — the origin | Done (#111/#112) | `packages/jsonc/src/Jsonc.ts:308,444` — `Result.Result<unknown, JsoncParseError>`; `parse` is `Effect.fromResult(Jsonc.parseResult(...))` |
| `Markdown.parseResult` / `.stringifyResult` | **Already compliant** | Not listed | `packages/markdown/src/Markdown.ts:206,246`; `MarkdownDocument.parseResult:395`; both `Effect` forms derive via `Effect.fromResult`. Adopted the pattern without being ticketed |
| `Jsonc.parseTree` | **Now compliant** — landed 2026-07-20 | Closes #115's final item | `packages/jsonc/src/Jsonc.ts:371,396` — `parseTreeResult` returns `Result.Result<Option.Option<JsoncNode>, JsoncParseError>` immediately above `parseTree`, which derives via `Effect.fromResult` behind its existing `Jsonc.parseTree` span |
| `Yaml.parseResult` / `.stringifyResult` | **Now compliant** — renamed and the derivation fixed, 2026-07-20 | Closes #115's yaml item, [rescoped](#correction-to-115s-stated-scope) | `packages/yaml/src/Yaml.ts:491,520`; `Yaml.parse` is now `Effect.fromResult(Yaml.parseResult(...))`, so the duplicated engine of [finding 4](#surfaces-that-conflict-with-this-proposal) is gone |
| `Toml.parseResult` / `.stringifyResult` | **Now compliant** | Closes #115's toml item | `packages/toml/src/Toml.ts:221,274`; both `Effect` forms derive via `Effect.fromResult` behind their existing spans |
| `GlobPattern.compileResult` / `GlobSet.compileResult` | **Now compliant** — added and renamed 2026-07-20 | Out of scope (not a format package) | `packages/glob/src/GlobPattern.ts:186,217`, `GlobSet.ts:136,163` — derives via `Effect.fromResult` |
| `SemVer.parseResult`, `Range.parseResult`, `Comparator.parseResult` | **Now compliant** | Out of scope | `SemVer.ts:159`, `Range.ts:117`, `Comparator.ts:110`; `Range.intersectResult:219` closed the adjacent surface too |
| `SemVer.compare` / `Range.satisfies` and the comparison statics | **Refuted** | Out of scope | `SemVer.ts:174`, `Range.ts:111` — already `(self, that) => -1 \| 0 \| 1` and `=> boolean`, plain and total via `Fn.dual`. Nothing to do |
| The four `config-file` codecs | **Refuted** — see below | Out of scope | `packages/config-file/src/{Json,Jsonc,Yaml,Toml}Codec.ts` |

The two surfaces flagged in #115's comment as unverified — the codecs and `semver`'s comparison boundary — are **both refuted**, on independent grounds, and neither needs a ticket.

**This table fully closed on 2026-07-20.** `yaml`, `toml`, `glob` and `semver` landed their `*Result` primitives in one pass, `yaml`'s derivation defect went with the rename, and `Jsonc.parseTreeResult` followed the same day — see [the remaining work](#scope-of-the-remaining-work).

### Why the codecs are refuted

The four codecs shape-match the policy and fail it for a structural reason, so the earlier `format-seam-spec` conclusion holds here too — but on different grounds, which are worth stating so the question is not reopened a third time.

The codecs do not own their signature. They implement an **interface**:

```ts
// packages/config-file/src/ConfigCodec.ts
export interface ConfigCodec<E = ConfigCodecError> {
  readonly name: string;
  readonly parse: (raw: string) => Effect.Effect<unknown, E>;
  readonly stringify: (value: unknown) => Effect.Effect<string, E>;
}
```

The `Effect` there is not a span wrapper — `JsonCodec` and `JsoncCodec` do not even open a span, they are bare `Effect.try`. It is the **polymorphism that makes the seam composable**: `E` is generic precisely so decorator codecs (`EncryptedCodec`, `ConfigMigration.make`) can wrap a codec, widen the error channel and return a codec. A sync twin would mean a parallel sync interface and a parallel decorator stack for every decorator, to serve a host that does not exist.

And the host genuinely does not exist: `format-seam-spec`'s reasoning applies unchanged. A codec is consumed by `ConfigFile.layer` — a loading pipeline, hosted by an application at startup, which is already in `Effect` and reads files through `FileSystem`. There is no synchronous lint hook downstream of a codec. **The sync pressure is real one level up, in the format packages, and that is exactly where the fix belongs** — `YamlCodec` reaching `Yaml.parse` rather than `Yaml.parseSync` costs nothing, because its own caller is already effectful.

This is the general shape of the rule's boundary: *the policy applies to the engine, not to every adapter over it.*

### Decision 6a — which spelling the kit ratifies

**Ratified: `*Result`. `yaml` and `glob` were renamed to match on 2026-07-20, and `*Sync` no longer names a pure-computation surface anywhere in the kit.** The reasoning is kept because it is the rule new surfaces are checked against, not because the question is still open.

Two spellings existed when this was decided, and the split was not even:

- `*Result` — `jsonc` (2 surfaces, and the origin at #111/#112), `markdown` (3+). Also the spelling #115 proposes and the plugin skills name.
- `*Sync` — `yaml` (2), `glob` (2, added 2026-07-20).

Three arguments, in ascending order of force.

1. **Precedent.** `*Result` is where the policy started, what the open ticket proposes, and what the skills call it. `*Sync` has no documentary basis; both instances of it were written by implementers unaware of the policy.
2. **Accuracy.** `Sync` names a distinction that does not exist. **The `Effect` form is also synchronous** — that is the entire premise of this policy: there is no async step anywhere in either form, which is exactly why the wrapper is a tax. `Result` names the one thing that actually differs: the return type.
3. **`*Sync` is already taken in this kit, for an incompatible meaning.** `@effected/workspaces` ships a sync facade family — `findWorkspaceRootSync`, `getWorkspacePackagesSync`, `readPackageSync` (`packages/workspaces/src/WorkspacesSync.ts:191,231,…`, 19 synchronous IO calls in the module). Those are **genuinely IO-performing** functions whose sync-ness is the salient and surprising property, and `findWorkspaceRootSync` returns `string | null` — **not** a `Result`. So within one kit `*Sync` would mean both "does blocking IO, returns a nullable" and "pure computation, returns a `Result`". That collision is a real comprehension hazard, and it is the argument that settles it.

Both renames were of **unpublished** surface, which is why they were cheap; after `0.1.0` the kit would have carried two spellings of one concept permanently, one of them colliding with `@effected/workspaces`'s IO facade family.

### Scope of the remaining work

Landed on 2026-07-20: `toml`'s `parseResult`/`stringifyResult`, `semver`'s three `parseResult` statics plus `Range.intersectResult`, `yaml`'s rename and derivation fix, and `glob`'s rename. None of it was behavior change.

The last item, `jsonc`'s `parseTreeResult(text, options?): Result<Option<JsoncNode>, JsoncParseError>`, landed later the same day (2026-07-20), completing that package's own symmetry and closing **#115**'s final item. No surface remains open under this decision.

## Surfaces that conflict with this proposal

Findings, per the brief. **Not fixed here.**

1. ~~**`Person` has no catch-all, and `package-json`'s own docs claim it does.**~~ **Fixed 2026-07-20.** `Person` now carries the same `rest` catch-all as `Package`, unknown keys landing in it on decode and flattening back on encode, and `index.ts` states which models are object-shaped rather than implying every leaf preserves unknown keys. Recorded because the shape of the bug generalizes: the fidelity claim lived in a package-level doc comment while the guarantee was per model, so nothing checked one against the other. That is what [F2](#the-rules) exists to catch.
2. ~~**`sortUnvalidated` / `formatUnvalidated` are floating functions**~~ **Resolved by [decision 1](#decision-1--naming)** — they are now `PackageJsonFormat` statics, matching the three sibling packages and [the DX north star](effect-standards.md#dx-north-star). The remaining floating helpers in `package-json` (`isValidSpdx`, `defaultRules`, `isUnresolvedDependency`) are untouched and stay a tension rather than a violation.
3. **No fidelity (Direction B) test exists in any of the four packages.** A case-insensitive search for round-trip tests across all four `__test__/` trees finds one property, `yaml`'s, and it is Direction A. `toml`'s oracle is the nearest thing to a fidelity suite and is a differential against `smol-toml` rather than a stated source-preservation property.
4. **`Yaml.parse` duplicated the engine instead of deriving from the sync form — fixed 2026-07-20.** It called `composeFirstDocument`, `failureRecords` and the alias-budget logic inline while the sync form called the same three independently: [P2](#the-rules) violated on the sync axis, in the one package that had already shipped a fidelity bug a divergent second copy would make harder to fix once. `Yaml.parse` now routes through `Effect.fromResult(Yaml.parseResult(...))`, so `parseResult` is the package's single parse path. `Yaml.stringify` was never affected — it correctly shares `stringifyOrFail` — and still does not derive from `stringifyResult`, which is a cosmetic asymmetry rather than a second engine. Kept here as the record of why the derivation, not the rename, was the real work.

## Open questions

1. ~~**Does the `*Unvalidated` rename happen before `0.1.0`?**~~ **Resolved 2026-07-20: yes, and it landed** as `PackageJsonFormat`.
2. **Should the total formatters gain a way to signal "could not parse"?** Recommendation: **no change.** Totality is what makes them safe in a lint hook, and `parse` already provides the diagnostic to any host that needs it. Flagged because it is a real ergonomic gap and the decision should be conscious rather than inherited.
3. ~~**Does the `Person` catch-all fix land in `0.1.0`?**~~ **Resolved 2026-07-20: landed.** [F2](#the-rules) is now assertable for `package-json`.
4. ~~**Does the `*Sync` → `*Result` rename happen before `0.1.0`?**~~ **Resolved 2026-07-20: yes, and it landed.** See [decision 6a](#decision-6a--which-spelling-the-kit-ratifies).
5. ~~**Do the remaining gaps gate `0.1.0`?**~~ **Resolved 2026-07-20: fully moot.** `toml`, `semver`, `yaml` and `glob` landed with the renames, and `jsonc.parseTreeResult` landed the same day. No gap remains to gate.
6. **Should #115 be updated?** The ticket's yaml premise is factually stale ([see correction](#correction-to-115s-stated-scope)) and its scope no longer matches what shipped — `semver` and `glob` landed outside it. With `Jsonc.parseTreeResult` landed (2026-07-20), nothing inside the ticket remains open; the PR carrying that change closes #115, so no rescoping is needed. **Not actioned here** — this doc does not file or edit issues on its own judgment.
7. ~~**Is the sync primitive policy a `plugin/skills` rule as well as a design doc?**~~ **Resolved 2026-07-20: yes — landed.** `effect-v4-observability` now states Result-parity as the ratified rule with its scope test (sync `*Result` primitive on in-scope boundaries, Effect form derived behind its span, `*Sync` rejected, a missing twin a review finding), and `effect-v4-testing`'s Result narrowing trap lists the full settled kit surface instead of `Jsonc.parseResult` alone.
8. **Is the `toml` oracle pattern worth replicating for `yaml` and `jsonc`?** Not recommended as a mandate. Both would need a reference implementation to differ against, which reintroduces a dependency question ([R1](effect-standards.md#dependency-policy)) for a devDependency-only benefit. The F1–F5 properties are the mandate; an oracle stays a per-package judgment call where a suitable reference exists.
