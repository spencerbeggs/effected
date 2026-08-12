---
status: current
module: effected
category: architecture
created: 2026-07-18
updated: 2026-08-12
last-synced: 2026-08-12
completeness: 90
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../formatter-convention.md
  - github-actions.md
  - jsonc.md
  - yaml.md
  - toml.md
  - config-file.md
---

# @effected/markdown design

## Overview

`@effected/markdown` is CommonMark + GFM as pure Effect Schema schemas: parse, edit, validate and transform markdown documents. Markdown is the kit's communication layer with AI agents — skills, context files, knowledge documents — and this package makes that layer typed and programmable.

It carries the full-parity ambition of its format siblings [jsonc](jsonc.md), [yaml](yaml.md) and [toml](toml.md): parse, edit, format and a shared surface contract, not a read-only projection. Second in size only to yaml.

**Markdown→HTML and HTML→markdown are explicitly out of scope as product features.** HTML exists only as test-harness machinery for the conformance corpus.

## Tier and dependencies

**Pure tier.** No IO, the engine is owned in `src/internal/`, and there are no external runtime dependencies. `peerDependencies` is `effect` plus **optional** kit peers on [yaml](yaml.md), [toml](toml.md) and [jsonc](jsonc.md), consumed only by the respective frontmatter codec modules — a recorded delta from [config-file](config-file.md), whose peers are not optional.

The commonmark.js port carries upstream attribution and license headers per the vendored-port convention the yaml and jsonc engines established. `"sideEffects": false`.

## Engine: a hardened commonmark.js port, modularized like micromark

The engine is a vendored, hardened port of **commonmark.js** — the reference parser maintained by the spec author — implementing the spec appendix's two-phase strategy: a block pass with lazy continuation, then an inline pass with the delimiter stack. The port is restructured as **construct-per-module** under `src/internal/` with **dialect-keyed registries**: a block-starts table and an inline-trigger table per dialect. That is micromark's decomposition without its CPS machinery.

The alternatives were evaluated and rejected: wrapping mdast/remark as runtime dependencies violates the [R1 pure-tier rule](../effect-standards.md#dependency-policy); porting micromark is several times the effort and its extension ecosystem would not plug into an Effect port anyway; and parser combinators cannot express lazy continuation or the emphasis delimiter algorithm — **CommonMark deliberately has no formal grammar.**

Two implementation notes that are load-bearing rather than incidental:

- **The inline pass builds a mutable linked list** of tokens and materializes the immutable node Schema classes only once that list is final. The array form would reintroduce the quadratic behavior the delimiter stack exists to prevent.
- **The frontmatter block, when enabled, is captured raw at the top of the block pass** and never enters the inline pass.

## mdast-shaped nodes

Node Schema classes use mdast's exact node type names and field shapes — the CommonMark types, the GFM additions and the frontmatter node. Positions are unist positions with line/column **and** byte offsets. Fidelity fields — bullet char, fence char and info string, ATX vs setext, delimiter runs, spacing — ride alongside the mdast shape, and the `Mdast` module projects to plain spec-valid mdast JSON by stripping them. The mdast spec is stable and permissively licensed, which makes shaping to it a safe bet.

Two rulings govern the shape:

- **Node discriminators use `Schema.Class` with an explicit tag field named `type`, not `Schema.TaggedClass`.** `TaggedClass` is unusable for a foreign contract because it hardwires the `_tag` key, and mdast's contract requires exactly `type`. This is scoped to the foreign mdast contract: the package's *own* unions, like the `$schema` declaration union, do use `TaggedClass`.
- **Optionality follows mdast's own readme, not a summary of it.** Fields the spec types as optional booleans are `optionalKey`, with absence meaning unknown rather than false.

### Three deltas from commonmark.js

Decided up front, not discovered mid-port:

1. **mdast type names**, not commonmark.js names.
2. **Byte offsets tracked everywhere** — commonmark.js has only line/column sourcepos, and offsets also power the edit layer.
3. **Definition nodes are kept in the tree** and reference nodes are emitted unresolved, per mdast semantics. commonmark.js deletes definitions and resolves references eagerly, which is wrong for an editing library. The port also retains the concrete-syntax markers mdast drops.

Reference **formation** still follows the CommonMark spec exactly — a link or image label with no matching definition stays literal text, never a reference node. The delta is only the emitted node *shape*.

## Dialects: a closed set, no public extension API

Matching toml and yaml's zero-plugin posture: a dialect option defaulting to GFM, plus a frontmatter toggle. GFM means tables, strikethrough, autolink literals, task-list items and tagfilter, **plus footnotes** — footnotes are a cmark-gfm/GitHub extension rather than GFM spec text, included as table stakes.

A future `obsidian` dialect is an explicit design goal, and it must land purely as new construct modules in the dialect registries with **no public API change**. That constraint is the acceptance test for the registry design.

Two constructs are **seams inside base constructs, not registry entries**, because that is how cmark-gfm itself expresses them: footnote handling lives inside close-bracket handling, and inside the image opener so that a footnote marker never opens an image. The port expresses these as parameterized construct factories swapped into the GFM table; the CommonMark dialect takes the no-seam defaults and is byte-for-byte unchanged.

**Autolink literals split by offset fidelity.** Scheme and www literals are inline constructs over raw source, so offsets stay true; email literals run as a postprocess after the delimiter stack is spent, supported by a postprocess hook and a guarded scanner primitive.

## Frontmatter: the config-file codec pattern, in-package

The core engine captures the frontmatter block as a raw fidelity-preserving node — text plus a format marker. Schema decoding ships as **free-standing named codec modules**, one per format, peering on the corresponding format package. **Never a namespace object**: the [config-file tree-shaking rule](config-file.md) applies verbatim, and a JSON-frontmatter consumer must not pay for the yaml engine. mdast has no native frontmatter parsing story, so this is a differentiator.

**Capture defaults off.** An enabled capture changes how a leading `---` parses and the spec corpora contain such documents, so the toggle is the consumer's opt-in and the conformance harnesses run untouched.

**The fence grammar is a closed set** — the yaml, toml and JSON spellings, with gray-matter and remark-frontmatter as the authorities. An unclosed fence is not frontmatter and emits no diagnostic. The capture runs as an offset-0 pre-scan in the block-parser constructor rather than as a registry construct, because it fires at most once and before any block.

**One capture node, not per-format classes.** mdast has no JSON frontmatter name, so a per-format split would invent a non-mdast type anyway, and one shape keeps the codec contract format-uniform. The root's children widen to admit frontmatter at the root and nowhere else.

### Read and write

The codec contract carries **both directions, and encode is required, not optional** — the codecs stay field-identical, pinned by a contract-shape test. Encoding serializes data to the body text that belongs **between** the fences and never the fences themselves, which are format-determined and rendered by the seam.

**The seam normalizes the trailing terminator**, because the engines genuinely disagree: two of the three emit a final newline and the JSON one matches `JSON.stringify` and does not. Normalizing at the one render site rather than in each codec keeps the divergence from leaking into the contract.

The writer produces **exactly one edit** — either a replacement spanning the whole capture, both fence lines included, or with no capture an offset-0 insert of the block plus a separator. **A capture of a different format fails typed**: fences are never switched, so writing cannot silently convert a toml block to yaml. The parse precondition mirrors the read side, because without the capture toggle absence is ambiguous and the insert path would double a block the parse ignored.

**Per-codec empty-object rulings** are each chosen so write-then-read recovers an empty object: yaml encodes to the flow mapping, deliberately not an empty body, because an empty body round-trips as yaml's empty-document null and would lose the object; toml encodes to the empty body, mirroring the decode ruling that an empty toml capture is an empty object; JSON encodes to braces, having no empty-document value in either direction.

**Whole-block re-serialization is the caveat.** The block is re-serialized whole from the encoded data — gray-matter parity, not surgical editing — so anything the format's data model does not carry is lost, and comments inside a yaml frontmatter block do not survive a write. A per-key surgical mode over the format packages' own edit layers is recorded future work; the siblings already ship the machinery it would sit on.

### Absence is two facts, and the discriminant is derived

The missing-frontmatter error carries a required reason, because a genuinely blockless document and a document that opens with a fence but was parsed without the capture toggle are **different problems with different fixes**: the first needs content, the second needs a parse option.

The ruling worth keeping is *how* the accessor answers: **derived, not stored.** The getter runs the **same** offset-0 pre-scan the parser runs when capture is enabled, so it is true exactly when parsing this source with capture on would produce a node. A stored flag set at parse time would be a second source of truth for a question the source already answers, and the failure mode is silent — a document constructed or edited without going through that path would report an absence contradicting its own bytes. Because the error's reason reads the same accessor, the error, the getter and the capture **agree by construction**. The cost is honest: it recomputes per access, like every other navigation accessor, so bind it once when checking repeatedly.

### The `$schema` declaration grammar and resolver seam

Frontmatter blocks may self-describe their schema. The package **classifies the declaration by shape** into a tagged union and this is the full grammar contract:

- **By URL** and **by path** are carried as data and never resolved in-package — no IO in the pure tier.
- **Inline** (the value is a mapping) is likewise carried as data, interpretable only via an external resolver. The kit deliberately has no JSON Schema engine, and `@effected/json-schema` is off the roadmap entirely.
- **By name** is any other string, with a committed grammar of `name[@version]`, **split at the last `@`** so a leading npm-style scope survives. The version grammar is internal and dependency-free: one to three dot-separated non-negative integers, with no prerelease, no build metadata and no range operators. [@effected/semver](semver.md) was consciously declined as a peer so the resolver module depends on nothing. The recorded cost: `@` in a by-name declaration is reserved forever as the version separator, except the leading scope `@`.

Resolution lives behind an in-package **seam**: a resolver contract that, given the declaration **and the whole decoded frontmatter data**, returns a schema or fails typed. The package ships one registry-backed implementation. Because the resolver sees the whole decoded frontmatter, **dispatch need not key on the declaration at all** — a resolver for a foreign convention can dispatch on that convention's own key with zero knowledge of it in this package.

Resolution is **exact version-segment equality**, compared numerically per segment, so leading zeros are legal and numerically colliding registrations throw at construction as programmer errors. A versionless declaration matches only a versionless registration; both mismatch directions fail with the dedicated version error rather than unknown-name. A partial version is legal grammar yet resolves only against an identically-written registration.

The documented future minor is **prefix resolution** — the Docker-tag mental model, where a partial version selects the highest matching registration. No grammar or API change is needed; the version error simply stops firing for satisfiable prefixes, which makes it a clean semver-minor evolution.

## Editing: offset-splice, not a lossless CST

Research finding, recorded: **nobody in the JS ecosystem ships a lossless markdown CST.** remark's serializer reformats by design, and its maintainers themselves recommend positional splicing.

The edit model is therefore the house pattern — an offset/length/content edit plus an apply-all — **structurally identical to the jsonc, yaml and toml edit vocabularies**. That is the binding cross-package parity contract and the pre-work for the deferred text-edit kernel. Surgical edits are computed as offset-splices over the original source; the canonical stringifier serves synthesized trees.

Apply-all adopts toml's overlap-rejection posture, and range filtering adopts toml's owning-node-intersection posture. Apply-all is now harmonized across all four format packages; the **range-filter posture** is the one place they still document different filters, and markdown follows toml's.

**Canonical stringify serializes fidelity-first** with a recorded defaults table, and its escaping is a conservative always-escape set plus line-start and raw-source-autolink defenses, with the corpus-wide re-parse equivalence property as the authority. One default is worth naming here because it surprised a real consumer: a **language-less code node with no explicit fence char stringifies as an indented block.** That is correct and canonical; the TSDoc names it outright rather than leaving it to be discovered.

**`format` is conservative-by-skipping**: marker-normalization options only, with hazardous conversions skipped rather than attempted cleverly, and both zero-edits-on-canonical and format idempotence pinned.

**`modify` is strict with no raw markdown**: replacements are node fragments or literal strings rendered through the canonical stringifier, so modified documents re-parse cleanly by construction. Its refusals — list items, table rows, frontmatter, the root, and multi-line replacements into prefixed containers — fail typed with a code naming which refusal applied.

### codeBlockStyle: the one conversion knob

Converting between fenced and indented code is a **separate, opt-in formatting option**, and the ruling has two halves:

- **The fence char is never converted, and does not become the knob.** It is a *fidelity* field — what the source said — and having a formatting option silently repurpose a fidelity field is how a formatter starts lying about the document it read. "Record what was there" and "change what is there" stay different verbs.
- **Both directions skip on hazard rather than converting cleverly.** The indented direction is where the hazards live, because an indented block re-parses differently depending on its neighbours: it applies to root-level, flush-left, language-less blocks only, and skips a block that would lazily continue a preceding paragraph, be absorbed by a preceding list or footnote definition, merge with an adjacent code block across the blank line, or has no indented spelling at all. **Each skip is a case where the conversion is representable and wrong**, which is exactly the class the conservative posture exists for.

## Error posture: parse is near-total

**CommonMark has no syntax errors** — every string is a valid document. The parse error channel carries **only hardening-guard failures** such as depth caps and expansion budgets, never "malformed markdown". Diagnostics carry warnings, and strict or failing validation lives at the schema layer rather than the parser.

This diverges from the format siblings for a spec reason, not a design one, and the diagnostics array does the recoverable-parse work those packages put on their error channel.

## Module layout

One concern per file, mirroring [yaml's layout](yaml.md#module-layout); `src/index.ts` is the sole barrel. See `src/` for the full list. The placements that are decisions:

- **`MarkdownNode.ts` co-locates every node class in one file** to break the recursive-AST cycle: `Schema.suspend`, no parent pointers, recursive references typed as codecs. It also owns the position type and the node-type selector vocabulary.
- **`FrontmatterResolver.ts` is its own module** so the frontmatter seam stays a lean composition point and a consumer who never resolves declarations never loads the resolution machinery.
- **The three frontmatter codecs are separate modules**, per the tree-shaking rule above.
- **`src/internal/` never imports public modules** — the raw-carrier cycle firewall, with the facade materializing diagnostics.

House schema conventions apply throughout: `make` rather than `new` in the public surface, bare `optionalKey` fields with implementation-level defaults, and the Effect-wrapping policy — pure sync where total, `Effect` where the error channel is real, `Stream` for the visitor.

### Navigation and traversal

The visitor is a tagged-enum event union walking the **already-parsed tree** rather than text — the one deliberate divergence from the yaml/toml text-visitor convention, possible because parse and walk are separable surfaces here. The stream is lazy per subscription, and a foreign-tree depth trip yields exactly one terminal error event.

Navigation accessors are **derived getters**, using a plain sync walk whose depth guard is a thrown defect, since getters have no error channel. Headings list in document order; **sections are delimited by root-level headings only**, with ranges spanning their subsections so the edit layer can splice whole sections; links pass URL strings through unmodified, with reference forms resolved through the definition index and an unresolvable foreign reference leaving the URL genuinely absent.

The generic tree queries sit alongside those fixed accessors without displacing them — the accessors encode document semantics, the queries are raw. **The tag overloads narrow the result type** through two exported helpers, so querying by tag returns the specific node type with no cast.

**The synthetic zero-width position sentinel is public**, and position carries it as a **make-only constructor default**. This is a narrowly-scoped carve-out to the required-position rule: decode still requires a real position on every node, so the mdast admission boundary is untouched, while `make` lets a replacement fragment construct in one line instead of hand-writing a span the modify path discards anyway. One consequence to know: `make` re-constructs a nested class value rather than passing it by reference — structurally equal, distinct instance — so **positions are asserted by value, never by identity**.

### Section finders

The finders are a layer over the existing sectioning, never a second sectioning implementation. The section type is a **value class rather than a `Schema.Class`** — it is a navigation projection, not a serializable domain model, so it adds no synthesized base symbol and no api-extractor suppression — carrying the heading's plain text, a body range and lazy source and body slices.

Three semantics are committed, each chosen against a specific failure:

1. **A string matches the trimmed heading text exactly, never as a substring.** A version string must not match a longer version that contains it — and in a changelog the longer one is often *newer*, so it sits earlier in the document and a substring implementation returns it first. That is a silent wrong-release publication, and it is the discriminating test for the whole surface.
2. **Depth is equality, not a maximum.** "The first H2 section" is the changelog idiom; a maximum would return the H1 title. A depth *range* is a different question and belongs in a predicate.
3. **The body is untrimmed**, exactly the bytes the body range describes, so the string and the offsets can never disagree. A lossless package that publishes a span's offsets and hands back a different span is lying about it; callers trim visibly.

A regular-expression match resets `lastIndex` first, so reusing one global pattern across sections cannot skip matches — reusing a pattern object is the natural call-site shape, so the reset belongs in the implementation rather than in a caveat.

Two classes of defect in the hand-rolled line scans this replaces are fixed **by construction**: a heading marker inside a fenced or indented code block cannot open a section, because it is a code node; and a setext heading is found, where a line-anchored regex never matched one at all. **Starting the body range at the heading node's end is what keeps setext correct**, since the node span covers the underline.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply in full:

- **`src/internal/limits.ts` is the zero-dependency leaf.** The cross-package depth constant guards every **recursive** surface, enumerated per engine: container nesting in the block pass, the delimiter and bracket stacks in the inline pass, stringify recursion and the visitor walk. Footnote definitions are containers sharing the container counter. **Iterative surfaces are deliberately unguarded** — the toml lesson: know what not to guard.
- **The cmark pathological suite is the linear-time guarantee.** Markdown's DoS vector is quadratic emphasis and link blowup, defeated by the delimiter-stack algorithm, and the vendored pathological cases with timeout assertions pin it. Several are deep-nesting cases the depth guard correctly **refuses**, and a dedicated set pins that posture rather than treating refusal as failure.
- **The suite's budgets are calibrated**, scaled against a same-code-path baseline measurement rather than raw milliseconds, because v8 coverage instrumentation costs an order of magnitude on tight engine loops. An algorithmic regression still fails, because quadratic outruns any constant factor. **Recalibrate after any performance fix** — a calibration input that rides a removed quadratic is measuring the defect.
- **The bare link-destination scan is capped at a fixed open-paren count.** The scan had no terminator on unclosed-link input, so every failed inline-link attempt re-scanned to end of subject. This is **inherited, not a port defect** — upstream commonmark.js carries the identical uncapped loop, which is also why the differential oracle never exercises the bound. The fix is cmark's own cap, sanctioned by the spec's clause permitting limits on parentheses nesting. Both boundary edges are unit-pinned, and linear scaling is pinned by a **ratio guard** — a growth-ratio assertion that cancels instrumentation and hardware, immune where a millisecond budget is not.
- **The reference map is keyed through a real `Map`** — link labels are attacker-controlled, so this is the prototype-pollution guard.
- **Malformed input yields a typed error or a diagnostic, never a defect**, and defect passthrough is proven at the facade.

### The construction-cost characteristic

Schema class construction dominates parse cost — stringify is orders of magnitude cheaper because it builds no Schema nodes, and the mdast projection outward is effectively free while the projection inward pays the full construction toll. That inward cost is **accepted**, because it is the checked admission boundary and checked admission is its purpose; hot-path consumers keep trees in package types or project outward.

**What is not accepted is paying construction per ancestor.** v4's `make` deep re-constructs every element of an array field typed as a class but passes an array field typed as a **union** through by identity. The category type aliases for table, row and list children — previously documentation-only aliases of their single member — are therefore **real one-member unions**, so those children take the pass-through path. An identity pin is the discriminating test. **Do not "simplify" those unions back to the member class.**

## Observability

Pure-tier rule: named `Effect.fn` spans on the public fallible boundaries only. No per-construct instrumentation inside the block or inline passes. No metrics; telemetry-agnostic.

## Testing

Unit tests in `__test__/`, conformance suites in `__test__/e2e/`. Five vendored corpora, each committed as fixtures with a pin file recording upstream repo, ref and license:

1. **The CommonMark spec corpus** — normalized-HTML equivalence via a **test-only HTML writer**, following the mdast-util-from-markdown precedent; no product HTML.
2. **The GFM spec extension sections.** Note that the two task-list spec examples are **disabled upstream** and excluded by cmark-gfm's own extraction tooling, so task-list conformance comes from the extensions corpus instead.
3. **cmark-gfm's extensions corpus** — the only official footnote corpus.
4. **The cmark pathological cases.**
5. **mdast-util-from-markdown fixtures** — markdown and JSON pairs with full positions, giving direct AST-plus-position equality through the projection, which proves interop rather than just rendering.

**Standing goal: an empty skip map** — the toml precedent, zero skips. The dialect matrix runs the whole CommonMark corpus under **both** dialects with an explicitly asserted bidirectional divergence list, so a divergence that appears or disappears fails the suite.

**The differential oracle is the `commonmark` npm package**, an exact-pinned devDependency imported only by a property test, following the smol-toml pattern. It is pinned to the CommonMark dialect, because the oracle package knows no GFM. It has surfaced a genuine upstream defect, handled by a narrow oracle-side correction plus a **tripwire test that fails when upstream fixes it** — the same technique used for the engine-lineage divergences masked symmetrically in the interop harness, and for the documented unrepresentable stringify cases.

Property tests: parse never throws, node positions span valid offsets, splice idempotence, stringify∘parse re-parse equivalence, and frontmatter round-trip through all three real codecs.

## Consumer seam

The `Mdast` projection is the remark-ecosystem interop boundary, and the frontmatter codecs are the gray-matter replacement. Nothing in this package knows about any consumer; like its format siblings it stays a pure, unaware format package, and any future codec-style integration points its dependency arrow **at** markdown, never from it.

The first in-kit consumer is [@effected/github-actions](github-actions.md), whose markdown builder synthesizes node trees and serializes canonically to get GitHub-safe escaping. Two things about that edge are worth recording. It uses the package exactly as designed — **synthesize nodes, serialize canonically, never join strings** — which is the usage the escaping guarantees were written for and the first outside proof they hold. And because this is one of the kit's largest packages, the consumer **confines it to one module and pins that with a bundle-reachability test**; a pure format package that a consumer must ration is a reasonable outcome, and it is the shape of adoption to expect rather than a defect to fix here.

## Parity notes

- The edit and range types are field-identical to the three siblings', and the diagnostic core carries the shared fields. This is the binding cross-package parity contract.
- **A `schema(target)` factory must carry its decode and encode service generics from day one.** Shipping without them silently loses a target schema's requirements through the composition, and threading them later is a signature change on the package's flagship surface.
- **Stringify trailing-newline asymmetry**: two siblings emit a trailing newline and the JSON one does not. This is a recorded rough edge in the parity surface, not a bug in any sibling — the frontmatter write seam normalizes around it at its one render site rather than forcing a sibling to break byte-compatibility.

## Deferred

- **The `obsidian` dialect**, which must land as registry entries alone.
- **A read-side one-call composition** folding parse, extract, resolve and validate together. The write half exists; this remains unbuilt.
- **hast output.** Porting the mdast-to-hast conversion was raised and deferred behind a decision gate: revisit after real consumer adoption shows whether keeping that one remaining dependency is a real cost. Either way **the `Mdast` projection is the bridge** — consumers render via the existing ecosystem converter over the projected plain tree. HTML string serialization stays permanently out of scope regardless.
- **A separate knowledge-format package.** The generic surface here — frontmatter schemas, heading and section navigation, link extraction, lossless round-trip — is designed to make such conventions trivially expressible, and the resolver seam already covers their dispatch model. A dedicated package waits for such a spec to stabilize.
- **Per-key surgical frontmatter editing** over the format packages' own edit layers.

## Build

Standard [package-setup.md](../package-setup.md) mechanics, with the narrow `ae-forgotten-export`/`_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories) and builds only via `pnpm build --filter`. The exact-pinned oracle is a devDependency — **never in `dependencies`, and never drifting from the ported version.**
