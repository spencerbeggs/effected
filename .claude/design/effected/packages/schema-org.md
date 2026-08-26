---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-08-26
last-synced: 2026-08-26
completeness: 92
related:
  - ../package-setup.md
  - ../consumers/tsdoctor.md
  - package-json.md
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../sync-primitive-policy.md
  - ../formatter-convention.md
  - ../migration-playbook.md
  - spdx.md
  - semver.md
  - schemastore.md
---

# @effected/schema-org design

## Overview

`@effected/schema-org` is the schema.org vocabulary as Effect Schema classes, a `JsonLdDocument` that assembles them into one JSON-LD document with `@id` cross-references, a single script-safe serializer, and an offline conformance validator over schema.org's own released vocabulary, vendored complete. All pure.

It follows [`@effected/spdx`](spdx.md) exactly: a validated vocabulary plus a small algebra over it, the dataset vendored as devDep-generated TypeScript, and the mapping onto any particular domain left to the consumer. spdx knows what `Apache-2.0 WITH LLVM-exception` means and nothing about `package.json`; this package knows what a `TechArticle` is and nothing about TypeScript.

The package exists because [tsdoctor](../consumers/README.md) is building a framework-neutral `@tsdoctor/seo` workspace that derives JSON-LD for a documented TypeScript package. The vocabulary half of that work is domain-neutral, so it belongs upstream. Under the split, tsdoctor holds exactly one thing: *API model + manifest → these nodes*.

The central invariant is not the vocabulary. It is [the serializer](#the-serializer-is-the-invariant): every string in a graph originates in author-written TSDoc, and a summary containing the literal `</script>` closes the JSON-LD block early and injects markup. `JSON.stringify` does not escape it. Everything else in this document is a vocabulary package; that one thing is a security boundary.

## Tier and dependencies

**Pure tier** under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy), and the argument is not just "no `FileSystem` import":

- **No IO, including for the vendored data.** The vocabulary subset is a TypeScript literal compiled into the bundle, not a JSON file read at load. The generator that produces it reads files, and the generator is a hand-run devDep script in `lib/scripts/`, never shipped and never on any code path in `src/` — the same posture as [spdx's regeneration tool](spdx.md#vendored-data-and-regeneration). If validation ever needed to *fetch* the vocabulary, this would be a boundary package; it deliberately does not.
- **No services, no layers, no `R`.** Inputs are values and strings, outputs are values, typed errors and one string. There is nothing for a consumer to provide.
- **No external runtime dependency**, so [R1](../effect-standards.md#dependency-policy) is satisfied without argument. `effect` is the only peer, `dependencies` is `{}` and `"sideEffects": false`.

Two `@effected/*` edges are available and **both are declined**:

- **`@effected/spdx` for `license`.** schema.org's `license` has range `CreativeWork | URL` — a *URL*, not an SPDX identifier. Typing it as an SPDX expression would reject legal input (`https://example.com/eula`) to serve a coincidence, and would mint a cross-package edge for it. The package documents the recipe instead, and the recipe is now a one-liner on the other side of the seam: `@effected/spdx`'s [`License.referenceUrl`](spdx.md#catalog-metadata) yields the canonical spdx.org page as an `Option<string>`, so a consumer holding an SPDX id maps it to a URL at its own call site without either package learning about the other. **That the recipe got easier is not an argument for the edge** — it is the opposite: the seam held, and the mapping stayed where it belongs.
- **`@effected/semver` for `version`.** schema.org's `version` has range `Number | Text`. Requiring SemVer would reject a legal `"2024-11"` or `"1.0-beta"`. Same decline, same reason.

Both declines are recorded here because they look obviously right from the kit's side and are obviously wrong from the vocabulary's: **the vocabulary's range is the contract, not our neighbour package's grammar.** With no `@effected/*` edges at all there is nothing to propagate, and a boundary consumer taking this edge stays boundary ([R3/R4](../effect-standards.md#dependency-policy)).

## Module layout and the two entrypoints

Module-per-concept per the [standard](../effect-standards.md#module-layout-module-per-concept); only entrypoints re-export.

- `src/NodeRef.ts` — `NodeId` (branded scalar), `NodeRef` (the `{"@id": …}` reference node), `InvalidNodeIdError`.
- `src/Thing.ts` — `ThingFields`, the shared field record every node spreads.
- `src/CreativeWork.ts`, `src/Person.ts`, `src/Organization.ts`, `src/SoftwareSourceCode.ts`, `src/TechArticle.ts`, `src/APIReference.ts` — one node class per module, plus that class's field record where it is shared downward. Three exist: `ThingFields`, `CreativeWorkFields` and `TechArticleFields` (spread by `APIReference`).
- `src/JsonLdDocument.ts` — the `JsonLdDocument` class, the `JsonLdNode` union, `DuplicateNodeIdError` / `ConflictingTermError`, and the serializer.
- `src/Vocabulary.ts` — the read API over the vendored dataset.
- `src/Conformance.ts` — `Conformance`, the `ConformanceIssue` union, `NonConformantGraphError`.
- `src/internal/vocabulary.ts` — the generated dataset literals.
- `src/index.ts` — the `.` entrypoint.
- `src/conformance-entry.ts` — the `./validate` entrypoint.

### Three names were changed to clear `effect`'s root exports

`Graph` → **`JsonLdDocument`**, `GraphNode` → **`JsonLdNode`**, `Ref` → **`NodeRef`**. The rule this establishes is worth applying to any kit package: **a public name must not collide with a name `effect` exports from its root**, because every consumer file in this ecosystem already imports from `effect`, so the collision is not a rare unlucky import — it is the default one.

`Ref` was the sharp case. `effect`'s `Ref` is among the most-used core constructs and means a **mutable reference cell**, which is nothing like a reference to a node by `@id`; a reader seeing `Ref` in a file that also imports from `effect` would reasonably assume the wrong one, and a call site wanting both would have to alias. **The collision is not hypothetical**: this package's own vocabulary generator imports `effect`'s `Graph` for an acyclicity assertion (see [Generation](#generation)), so the two names genuinely met inside this package.

`JsonLdDocument` is also the better name on its own merits, independently of the clash. The class's own documentation already described it as "a JSON-LD document: `@context` plus a flat `@graph` of nodes" — so `Graph` named **the key rather than the thing**, and the rename made the type agree with the prose that was already there. A collision is a good prompt to re-ask whether the name was right; here it was not.

**A subpath export key must not differ from a concept module's name only in case, and the entry file must not either.** Found while building; it is a repo-wide scaffold rule and now lives as one in [package-setup.md](../package-setup.md#the-case-collision-rule), reproduced here because this is where it bit. The collision bites at two layers on a case-insensitive filesystem, and the second one is the expensive one:

1. **Source layer.** `src/conformance.ts` beside `src/Conformance.ts` is a `tsc` error outright (TS1149, "differs from already included file name only in casing"). Hence `conformance-entry.ts`.
2. **Declaration layer.** Renaming the *source* file does not help, because the emitted declaration name derives from the **export key**. `"./conformance"` emits `conformance.d.ts`, which collides with the module's `Conformance.d.ts`; the bundler sidesteps it by writing `conformance2.d.ts`, and API Extractor — still pointed at `conformance.d.ts` — resolves case-insensitively onto the **module** instead of the entry. The symptom is a CI-fatal `ae-forgotten-export` for `JsonLdDocument`, a symbol the entry visibly exports, which sends a reader hunting a missing export that is not missing.

The subpath is therefore **`./validate`**, which also describes the entry better: it ships the vocabulary reader *and* the validator, not conformance alone. The alternative fix — renaming the module — was rejected because `Conformance` is the exported class and [file names are API names](../effect-standards.md#module-layout-module-per-concept).

**Two published entrypoints, and the split is the answer to "does a consumer that only builds graphs pay for the validator".** `.` exports the node classes, `NodeRef` and `JsonLdDocument`. `./validate` exports `Vocabulary` and `Conformance`, and is the *only* path that reaches `src/internal/vocabulary.ts`.

**As built, `./validate` re-exports the graph types as `export type` — with exactly one value exception, `JsonLdDocument`.** Type-only re-exports are erased at runtime, so they cost the split nothing while letting the validator's declarations name their own parameter types. `JsonLdDocument` cannot be one of them: it is the parameter type of every validator entry point, and API Extractor needs the **class** declared by this entrypoint, not merely its type. It costs a conformance consumer nothing they were not already holding, and — the direction that matters — it does not drag the vocabulary table back across the boundary, which is the cost the split exists to avoid. The general form of this rule is in [package-setup.md](../package-setup.md#the-wiring): prefer `export type`, take the value re-export only where API Extractor forces it, and say at the site which it is.

**The accepted cost, reported by the first consumer:** a call site that imports *everything* from `./validate` gets `"only refers to a type"` on `NodeRef.to`, because the node classes reach that entrypoint type-only. The error is correct and the split is working — construction belongs to `.`, validation to `./validate` — but the message does **not** point at the subpath, so a reader sees a type/value error and not "you imported from the wrong entrypoint". This is the price of the split rather than a defect in it, and the place to pay it down is the README's import example, which should show both entrypoints side by side. A bundler can see through a re-export barrel, so a single entrypoint would tree-shake correctly for bundled consumers — but an unbundled Node consumer importing `TechArticle` from `.` would load `index.ts`, which loads `Conformance.ts`, which loads **74,834 B** of vocabulary literals it will never read. The subpath makes the cost legible and makes it zero for the common case, and a structural test asserts the boundary with a positive control, since review cannot enforce it. Precedent for a second entrypoint: `@effected/workspaces`' `./node-sync`.

Validation is also the *build-time* half of a consumer's work — a CI gate — while graph assembly runs in the page render path. Splitting them along the entrypoint boundary matches how they are actually used.

## Modeling the vocabulary

This is the hard part of the design. schema.org is rampantly optional and rampantly polymorphic: nearly every property is omissible, and any property may hold a literal, an embedded node, a `{"@id"}` reference, or an array mixing all three. Modeling that faithfully produces `Schema.Union([A, NodeRef, Schema.Array(Schema.Union([A, NodeRef]))])` per property — types that typecheck everything and tell the author nothing. Four rules narrow it, each a deliberate restriction of what schema.org permits to what a `@graph` document actually needs.

### Every node is a `Schema.Class`; no schema inheritance

Each node is a flat `Schema.Class` declaring its full field set inline, per the [API Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). `TechArticle` does **not** extend `Article` extends `CreativeWork`.

Reproducing schema.org's `rdfs:subClassOf` chain as TypeScript inheritance would create a second source of truth for the fact that already lives in the vendored dataset — the one the validator reads — and the two would drift the first time schema.org moves a property up a level. Shared fields are handled by **spreading a `@public` field record** (`...ThingFields`, `...CreativeWorkFields`) rather than by inheritance: one source of the field definitions, no heritage chain, and each class's emitted `.d.ts` lists its own fields. The field records are genuine reusable public API on the same footing as `@effected/package-json`'s `DependencyMapField`, so they carry `@public` on their own merit rather than being suppressed.

**`make` is the right constructor for a node.** spdx had to name its validating constructors `parse`/`parseResult` because [`Schema.Class` owns `make`](spdx.md#public-api) and it needed a name for a *string parser*; a node has no string form to parse, so `make` is not competing with anything and `SoftwareSourceCode.make({ … })` — the shape the consumer sketched — stays. `JsonLdDocument` is the one place in this package where the collision does bite, and it is [resolved there](#jsonlddocument).

### Optionality: `Schema.optional`, not `Schema.optionalKey` — a scoped exception

This **diverges from the kit's schema standard**, which says `optionalKey` for omissible fields. It is **allowed here as a scoped exception and is explicitly NOT a kit-wide precedent**: it is licensed by this package's construction pattern, not by a general preference, and a package whose fields do not originate in possibly-absent upstream metadata has no claim on it. `Schema.optional` is `optionalKey<UndefinedOr<S>>` (verified in `.repos/effect` `packages/effect/src/schema/Schema.ts:2460`): the key may be absent **and** may be present as `undefined`.

Under `optionalKey`, passing an explicit `undefined` throws — so every consumer call site becomes a wall of conditional spreads, because every field arrives from a possibly-absent TSDoc tag:

```ts
TechArticle.make({ headline, ...(description !== undefined ? { description } : {}) , … })
```

That is a hazard the kit already documents and it would fire on essentially every field of every node — **every field of every node originates in a possibly-absent TSDoc tag**, which is the specific fact that licenses the exception. Under `optional`, `description: undefined` is legal and the key is dropped at serialize time, which the serializer has to do regardless: **JSON-LD has no `undefined` and no meaningful `null`,** so "omit the key" is the only correct wire behaviour for an absent value and it belongs in the one place that produces the wire form. The strictness `optionalKey` buys is strictness about a distinction — absent vs present-and-undefined — that does not survive serialization.

`@id` and `@type` are the only non-optional members of any node.

### Arity: one shape per property, always the wire shape, and the many case is never silently collapsed

A property that schema.org permits to repeat is modeled as `ReadonlyArray<T>` and **always emitted as an array**, even at length one. A property we model as single-valued is a scalar and always emitted as a scalar. There is no `T | ReadonlyArray<T>` anywhere in the surface, and no "collapse a one-element array" serializer option.

This is legal rather than merely convenient: in the JSON-LD data model a value and a one-element array of that value are the same thing, so every conforming processor — including Google's — reads `"author": [{"@id": …}]` and `"author": {"@id": …}` identically. We give up nothing expressible and gain a model with exactly one representation per property, which is what makes round-trip assertions and property tests meaningful.

#### The house precedent: never pick a representative

The governing rule comes from [`@effected/spdx`](spdx.md), where the same question was settled first and the answer is now adopted downstream:

```ts
SpdxExpression.primaryLicense(expr): Option<License>   // none for a conjunction
SpdxExpression.licensesOf(expr): ReadonlyArray<License>
```

`primaryLicense` returns `none` for `MIT AND Apache-2.0` rather than picking one, because collapsing a conjunction to a single value is **silent data loss that produces confidently-wrong output looking perfectly fine**. The `none` is a routing signal, not an error path: the call site carries both, and emits the array when there is no single primary.

Three rules for this package follow, and they are why the arity decision above is stated as a commitment rather than a convenience:

1. **Where a property is genuinely one-or-many, the many case is unmissable.** Modeling it as `ReadonlyArray<T>` is the strongest available form of that — there is no singular accessor to reach for and therefore nothing to silently pick.
2. **If a singular accessor is ever added, it declines rather than chooses.** `Option.none` whenever choosing would drop information, exactly as `primaryLicense` does. Round 1 adds none.
3. **A collapse to a scalar needs a justification per property**, recorded below and on the member. A collapse that could lose information is not permitted without a paired accessor that does not.

The DX cost is real and accepted: `isPartOf: [NodeRef.to(pkgId)]` is noisier than `isPartOf: NodeRef.to(pkgId)`. In the consumer's own words about the spdx pair, declining to choose "forces the call site to confront it, which is precisely what a boundary should do".

#### The round-1 arity table

Every collapse carries its reason, **and a column saying whose collapse it is** — a distinction worth making structural, because it tells a future reader which entries are even ours to revisit. A vocabulary collapse is not up for debate here; ours is.

| Property | Arity | Collapsed by | Why |
| --- | --- | --- | --- |
| `license` | **many** | — | The exemplar. `MIT AND Apache-2.0` is a real dual-license and this is the direct downstream consumer of spdx's `licensesOf` — the one property where collapsing is provably wrong. |
| `author`, `publisher`, `sameAs`, `keywords`, `about`, `articleSection`, `identifier`, `runtimePlatform`, `targetProduct`, `programmingLanguage`, `isPartOf` | many | — | All genuinely repeatable. `isPartOf` in particular: "part of" is a many relation, and a scalar there is precisely the silent collapse rule 3 forbids. |
| `mainEntity` | one | **the vocabulary** | schema.org's own definition is *the primary* entity described. **Not our collapse to revisit** — the vocabulary made it, and a future reader should leave it alone unless schema.org moves. |
| `name`, `headline`, `description`, `url` | one | us | Singular by nature. A node with two names has an authoring bug, not a modeling need. |
| `version`, `assemblyVersion`, `programmingModel`, `codeRepository` | one | us | One artifact has one of each. |
| `datePublished`, `dateModified`, `inLanguage` | one | us | Singular by nature. |

**`publisher` is many**, and the reasoning is the general rule for every uncertain case on this table: **the error costs are asymmetric.** Being wrong toward many costs one pair of brackets at a call site. Being wrong toward one costs a breaking change. An earlier draft had it as *one* on the grounds that co-publication is rare — which was a judgement about frequency where the decision actually turns on the cost of being wrong. When arity is genuinely uncertain, choose many.

The rows marked *us* are the ones a later round may revisit. The row marked *the vocabulary* is not ours to move.

Widening a scalar to an array is a breaking change; the TSDoc says so on the member.

### References, not embedding: a node-valued property holds a `NodeRef`

A property whose value is another node is typed as `NodeRef` — never as the node class, never as a union of the two.

The `@graph` form exists precisely so that nodes are siblings addressed by `@id`; embedding is the *alternative* serialization of the same information. Supporting both would double the value space of every node-valued property for zero capability, and would make a graph's node set ambiguous (is an embedded `Person` a graph member?). One shape: nodes are siblings, edges are `NodeRef`s. `NodeRef.to(node)` builds one from a node you are already holding, so the common case is not stringly-typed.

The residual cost is real and accepted: a consumer who wants a genuinely nested document — a one-off `Offer` nobody else references — has to give it an `@id` and put it in the graph. That is a better document anyway.

**This is the same rule as the arity one, on the other axis.** The [never-pick-a-representative precedent](#the-house-precedent-never-pick-a-representative) forbids silently flattening value-vs-reference just as it forbids silently collapsing many-to-one. The package does not flatten: it declines the inline form at the type level, so a consumer holding a node they wanted to embed is *forced to confront* the choice — give it an `@id` and add it — rather than having one representation quietly rewritten into the other. Refusing at the boundary is the loud version of the same principle; a `Union([Node, NodeRef])` that normalized to `NodeRef` on the way out would be the silent one.

### The catch-all, and why the validator exists

Six classes cannot cover schema.org, and a consumer will legitimately want `about`, `articleSection` or `keywords` on a node we have not modeled a field for. Each node therefore carries an open `additional: Record<string, JsonValue>` whose entries are **flattened into the node's JSON object** at serialize time.

This is the design's spine, and it is what makes offline conformance validation worth shipping rather than tautological:

- **Typed fields are correct by construction.** Their domain-legality is a property of the class definition, proven once by a test (below), not per graph. A validator that only ever saw typed fields would report nothing, forever.
- **The catch-all is unchecked by the compiler and checked by the validator.** It is the one place a plausible-looking property that schema.org does not define on that type can enter a graph — which is exactly the failure mode the consumer's CI gate needs to catch.

A key in `additional` that collides with a typed field, with `@id` or with `@type` is unambiguous caller error and fails at graph construction (`ConflictingTermError`), not at validation.

## Node identity and cross-references

**`@id` is required on every node.** A node without one cannot be referenced, cannot be deduplicated, and is indistinguishable from a second copy of itself. Requiring it costs the consumer one field and makes `JsonLdDocument` a real index rather than a list.

**Ids are caller-supplied. The package never derives one.** It cannot: an `@id` is an IRI in the consumer's namespace (`https://docs.example.com/pkg/v2#package`), and the package has no idea what the consumer's base URL is. A derived opaque id — a content hash — would be stable per build, unlinkable from outside, and would silently change when an unrelated field changed. There is no synthesis helper and adding one later would be a mistake worth resisting.

`NodeId` is a branded string with a **deliberately loose** check: non-empty, no whitespace, no control characters. It accepts absolute IRIs, blank-node ids (`_:pkg`) and relative/fragment forms, because all three are legal JSON-LD and a stricter IRI grammar would reject legal input to catch a typo. Over-strict validation on an identifier is the [formatter convention's C1](../formatter-convention.md#the-driving-constraint) failure in a different costume.

**"No control characters" means `\p{Cc}`, not a hand-written range, and the difference was a real hole.** The rule was originally a negated character class listing the C0 range and `DEL` explicitly — which silently admitted the entire **C1** block, so `U+0085` (NEL) and `U+0090` passed as legal ids. Since a `NodeId` is interpolated into a serialized document, that is a loose end on the package's [one security-relevant surface](#the-serializer-is-the-invariant), not merely an untidy predicate. The pattern is now the Unicode property escape, which covers the whole control category by definition rather than by enumeration.

The transferable rule: **for a Unicode category, name the category.** A hand-written range encodes its author's recollection of where the category's boundaries are, and it goes stale silently because the characters it wrongly admits are exactly the ones nobody types by hand into a test.

**A dangling reference is not an error.** `publisher: NodeRef.to("https://example.com/#org")` pointing outside the graph is legal, common and often correct — the referenced organization is described on another page. Refusing it would make the package wrong. So:

- `JsonLdDocument.buildResult` **fails** on a duplicate `@id` (two nodes claiming one identity is caller error; JSON-LD would silently merge them) and on a colliding `additional` key.
- It **never fails** on a dangling reference. `graph.danglingReferences` exposes them as a queryable array, and `Conformance` reports each as a `DanglingReference` issue, so a consumer whose graph is supposed to be closed can gate on it — and one whose graph is deliberately open ignores it.

That split — hard failure for identity errors, reported issue for openness — is the answer to "this is where a vocabulary package usually goes wrong". The package refuses to decide whether a consumer's graph is closed.

## `JsonLdDocument`

`JsonLdDocument` is a **`Schema.Class`**, carrying `@context` and the node list. The kit's habit is that named domain models are schema classes, and this is the shape to be in if JSON-LD → typed nodes ever ships; being a plain class would have to be re-litigated the day it does.

### The decode direction is declared unimplemented, and that is a statement, not an omission

Being a `Schema.Class` means `Schema.decodeUnknown(JsonLdDocument)` *exists as a symbol*, and the awkwardness is real rather than hypothetical: **the flattened `additional` catch-all is not symmetric under decode.** Encode spreads a node's catch-all entries into the JSON object; a faithful decode would have to re-gather every key it does not recognize as a typed field back into `additional`, which is a real transformation with real decisions (what about `@id`? a key colliding with a typed field name it must not populate?).

Round 1 does not implement it, so the doc says exactly what happens rather than letting a reader assume a round trip:

- **The encode direction is the supported one** and is what `toScriptBody` and `toJsonLd` are built on.
- **The decode direction is declared unimplemented on the class's TSDoc**, in those words. Nobody should infer `decode(encode(g)) ≡ g` from the class being a `Schema.Class`; the catch-all makes that false today.
- **A test pins the asymmetry** rather than leaving it to prose — encode a graph with a populated catch-all, and assert that the decode direction does not silently produce a lossy value. A round trip that half-works is worse than one that is absent, and this is the assertion that stops it half-working by accident.

When the decode direction does land, it lands with the catch-all re-gathering rule as its central design question, and this section is where that work starts.

The nodes themselves are `Schema.Class`es and keep everything that buys: validated construction, `toArbitrary` for property tests, annotations.

```ts
const graph = JsonLdDocument.buildResult([
  SoftwareSourceCode.make({
    "@id": pkgId, name, version, codeRepository,
    license: licenseIds.map((id) => `https://spdx.org/licenses/${id}`), // many: the spdx `licensesOf` case
    programmingLanguage: ["TypeScript"],
    author: [NodeRef.to(authorId)],
  }),
  TechArticle.make({
    "@id": docId, headline, description, datePublished, dateModified,
    isPartOf: [NodeRef.to(pkgId)],       // many
    mainEntity: NodeRef.to(apiId),       // one, by schema.org's definition
    inLanguage: "en",
  }),
  APIReference.make({ "@id": apiId, name, assemblyVersion, programmingModel }),
]);
```

Now that `JsonLdDocument` is a `Schema.Class`, **`make` is reserved on it** — exactly the constraint [spdx hit](spdx.md#public-api) — so the validating constructor takes its own name. `buildResult` reads correctly for an assembly step and does not collide, and per the [sync-primitive policy](../sync-primitive-policy.md) it is the primitive returning `Result<JsonLdDocument, DuplicateNodeIdError | ConflictingTermError>`, with `JsonLdDocument.build` as `Effect.fromResult` behind an `Effect.fn("JsonLdDocument.build")` span. `JsonLdDocument.make` remains what `Schema.Class` gives it — a raw structural constructor that runs none of the identity checks — and is not the documented entry point. Nothing here is async or does IO, so the `Effect` form carries only the span and the sync form is the one a static-site build actually calls.

There is deliberately **no `SchemaOrg` facade object.** The consumer's sketch spelled it `SchemaOrg.graph([...])` / `SchemaOrg.serialize(graph)`; collecting the package's surface behind one binding is the [namespace-object ban](../effect-standards.md#no-barrel-re-exports) — and here it would be load-bearing, because that single binding would make the vocabulary dataset reachable from every importer and undo the entrypoint split. `JsonLdDocument.buildResult` and `graph.toScriptBody()` say the same thing without the binding.

The `@context` is fixed at `"https://schema.org"`, matching the `-https` vocabulary document we vendor. One canonical spelling; the `http://` form is equivalent and we never emit it.

## The serializer is the invariant

**The package exposes exactly one serializer, and it is the escaped one.** `graph.toScriptBody(): string` returns the JSON-LD body, script-embeddable, and there is no unescaped twin.

The mechanism: after `JSON.stringify`, replace every `<`, `>` and `&` with `<`, `>` and `&`. Four properties make this the correct fix rather than a defensive hack:

1. **It is exhaustive.** In a JSON document, `<`, `>` and `&` can only occur inside string literals — no other JSON token contains them — so a blanket post-stringify replacement cannot corrupt structure. That is a provable property, not a heuristic, and it is why the escape does not need a JSON-aware walker.
2. **It is lossless.** `\uXXXX` is a valid JSON string escape; every conforming parser produces the original character. `JSON.parse(toScriptBody(g))` deep-equals the unescaped encoding, byte for byte at the value level.
3. **It makes the element unclosable from inside.** With no `<` in the body, neither `</script` nor `<!--` can appear, which is the entire HTML raw-text-element hazard.
4. **`&` is included** — a widening of one character over the minimum. With `<` escaped nothing can inject markup in HTML, but a document served as XHTML (`application/xhtml+xml`) parses script content as ordinary element content, where a raw `&` is an entity start and a bare `&` is a well-formedness error. Three characters, one pass, correct in both serializations. `U+2028`/`U+2029` are deliberately **not** escaped: they only matter inside JavaScript source, and this is never JavaScript source.

**Why there is no unsafe twin.** The escaped output is not a restricted form or a tradeoff — it is semantically identical to the unescaped output for every consumer that parses it, and every consumer parses it. No caller *needs* the raw bytes. An unsafe serializer beside a safe one would therefore exist only to be chosen wrongly, and it would be chosen wrongly by the caller with the shortest deadline. The only cost is that `<` in view-source is uglier than `<`, which is not a cost anyone is paying.

**The escape hatch we cannot close, and therefore document.** Every node is its own schema and so is `JsonLdDocument`, so `Schema.encode(JsonLdDocument)` is public whether we like it or not — the decision to make `JsonLdDocument` a `Schema.Class` settles this question rather than raising it, because there is now no version of the design in which the encoded value is hidden. `graph.toJsonLd()` — the plain encoded value, for a framework that takes an object rather than a string (Next's `<Script>`, a React `dangerouslySetInnerHTML` wrapper that serializes itself) — is a legitimate need. It ships, named for what it is, with the loudest TSDoc in the package: **if you are producing text, use `toScriptBody`; never `JSON.stringify` this value into a page.** Pretending the value form does not exist would not remove it, it would only remove our chance to warn about it.

`toScriptBody` returns the **body only**, not a `<script>` element. Returning an element would make this an HTML generator and drag in attribute-escaping decisions; the README documents the recommended wrapper (`<script type="application/ld+json">`). A `toScriptElement` helper is [deferred](#out-of-scope-for-round-1), not rejected.

## Conformance validation

The gate answers one question offline: *does schema.org define this `@type`, and is every property on it `domainIncludes`-legal for that type?* That is the failure the consumer actually hits — not malformed JSON, but a plausible property schema.org does not define on that type. The authentic example, taken from the vocabulary: **`softwareVersion` is defined on `SoftwareApplication`, not on `SoftwareSourceCode`** (which spells it `version`). It reads correct, it serializes fine, and it is silently ignored downstream.

### How legality is resolved: five traps, all confirmed against the vendored data

A naive `domainIncludes.includes(type)` check is wrong in five separate ways, and the first one rejects the consumer's very first graph. Each is stated with the number that proves it, re-measured directly against the v30.0 vocabulary document.

**The counts here are over schema-native terms only: 933 classes and 1,521 properties.** The document's `@graph` also carries 77 foreign classes and 155 foreign properties (`fibo-`, `gs1:`, `unece:`, `snomed:`, `foaf:`, `sarif:`, `cmns-`), present only as equivalence targets. They carry `@type: "rdfs:Class"` and `@type: "rdf:Property"` just like native terms, **so they must be filtered by `@id` prefix, never by `@type`** — filtering by type is how a table ends up with 1,010 classes and 1,676 properties, most of the extras being terms schema.org does not define.

**1. Legality is inherited, so the check is set membership over the full ancestor closure.** `schema:license` carries exactly **one** `domainIncludes` entry — `CreativeWork` — so `license` on a `SoftwareSourceCode` is *not* directly legal. It is legal only through `SoftwareSourceCode → CreativeWork → Thing`. The validator resolves the whole `rdfs:subClassOf` chain and asks whether *any* `domainIncludes` entry is *anywhere* in it.

**This false-rejection path is as dangerous as the false-acceptance path the feature exists to catch.** A gate that fails a correct graph gets switched off, and a switched-off gate protects nothing — so the inherited case is not a nicety, it is the difference between a shipped feature and a deleted one. `license` on `SoftwareSourceCode` is a property the consumer's call site passes on its first run.

**2. A property may name many domains, so it is membership, not equality.** `domainIncludes` fan-out reaches **12** with a mean of **1.52**. The check is set intersection between the property's domain set and the node type's ancestor closure — non-empty means legal.

**3. The hierarchy is a DAG, not a tree, so the ancestor walk is a cycle-guarded set union.** **57 classes have multiple parents** — `Hospital` is simultaneously a `CivicStructure`, an `EmergencyService` and a `MedicalOrganization`. A parent-chain walk silently truncates the closure and produces false rejections indistinguishable from trap 1. There are no cycles in v30.0 (checked), but the visited set is required by the multi-parent shape regardless and defends against a future one for free.

**4. Foreign parents appear on real classes, and the walk must tolerate-and-skip them.** **10 native classes have a parent outside the schema namespace**, and in most of them the foreign parent sits *beside* a native one that carries the real chain: `Certification → fibo-fnd-arr-doc:Certificate + CreativeWork`, `ProductGroup → Product + cmns-col:Collection + cmns-cls:Classifier`. A walk that throws on an unresolvable parent crashes; one that abandons the class drops a legitimate chain and false-rejects. It must skip that branch and keep the others. `DataType → rdfs:Class` is the same shape with an `rdfs:` parent and no native sibling — the walk terminates there with `DataType` itself still in the closure.

**5. The vocabulary contains foreign terms, which must not be ingested as schema.org terms.** The 155 foreign properties are `gs1:`, `unece:`, `eli:`, `dct:` and `fibo-` alignment terms. A generator that ingests by `@type` puts `gs1:telephone` in the table as a term legal nowhere. Filtering is by `@id` prefix ([above](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data)), and the validator **skips any prefixed term** in a node's catch-all rather than reporting it — a consumer who writes `gs1:telephone` has deliberately opted into a foreign vocabulary this package does not claim to validate, and reporting it would be a false rejection of the same family as trap 1.

Exactly **one native property has no `domainIncludes` at all** (`interactionCount`, superseded). It is legal nowhere and the table represents it faithfully as such; it is called out here only because "a property with an empty domain set" looks like a generator bug and is not one.

Two surfaces, following the [sync-primitive policy](../sync-primitive-policy.md) and the [formatter convention's return-type rule](../formatter-convention.md#decision-3--return-type-convention):

- **`Conformance.check(graph): ReadonlyArray<ConformanceIssue>` — total, never fails.** Reporting is not a failure mode; a caller that wants every problem at once wants a list, and a total function is what a lint host can call.
- **`Conformance.validateResult(graph, options?): Result<JsonLdDocument, NonConformantGraphError>`** — the gate, where the error carries the full issue array. `Conformance.validate` is its `Effect.fromResult` twin behind a span. `validateResult` is defined in terms of `check`, so the two cannot drift.

`ConformanceIssue` is a tagged union of `Schema.TaggedClass` variants, each carrying the offending node's `@id`, its `@type` and the property name:

- `UnknownTerm` — the `@type` or property term **is not in schema.org v30 at all**. Carries which kind it was.
- `PropertyNotOnType` — the term exists, but no `domainIncludes` entry intersects the node type's ancestor closure. This is the one that pays for the package.
- `DeprecatedType` / `DeprecatedProperty` — carries the `supersededBy` term. **Deprecated terms are valid-but-flagged, never rejected**, exactly as [spdx treats deprecated ids](spdx.md#public-api).
- `DanglingReference` — a `NodeRef` to an `@id` outside the graph.

#### The outcome is three-valued, and the three are never conflated

`legal` / `PropertyNotOnType` / `UnknownTerm` are three distinct answers, and the last two must never collapse into one another:

- **`UnknownTerm` is always reported and never silently passed.** A term schema.org does not define is a typo or an invention; passing it because we are unsure is how a gate becomes decorative.
- **`PropertyNotOnType` is the domain violation** — a real term in the wrong place. Different cause, different fix, different message.
- **Strict mode promotes `UnknownTerm` to a failure** for a closed-world caller (`{ unknownTerms: "report" | "fail" }`), because a consumer who controls every term in their graph wants an invented one to break the build.

**This distinction is only meaningful because [the table is complete](#what-ships-the-full-interned-table).** Under a scoped subset, "unknown" is irreducibly ambiguous between *you misspelled it* and *we did not ship that part of the vocabulary* — the validator cannot tell, so it cannot report either honestly, and a strict mode over it would fail correct graphs. Shipping every term is what buys the package out of that lie, and it is the strongest argument for the full table after the range-closure one.

Issues carry **no severity field**. Severity is the consumer's policy, not a fact about the graph, and an enum here would immediately need overriding. `validateResult` instead fails on the structural kinds by default and takes `{ deprecations: "ignore" | "report", danglingReferences: "ignore" | "report" }` to widen the gate. Those two defaults are the ones worth arguing about and they are documented on the member.

**The per-kind gate is exhaustiveness-checked with `issue satisfies never`, and that is load-bearing rather than stylistic.** Because the gate decides *per issue kind* whether an issue fails the build, a plain `default: return false` would silently pass a **sixth** issue kind added later — the new kind would be reported by `check` and ignored by every gate, which is the most expensive possible failure here: the validator appears to work, the CI gate stays green, and nothing indicates that a whole class of finding is being dropped. With the `satisfies never`, adding an issue kind without deciding its gate behaviour is a **compile error at the gate**, so the decision cannot be skipped by omission.

The generalization: **when a union is switched on to decide a policy, exhaustiveness is a correctness requirement, not tidiness.** A default branch is only safe where the default is a genuine answer for values that do not exist yet, and "does this fail the build" never is.

`Vocabulary` is the same data as a read API — `Vocabulary.hasType`, `.isPropertyOn`, `.propertiesOf`, `.ancestorsOf`, `.supersededBy`, `.version` — exported because a consumer building a *different* algebra over schema.org should not have to re-vendor the dataset, and because the package's own tests read it. It is a static class per [the container rule](../effect-standards.md#a-sanctioned-grouped-statics-container-is-a-static-class-not-an-as-const-object), and its name is not otherwise taken by a type.

**What conformance is not.** schema.org conformance is not Google rich-results eligibility. Google requires properties schema.org does not (`headline` on an `Article`), forbids nothing schema.org allows, and changes its policy on its own schedule. A Google-policy checker is a different artifact with a different update cadence and it does not belong in a pure vocabulary package. The README says this in as many words, because the consumer's CI gate will otherwise be read as a Google gate.

## Vendored data and regeneration

### The source is vendored and pinned

`lib/data/schemaorg-current-https.jsonld` — schema.org's published release document at **v30.0**, 1.5 MB, committed into this package. The generator reads it and writes only into `packages/schema-org/src/internal/`.

It was briefly a sparse submodule of `schemaorg/schemaorg` and should not be again. That repo is **254 MB** and this is the single file read from it; sparse configuration lives in a submodule's own `.git/config` and does not travel, so every clone and every CI checkout paid the full history. Together with `@effected/spdx`'s 1.86 GB submodule it roughly tripled CI checkout time. **Submodule a repo when a package needs to read the repo; commit the file when it needs one file.**

The generator reads **the vendored file, never the network**: the gate is offline, pinned and reproducible, and a regeneration on any machine at any time produces the same literals. That is the whole reason the source is a submodule rather than a fetch.

**Vendoring creates a re-pin obligation**, per the silk `repos` skill: bumping the vocabulary version means re-pinning the submodule tag *and* re-running the generator *and* diffing, as one change. `Vocabulary.version` carries the release at runtime so a consumer's CI can report which vocabulary its gate ran against — the same discipline the [playbook requires of a committed oracle](../migration-playbook.md#fixtures-carry-a-provenance-readme), which cannot attribute a later disagreement without the version recorded.

Following spdx's precedent, an upstream bump is **a vocabulary review, not a version bump**: a term that moved domain, or a class that gained a parent, changes what the gate accepts. Diff the regenerated literals and let the corpus record the answers.

### What ships: the full interned table

The document holds 3,219 `@graph` nodes. After [filtering foreign terms by id prefix](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data), the schema-native vocabulary is **933 classes and 1,521 properties** — and **all of it ships**, interned, with no scoping by closure and no section cut.

| Candidate subset | Types | Size | Verdict |
| --- | --- | --- | --- |
| Upstream document, whole | — | 1,550,917 B | No — 25× the useful data |
| Six modeled types + ancestors | 8 | ~5 KB | No — decisively |
| Chasing the range closure: one hop | 80 | ~17 KB | No |
| …two hops | 165 | ~26 KB | No |
| …three hops | 208 | ~30 KB | No |
| **Everything, interned** | **933 classes / 1,521 properties** | **74,834 B raw / 23,833 B gzip** | **Ships — 5% of the source** |

**The argument that settles it is the range closure.** The six exposed types' properties name **69 distinct non-datatype range types, and 64 of them fall outside any closure scoped to those six**. These are not exotic:

- `Organization.address` → `PostalAddress`
- `CreativeWork.image` → `ImageObject`
- `SoftwareSourceCode.programmingLanguage` → `ComputerLanguage`

Correct graphs reach those types on day one. So a scoped table does not merely lag the vocabulary, it **fails the first realistic graph** — the same false-rejection failure as [trap 1](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data), arriving by a different road.

And chasing the closure honestly does not pay: following ranges outward gives 8 → 80 → 165 → 208 types and ~30 KB, **roughly 43% of the cost of simply shipping everything**, for a table that is still incomplete, whose boundary moves every time a field is added, and that must be regenerated on a rule nobody can state in one sentence. Half the size, all of the ambiguity.

That ambiguity is the second cost and the worse one: a scoped table **cannot distinguish "you misspelled it" from "we did not ship that part"**, which is precisely the distinction [the three-valued outcome](#the-outcome-is-three-valued-and-the-three-are-never-conflated) depends on. Completeness is not a size decision here, it is what makes `UnknownTerm` an honest answer.

`pending` and the hosted extensions are therefore **included** — an earlier draft cut them, which bought ~40 KB in exchange for a documented false positive on every `pending` term. With the full table there is no cut to defend and no false positive to pin.

Interning is what makes "everything" affordable: type names are stored once in a string table and referenced by index from the parent and domain lists, since every one of the ~2,300 domain entries would otherwise repeat a name already present. **The shipped table measures 74,834 B raw / 23,833 B gzip** — larger than the 62,811 B this section estimated before the generator existed, because the built table also carries the property-name string table, both `supersededBy` maps and the generated `FOREIGN_PREFIXES` literal. Pre-implementation estimates of this table ranged 57.7–62.8 KB across interning schemes, which is why the doc committed to pinning the real number by a test rather than asserting one: `__test__/Vocabulary.test.ts` asserts a **ceiling of 80,000 B and a floor of 60,000 B**. The floor is the load-bearing half — a half-run generation produces a truncated table that passes every legality test by simply knowing nothing.

**The entrypoint split is now more important, not less** — the number a graph-only consumer avoids is the whole **74,834 B**, and it is the raw figure that matters to them, since it is what tracks parse cost and pre-compression footprint. Gzip is never quoted alone here for that reason. That is the answer to "should validation data be separately importable": the size is the reason it must be.

Three derived literals in `src/internal/vocabulary.ts`: the interned `types` string table, `parents` (index → parent indices, a DAG per [trap 3](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data)) and `domains` (property → the type indices its `domainIncludes` names), plus the `version` constant. They answer both questions the validator asks and nothing else: no `rangeIncludes`, no labels, comments or examples. Note that `rangeIncludes` is used to *justify* the full table above but is not *shipped* — [range validation is out of scope](#out-of-scope-for-round-1), and shipping the data for a check we do not perform would be dead weight.

Both literals live in **one module**, because the only consumer needs both. spdx splits its two datasets for tree-shaking; that rationale does not apply here and the split would be cargo-culted.

Deprecated (`supersededBy`) terms are **kept**, with the superseding term, so they are flagged rather than reported unknown.

### The `current` document is internally inconsistent, and the generator must not paper over it

Three properties — `deliveryTime`, `isUnlabelledFallback`, `shippingDestination` — carry `domainIncludes: DeliveryTimeSettings`, **and that class is not declared in `schemaorg-current-https.jsonld`.** It exists only in `-all`. A generator that indexes the type table by name gets `undefined`, and `undefined` flowing into an interned index is a silent corruption that ships.

So the generator carries **assertions, in the [spdx generator's posture](spdx.md#vendored-data-and-regeneration)**, and they fail regeneration rather than emitting a damaged table:

1. **Every `domainIncludes` target resolves** to a declared native class, or the generator fails loudly naming the term and its unresolved target. Today that is a known, enumerated exception — three properties against `DeliveryTimeSettings` — which is dropped *with a recorded note in the generated header*, never silently.
2. **Every parent resolves** to a declared native class or carries a recognized foreign prefix ([trap 4](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data)). An unrecognized prefix is a new alignment vocabulary and a decision for a human, not a branch for the walk to guess at.
3. **Every interned index is in range** — the assertion that would have caught this class of bug without anyone knowing to look for it.

This is the invariant worth generalizing: **the upstream document is data, not truth.** It is internally inconsistent today, at v30.0, in a way that produces a plausible-looking table. The regeneration step is the only place that can catch it, so it is the place that asserts.

### Generation

A hand-run `lib/scripts/generate-data.ts`, devDep-only, never in CI and never in the test suite — the identical posture to [spdx's generator](spdx.md#vendored-data-and-regeneration), including the `oxc-parser` byte-span rewrite that replaces only each data literal's contents in place and leaves the module header, types and hand-authored code untouched. It is idempotent: re-run and diff when schema.org releases.

It sits under `lib/` rather than `scripts/` because `lib/` is where this repo keeps package-local tooling that is not shipped source; [`packages/runtimes/lib/scripts/generate-defaults.ts`](../../../../packages/runtimes/lib/scripts/generate-defaults.ts) is the precedent. (`@effected/spdx` places its generator at `scripts/` — that is the inconsistent one, and it is not the model to copy.)

**The generator imports `Graph` from `effect`, and that is correct — do not "fix" it.** It uses `Graph.directed` plus `Graph.isAcyclic` to assert the `rdfs:subClassOf` parent relation is a DAG ([trap 3](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data)), reporting any cycle by its strongly-connected component so a failure names the classes involved rather than merely asserting. Core owns the graph algorithms and the package must not re-implement them. This import is precisely why the package's own node-document type [is not called `Graph`](#three-names-were-changed-to-clear-effects-root-exports) — the generator was deliberately left out of that rename sweep, because its `Graph` is `effect`'s and always was.

It reads `lib/data/schemaorg-current-https.jsonld` — the *current* document, not `-all`, since retired terms are not something we want to accept. It applies exactly one filter — the `schema:` id-prefix filter of [trap 5](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data) — and no section include-list, because every section ships. The release constant is what must move in the same commit as a replacement of that file.

## What the consumer must do that this package will not

Stated plainly because the split is the whole point of putting this upstream:

- **Mint `@id`s.** The package never derives one and does not know your base URL.
- **Map its domain onto nodes.** *API model + manifest → these nodes* is tsdoctor's half and stays there.
- **Decide which properties matter.** No node is populated by default; there are no smart defaults.
- **Wrap the body in a `<script>` element** and place it in the document.
- **Own Google eligibility.** Conformance says schema.org defines the term. It does not say Google will show a rich result.
- **Convert an SPDX id to a license URL**, and a SemVer to a version string. One line each, at the call site, for the reasons in [the declined edges](#tier-and-dependencies).
- **Decide whether its graph must be closed** — whether a `DanglingReference` is a warning or a gate failure.

## Testing

`@effect/vitest`, `it.effect` the default, `assert.*` and never `expect`, in `packages/schema-org/__test__/`.

### The escaping fixture is mandatory, and it needs a positive control

A caveat without a fixture is this repo's documented failure mode, so the invariant gets a fixture whose payload is the real attack:

```ts
const description = "A summary containing </script><img src=x onerror=alert(1)> and a `<T>` generic";
```

Four assertions, and the fourth is the one that makes the other three mean anything:

1. `toScriptBody(graph)` contains no `<`, `>` or `&` at all. Escaping makes this literally true of the whole string, which is a far stronger and simpler assertion than searching for `</script`.
2. `JSON.parse(body)` returns the original `description`, character for character — the escape is lossless.
3. `/<\/script/i` does not match the body.
4. **Positive control: `JSON.stringify(graph.toJsonLd())` of the same graph DOES contain `</script>`.** Without this the first three pass against an empty graph, a stubbed serializer, or a fixture whose payload got sanitized upstream. It also pins the hazard itself, so if a future `JSON.stringify` ever escaped by default the test tells us rather than quietly becoming vacuous.

A property test generalizes it: over strings drawn from an alphabet including `<`, `>`, `&`, C0 controls, lone surrogates and newlines ([F3](../formatter-convention.md#the-fidelity-rules)), `JSON.parse(toScriptBody(g))` deep-equals the encoded value and the body matches `/^[^<>&]*$/`. No HTML parser is used — that would be a devDependency to assert something weaker than the byte property already asserts.

### The self-conformance test

**Every field of every shipped node class is `domainIncludes`-legal on that class's `@type`, checked against the vendored dataset.** This is the test that keeps the hand-written classes honest and the reason the dataset must cover our types' full ancestor closure (18 classes, 344 properties, for the round-1 set). It fails the day someone adds a plausible-sounding field, and it fails again the day schema.org moves one.

### The conformance corpus

Small hand-authored graphs, each pinning one answer, with a `README.md` beside them carrying [the provenance the playbook requires](../migration-playbook.md#fixtures-carry-a-provenance-readme) — every fixture here is hand-authored, and the README says which property each exists to pin:

- **`license` on `SoftwareSourceCode` → clean. This fixture is mandatory and it is the most important one in the suite.** `schema:license` carries exactly one `domainIncludes` entry, `CreativeWork`, so this is legal *only* by inheritance ([trap 1](#how-legality-is-resolved-five-traps-all-confirmed-against-the-vendored-data)) — a validator that checks direct membership rejects it, and it is a property the consumer's very first graph passes. A caveat here would be worthless; the fixture is the thing that stops the false rejection reaching them.
- A **multi-parent** type (`HowToStep`, which is a `ListItem` *and* a `CreativeWork` *and* an `ItemList`) carrying a property inherited through the second parent → clean. Kills the single-parent-walk mutant, which trap 1's fixture alone does not.
- A property with **many domains** (one of the 392) on a type matching a non-first entry → clean. Kills an equality-instead-of-membership check.
- A **foreign-namespace term** (`gs1:telephone`) in a catch-all → **no issue at all**, neither clean-by-accident nor `UnknownTerm`. Pins the deliberate skip.
- `softwareVersion` in a `SoftwareSourceCode`'s `additional` → `PropertyNotOnType`. The authentic false-acceptance case, not an invented one.
- `codeRepository` on `SoftwareSourceCode` → clean, the direct-membership case.
- A `supersededBy` term → `DeprecatedProperty` carrying the successor, and **not** rejected by the default gate.
- An invented `@type` → `UnknownTerm`, and under strict mode a failure. A **`pending` term → clean**, which is the assertion that pins [the full table](#what-ships-the-full-interned-table): under the cut this design started with, it would have been a false positive.
- A property whose `domainIncludes` names the undeclared `DeliveryTimeSettings` → the generator's assertion fires at regeneration time, not a runtime issue. Covered by a generator test, not a graph fixture.
- Duplicate `@id` and colliding `additional` key → build-time failures, not issues.
- A dangling `NodeRef` → an issue, and a clean `buildResult`.

### On the oracle

**There is no differential oracle here, and that fact is stated rather than papered over.** schema.org publishes no offline reference validator to differ against; the vocabulary document *is* the oracle, and it is already the thing we vendor. So the risk is not our data but **our interpretation** of `domainIncludes` and `subClassOf` — which is exactly what the corpus above pins, case by case.

The corollary from the [oracle rule](../effect-standards.md#the-oracle-for-a-ported-algorithm-is-external) binds hardest here: **never pin an emitted graph as a fixture.** A snapshot of what the serializer currently emits asserts only that it has not changed, which was never in doubt. Every assertion in this suite is either against the vendored vocabulary or against a property (losslessness, absence of `<`, idempotence).

## Out of scope for round 1

Each of these is a cut with a reason, not an oversight:

- **`BreadcrumbList`** (and `ListItem`, `WebSite`, `WebPage`). Explicitly deferred by the consumer. It also brings the first ordered, positional structure into the model, which is a different modeling problem from the flat nodes above and deserves its own round.
- **Parsing existing JSON-LD back into typed nodes.** No consumer needs it, and the flattened `additional` catch-all makes the decode direction genuinely fiddly. This is a **scope decision standing on its own** — it is no longer a consequence of the class form, since `JsonLdDocument` [is a `Schema.Class`](#jsonlddocument) and the decode direction therefore exists as a symbol. What round 1 declines is implementing it; [that declaration is explicit and tested](#the-decode-direction-is-declared-unimplemented-and-that-is-a-statement-not-an-omission), not inferred from the shape.
- **Embedded (non-`NodeRef`) node values.** [Ruled out above](#references-not-embedding-a-node-valued-property-holds-a-noderef), permanently rather than pending.
- **`rangeIncludes` validation.** We check the domain, not the range, and the asymmetry is deliberate: a range check needs the *value's* schema.org type, and a literal's type is ambiguous (`"2026-01-01"` is `Text`, `Date` and arguably `URL`-adjacent), so range checking produces false positives on correct input. Domain checking is the high-signal half and the half that catches the real failure.
- **Google rich-results policy checks.** A different artifact with a different cadence.
- **`toScriptElement`**, `@context` customization, term aliasing, and any non-JSON-LD RDF output (N-Quads, Turtle). The first is plausibly round 2; the rest are speculative.

## Build

Class factories written inline, `savvy.build.ts` suppressing `ae-forgotten-export` narrowly on the `_base` pattern per [the policy](../effect-standards.md#api-extractor--effect-class-factories) — never widened. The `@public` shared field records (`ThingFields`, `CreativeWorkFields`, `TechArticleFields`) are genuine surface and are documented as such rather than suppressed; **verify at scaffold time that spreading them into an inline class factory does not produce a second forgotten-export class** — if it does, the fix is to make the record public API (it already is), not to widen the suppression.

Two entrypoints means two `exports` keys (`.` and `./validate`) and a `src/conformance-entry.ts` beside `src/index.ts` ([never `src/conformance.ts` — see the collision above](#module-layout-and-the-two-entrypoints)); `@effected/workspaces` is the working precedent. Everything else is the standard pure-tier manifest from [package-setup.md](../package-setup.md), including the [stub-`src/index.ts`-before-the-first-install](../package-setup.md#scaffold-order-stub-srcindexts-before-the-first-install) order, the `effected` catalog entry via `pnpm catalog:sync`, and the `website/lib/models/schema-org` model paths in both `turbo.json` and `savvy.build.ts`.
