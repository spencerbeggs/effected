---
status: current
module: effected
category: architecture
created: 2026-08-25
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 95
related:
  - schema-org-conformance.md
  - ../package-setup.md
  - ../consumers/tsdoctor.md
  - ../effect-standards.md
  - ../sync-primitive-policy.md
  - ../formatter-convention.md
  - spdx.md
  - semver.md
  - package-json.md
---

# @effected/schema-org design

## Overview

`@effected/schema-org` is the schema.org vocabulary as Effect Schema classes, a `JsonLdDocument` that assembles them into one JSON-LD document with `@id` cross-references, a single script-safe serializer and an offline conformance validator over schema.org's own released vocabulary. All pure.

It follows [`@effected/spdx`](spdx.md) exactly: a validated vocabulary plus a small algebra over it, the dataset vendored as generated TypeScript, and the mapping onto any particular domain left to the consumer. spdx knows what `Apache-2.0 WITH LLVM-exception` means and nothing about `package.json`; this package knows what a `TechArticle` is and nothing about TypeScript.

The package exists because [tsdoctor](../consumers/tsdoctor.md) derives JSON-LD for a documented TypeScript package. The vocabulary half of that work is domain-neutral, so it lives upstream; tsdoctor holds exactly one thing: *API model + manifest → these nodes*.

The central invariant is not the vocabulary. It is [the serializer](#the-serializer-is-the-invariant): every string in a graph originates in author-written TSDoc, and a summary containing the literal `</script>` closes the JSON-LD block early and injects markup. `JSON.stringify` does not escape it. Everything else in this document is a vocabulary package; that one thing is a security boundary.

The validator, the vocabulary read API and the vendored dataset have their own doc: [schema-org-conformance.md](schema-org-conformance.md).

## Tier and dependencies

**Pure tier** under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy), and the argument is not just "no `FileSystem` import":

- **No IO, including for the vendored data.** The vocabulary is a TypeScript literal compiled into the bundle, not a JSON file read at load. The generator that produces it reads files, and it is a hand-run script in `lib/scripts/`, never shipped and never on any code path in `src/`. If validation ever needed to *fetch* the vocabulary, this would be a boundary package; it deliberately does not.
- **No services, no layers, no `R`.** Inputs are values and strings, outputs are values, typed errors and one string.
- **No external runtime dependency.** `effect` is the only peer, `dependencies` is `{}` and `"sideEffects": false`.

Two `@effected/*` edges are available and **both are declined**:

- **`@effected/spdx` for `license`.** schema.org's `license` has range `CreativeWork | URL` — a *URL*, not an SPDX identifier. Typing it as an SPDX expression would reject legal input (`https://example.com/eula`) to serve a coincidence. A consumer holding an SPDX id maps it to a URL at its own call site with spdx's [`License.referenceUrl`](spdx.md#catalog-metadata), without either package learning about the other.
- **`@effected/semver` for `version`.** schema.org's `version` has range `Number | Text`. Requiring SemVer would reject a legal `"2024-11"` or `"1.0-beta"`. Same decline, same reason.

Both declines look obviously right from the kit's side and are obviously wrong from the vocabulary's: **the vocabulary's range is the contract, not our neighbour package's grammar.**

## Module layout and the two entrypoints

Module-per-concept per the [standard](../effect-standards.md#module-layout-module-per-concept); only entrypoints re-export.

- `src/NodeRef.ts` — `NodeId` (branded scalar), `NodeRef` (the `{"@id": …}` reference node), `InvalidNodeIdError`.
- `src/Thing.ts` — `ThingFields`, the shared field record every node spreads.
- `src/CreativeWork.ts`, `src/Person.ts`, `src/Organization.ts`, `src/SoftwareSourceCode.ts`, `src/TechArticle.ts`, `src/APIReference.ts` — one node class per module, plus that class's field record where it is shared.
- `src/JsonLdDocument.ts` — `JsonLdDocument`, `JsonLdNode`, the identity errors and the serializer.
- `src/Vocabulary.ts`, `src/Conformance.ts`, `src/internal/vocabulary.ts` — the validator half, covered in [schema-org-conformance.md](schema-org-conformance.md).
- `src/index.ts` — the `.` entrypoint; `src/conformance-entry.ts` — the `./validate` entrypoint.

**Two published entrypoints, and the split is the answer to "does a consumer that only builds graphs pay for the validator".** `.` exports the node classes, `NodeRef` and `JsonLdDocument`. `./validate` exports `Vocabulary` and `Conformance`, and is the *only* path that reaches `src/internal/vocabulary.ts`. A bundler sees through a re-export barrel, but an unbundled Node consumer importing `TechArticle` from a single entrypoint would load the whole vocabulary table it never reads. The subpath makes that cost zero for the common case, and `__test__/entrypoints.test.ts` asserts the boundary with a positive control, since review cannot enforce it. Validation is also the *build-time* half of a consumer's work — a CI gate — while graph assembly runs in the page render path; the split matches how the two are used.

`./validate` re-exports the graph types as `export type` — with exactly one value exception, `JsonLdDocument`, which is the parameter type of every validator entry point and which API Extractor needs declared as a class by that entrypoint. The general form of the rule is in [package-setup.md](../package-setup.md#the-wiring). The accepted cost, reported by the first consumer: importing *everything* from `./validate` gets `"only refers to a type"` on `NodeRef.to`, and the error does not point at the subpath. The README's import example shows both entrypoints side by side for that reason.

**The subpath is `./validate`, not `./conformance`.** A subpath export key must not differ from a concept module's name only in case — it collides at the source layer (TS1149) and, worse, at the declaration layer, where API Extractor resolves the emitted `conformance.d.ts` case-insensitively onto `Conformance.d.ts` and reports a CI-fatal `ae-forgotten-export` for a symbol the entry visibly exports. The rule lives in [package-setup.md](../package-setup.md#the-case-collision-rule); this package is where it bit.

**Public names clear `effect`'s root exports.** The document is `JsonLdDocument`, its node union `JsonLdNode` and the reference `NodeRef` — not `Graph`, `GraphNode` and `Ref`, all of which `effect` exports from its root. The rule is kit-wide ([effect-standards.md](../effect-standards.md#a-public-name-must-not-collide-with-an-effect-root-export)), and the collision was not hypothetical here: the generator imports `effect`'s `Graph` for an acyclicity assertion, so the two names met inside this package.

## Modeling the vocabulary

schema.org is rampantly optional and rampantly polymorphic: nearly every property is omissible, and any property may hold a literal, an embedded node, a `{"@id"}` reference or an array mixing all three. Modeling that faithfully produces per-property unions that typecheck everything and tell the author nothing. Four rules narrow it, each a deliberate restriction of what schema.org permits to what a `@graph` document actually needs.

### Every node is a `Schema.Class`; no schema inheritance

Each node is a flat `Schema.Class` declaring its full field set inline, per the [API Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). `TechArticle` does **not** extend `Article` extends `CreativeWork`.

Reproducing schema.org's `rdfs:subClassOf` chain as TypeScript inheritance would create a second source of truth for a fact that already lives in the vendored dataset — the one the validator reads — and the two would drift the first time schema.org moves a property up a level. Shared fields are handled by **spreading a `@public` field record** (`...ThingFields`, `...CreativeWorkFields`, `...TechArticleFields`): one source of the field definitions, no heritage chain, and each class's emitted `.d.ts` lists its own fields.

`make` is the right constructor for a node: unlike [spdx](spdx.md#public-api), a node has no string form to parse, so `make` is not competing with anything. `JsonLdDocument` is the one place the `Schema.Class` `make` reservation bites, [resolved there](#jsonlddocument).

### Optionality: `Schema.optional`, not `Schema.optionalKey` — a scoped exception

This **diverges from the kit's schema standard**, which says `optionalKey` for omissible fields. It is allowed here as a scoped exception and is explicitly **not a kit-wide precedent**: it is licensed by this package's construction pattern, and a package whose fields do not originate in possibly-absent upstream metadata has no claim on it.

Under `optionalKey`, passing an explicit `undefined` throws — so every consumer call site becomes a wall of conditional spreads, because **every field of every node originates in a possibly-absent TSDoc tag**. Under `optional`, `description: undefined` is legal and the key is dropped at serialize time, which the serializer has to do regardless: JSON-LD has no `undefined` and no meaningful `null`, so "omit the key" is the only correct wire behaviour and it belongs in the one place that produces the wire form. The strictness `optionalKey` buys is about a distinction — absent vs present-and-undefined — that does not survive serialization.

`@id` and `@type` are the only non-optional members of any node.

### Arity: one shape per property, always the wire shape

A property that schema.org permits to repeat is modeled as `ReadonlyArray<T>` and **always emitted as an array**, even at length one. A single-valued property is a scalar and always emitted as a scalar. There is no `T | ReadonlyArray<T>` anywhere in the surface and no "collapse a one-element array" option. This is legal rather than merely convenient: in the JSON-LD data model a value and a one-element array of that value are the same thing, so every conforming processor reads them identically. We give up nothing expressible and gain exactly one representation per property, which is what makes round-trip assertions and property tests meaningful.

The governing rule is spdx's [never-pick-a-representative](spdx.md#reading-licenses-out-of-an-expression) precedent: collapsing a many to a one is silent data loss that produces confidently-wrong output looking perfectly fine. Three commitments follow:

1. Where a property is genuinely one-or-many, the many case is unmissable — there is no singular accessor to reach for.
2. If a singular accessor is ever added, it declines (`Option.none`) rather than chooses whenever choosing would drop information.
3. A collapse to a scalar carries a justification on the member's TSDoc, and it says whose collapse it is. `mainEntity` is singular **by schema.org's own definition** — the vocabulary's collapse, not ours to revisit. `name`, `headline`, `version`, `datePublished` and their kin are singular by nature, and those are the rows a later round may reconsider.

Where arity is genuinely uncertain, **choose many**, because the error costs are asymmetric: wrong toward many costs one pair of brackets at a call site, wrong toward one costs a breaking change. `publisher` is many on exactly that reasoning. Widening a scalar to an array is a breaking change and the TSDoc says so on the member.

### References, not embedding

A property whose value is another node is typed as `NodeRef` — never as the node class, never as a union of the two. The `@graph` form exists precisely so that nodes are siblings addressed by `@id`; supporting embedding too would double the value space of every node-valued property for zero capability and make a graph's node set ambiguous. `NodeRef.to(node)` builds one from a node you are already holding, so the common case is not stringly-typed.

The residual cost is accepted: a consumer who wants a genuinely nested document has to give the nested node an `@id` and put it in the graph. That is a better document anyway. This is the arity rule on the other axis — the package declines the inline form at the type level so the caller confronts the choice, rather than silently rewriting one representation into the other.

### The catch-all, and why the validator exists

Six classes cannot cover schema.org, so each node carries an open `additional: Record<string, JsonValue>` whose entries are **flattened into the node's JSON object** at serialize time. This is the design's spine and it is what makes offline conformance validation worth shipping rather than tautological: typed fields are correct by construction, proven once by the self-conformance test; the catch-all is unchecked by the compiler and is the one door a plausible-looking property that schema.org does not define on that type can enter through.

A key in `additional` that collides with a typed field, with `@id` or with `@type` is caller error and fails at graph construction (`ConflictingTermError`), not at validation.

## Node identity and cross-references

**`@id` is required on every node.** A node without one cannot be referenced or deduplicated, and is indistinguishable from a second copy of itself.

**Ids are caller-supplied; the package never derives one.** An `@id` is an IRI in the consumer's namespace, and the package has no idea what the consumer's base URL is. A derived opaque id — a content hash — would be unlinkable from outside and would change when an unrelated field changed. There is no synthesis helper and adding one would be a mistake worth resisting.

`NodeId` is a branded string with a **deliberately loose** check: non-empty, no whitespace, no control characters. It accepts absolute IRIs, blank-node ids (`_:pkg`) and relative or fragment forms, because all three are legal JSON-LD and a stricter IRI grammar would reject legal input to catch a typo — the [formatter convention's C1](../formatter-convention.md#the-driving-constraint) failure in a different costume. "No control characters" is spelled `\p{Cc}`, not a hand-written range: a hand-written C0 range silently admits the C1 block, and a `NodeId` is interpolated into a serialized document. **For a Unicode category, name the category.**

**A dangling reference is not an error.** A `NodeRef` pointing outside the graph is legal, common and often correct — the referenced organization is described on another page. So `JsonLdDocument.buildResult` **fails** on a duplicate `@id` and on a colliding `additional` key, and **never fails** on a dangling reference: `graph.danglingReferences` exposes them, and `Conformance` reports each as a `DanglingReference` issue, so a closed-world consumer can gate on it and an open-world one ignores it. Hard failure for identity errors, reported issue for openness — the package refuses to decide whether a consumer's graph is closed.

## `JsonLdDocument`

`JsonLdDocument` is a **`Schema.Class`** carrying `@context` and the node list, because the kit's named domain models are schema classes and this is the shape to be in if JSON-LD → typed nodes ever ships. The `@context` is fixed at `"https://schema.org"`, matching the vocabulary document we vendor.

**The validating constructor is `buildResult`**, because `Schema.Class` reserves `make` — the same constraint [spdx hit](spdx.md#public-api). Per the [sync-primitive policy](../sync-primitive-policy.md) it is the primitive, returning `Result<JsonLdDocument, DuplicateNodeIdError | ConflictingTermError>`, with `JsonLdDocument.build` as its `Effect.fromResult` twin behind a span. `JsonLdDocument.make` remains the raw structural constructor `Schema.Class` provides — it runs none of the identity checks and is not the documented entry point.

There is deliberately **no `SchemaOrg` facade object.** Collecting the package's surface behind one binding is the [namespace-object ban](../effect-standards.md#no-barrel-re-exports), and here it would be load-bearing: a single binding would make the vocabulary dataset reachable from every importer and undo the entrypoint split.

### The decode direction is declared unimplemented, and that is a statement, not an omission

Being a `Schema.Class` means `Schema.decodeUnknown(JsonLdDocument)` exists as a symbol, and **the flattened `additional` catch-all is not symmetric under decode**: encode spreads a node's catch-all entries into the JSON object, and a faithful decode would have to re-gather every unrecognized key back into `additional`, with real decisions attached. The package does not implement that. Decoding the wire form succeeds and silently drops the catch-all, the class's TSDoc says so in those words, and `__test__/JsonLdDocument.test.ts` pins the asymmetry so nobody infers `decode(encode(g)) ≡ g` and so the round trip cannot start half-working by accident. When the decode direction lands, the catch-all re-gathering rule is its central design question.

## The serializer is the invariant

**The package exposes exactly one text serializer, and it is the escaped one.** `graph.toScriptBody(): string` returns the JSON-LD body, script-embeddable, and there is no unescaped twin.

The mechanism: after `JSON.stringify`, replace every `<`, `>` and `&` with its `\uXXXX` escape. Four properties make this the correct fix rather than a defensive hack:

1. **It is exhaustive.** In a JSON document those characters can only occur inside string literals, so a blanket post-stringify replacement cannot corrupt structure — a provable property, which is why the escape needs no JSON-aware walker.
2. **It is lossless.** `\uXXXX` is a valid JSON string escape; every conforming parser produces the original character.
3. **It makes the element unclosable from inside.** With no `<` in the body, neither `</script` nor `<!--` can appear.
4. **`&` is included** for documents served as XHTML, where script content is ordinary element content and a raw `&` is a well-formedness error. `U+2028`/`U+2029` are deliberately **not** escaped: they only matter inside JavaScript source, and this is never JavaScript source.

**Why there is no unsafe twin.** The escaped output is semantically identical to the unescaped output for every consumer that parses it, and every consumer parses it. An unsafe serializer beside a safe one would exist only to be chosen wrongly, by the caller with the shortest deadline.

**The escape hatch we cannot close, and therefore document.** `Schema.encode(JsonLdDocument)` is public whether we like it or not, so `graph.toJsonLd()` — the plain encoded value, for a framework that takes an object rather than a string — ships named for what it is, with the loudest TSDoc in the package: **if you are producing text, use `toScriptBody`; never `JSON.stringify` this value into a page.** Pretending the value form does not exist would only remove our chance to warn about it.

`toScriptBody` returns the **body only**, not a `<script>` element. Returning an element would make this an HTML generator and drag in attribute-escaping decisions; the README documents the wrapper. A `toScriptElement` helper is deferred, not rejected.

## What the consumer must do that this package will not

- **Mint `@id`s.** The package never derives one and does not know your base URL.
- **Map its domain onto nodes.** No node is populated by default; there are no smart defaults.
- **Wrap the body in a `<script>` element** and place it in the document.
- **Own Google eligibility.** Conformance says schema.org defines the term; it does not say Google will show a rich result.
- **Convert an SPDX id to a license URL**, and a SemVer to a version string, at the call site, for the reasons in [the declined edges](#tier-and-dependencies).
- **Decide whether its graph must be closed** — whether a `DanglingReference` is a warning or a gate failure.

## Testing

`@effect/vitest`, `assert.*` and never `expect`, in `__test__/`. The validator's corpus is described in [schema-org-conformance.md](schema-org-conformance.md#testing); the suites that belong to this half:

**The escaping fixture is mandatory and needs a positive control.** `__test__/serializer.test.ts` carries a payload that is the real attack (`</script><img …>` inside a description) and asserts that `toScriptBody` contains no `<`, `>` or `&` at all, that `JSON.parse` of the body returns the original string, and — the assertion that makes the others mean anything — that `JSON.stringify(graph.toJsonLd())` of the same graph **does** contain `</script>`. Without the positive control the escaping assertions pass against an empty graph, a stubbed serializer or a sanitized fixture, and it also pins the hazard itself. A property test generalizes it over strings drawn from an alphabet of `<`, `>`, `&`, controls, lone surrogates and newlines. No HTML parser is used — it would be a devDependency asserting something weaker than the byte property.

**The self-conformance test.** Every field of every shipped node class is `domainIncludes`-legal on that class's `@type`, checked against the vendored dataset. It keeps the hand-written classes honest, fails the day someone adds a plausible-sounding field and fails again the day schema.org moves one.

**Never pin an emitted graph as a fixture.** A snapshot of what the serializer currently emits asserts only that it has not changed. Every assertion in this suite is against the vendored vocabulary or against a property (losslessness, absence of `<`, idempotence), per the [oracle rule](../effect-standards.md#the-oracle-for-a-ported-algorithm-is-external).

## Out of scope

Each is a cut with a reason, not an oversight:

- **`BreadcrumbList`** and its kin (`ListItem`, `WebSite`, `WebPage`). Ordered, positional structure is a different modeling problem from the flat nodes above and deserves its own round.
- **Parsing existing JSON-LD back into typed nodes.** No consumer needs it; [the declaration is explicit and tested](#the-decode-direction-is-declared-unimplemented-and-that-is-a-statement-not-an-omission).
- **Embedded node values.** Ruled out permanently, not pending.
- **`rangeIncludes` validation** and **Google rich-results policy** — see the [conformance doc](schema-org-conformance.md#what-conformance-is-not).
- **`toScriptElement`**, `@context` customization, term aliasing and non-JSON-LD RDF output.

## Build

Class factories written inline, with `savvy.build.ts` suppressing `ae-forgotten-export` narrowly on the `_base` pattern per [the policy](../effect-standards.md#api-extractor--effect-class-factories) — never widened. The `@public` shared field records are genuine surface, documented as such rather than suppressed. Two entrypoints means two `exports` keys and `src/conformance-entry.ts` beside `src/index.ts`; everything else is the standard pure-tier manifest from [package-setup.md](../package-setup.md).
