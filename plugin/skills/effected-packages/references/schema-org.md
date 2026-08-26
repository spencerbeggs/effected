# @effected/schema-org

The schema.org vocabulary as Effect Schema classes — build a JSON-LD document out of typed nodes, serialize it safely into a `<script>` element, and validate it against the vendored vocabulary offline. Pure tier: `dependencies: {}`, peers only on `effect`, no IO. The vocabulary is a compiled TypeScript literal, never a file read or a fetch, so a conformance gate runs in CI without a network.

The relationship to its consumers is the one `@effected/spdx` already has: a validated vocabulary plus a small algebra over it, with the mapping onto any particular domain left to the caller. This package will not tell you which nodes to emit for a documented package — it tells you whether the nodes you emitted are legal.

## Import

```ts
import { APIReference, JsonLdDocument, NodeRef, SoftwareSourceCode, TechArticle } from "@effected/schema-org";
import { Conformance, Vocabulary } from "@effected/schema-org/validate";
```

**Two entrypoints, and the split is load-bearing.** `.` carries the node classes, `NodeRef` and `JsonLdDocument`, and loads no vocabulary data. `./validate` carries `Vocabulary` and `Conformance` and is the only path that reaches the ~75 KB vocabulary table. A consumer that only builds and serializes graphs pays nothing for the validator; a structural test asserts the boundary, because one convenience import would silently undo it.

`./validate` re-exports the node classes **as types only** — validation needs the types, construction needs the values. A call site importing everything from `./validate` gets "only refers to a type" on `NodeRef.to`, which does not obviously point at the subpath.

## Feature surface

| Reach for | When |
| --- | --- |
| `SoftwareSourceCode`, `TechArticle`, `APIReference`, `Person`, `Organization`, `CreativeWork` | the six modeled node types; each is its own schema |
| `ThingFields` / `CreativeWorkFields` / `TechArticleFields` | spreading the shared field sets into a node you are composing |
| `NodeRef.to(target)` | pointing one node at another by `@id` — total, never throws |
| `NodeRef.toCheckedResult` / `.toChecked` / `.isValidId` | validating an id early instead of at assembly |
| `JsonLdDocument.buildResult(nodes)` | assembling a document with identity checked — **this is the entry point** |
| `JsonLdDocument.build` | the `Effect` twin of `buildResult` |
| `doc.toScriptBody()` | the string to put inside a `<script type="application/ld+json">` |
| `doc.toJsonLd()` | the encoded value, for a framework that takes an object rather than a string |
| `Conformance.check(doc)` | every issue, as a list — total, never fails, never throws |
| `Conformance.validateResult(doc, opts)` / `.validate` | the gate: `Result` / `Effect`, failing with `NonConformantGraphError` |
| `Vocabulary.hasType` / `.hasProperty` / `.ancestorsOf` / `.propertiesOf` / `.isPropertyOn` / `.supersededBy` / `.version` | asking the vocabulary directly |

## What to know before using it

- **`toScriptBody()` is the only text serializer, and that is deliberate.** Every string in a document originates in author-written prose, and a summary containing the literal `</script>` terminates the JSON-LD block early and injects markup — `JSON.stringify` does not escape it. `toScriptBody` escapes `<`, `>` and `&` after stringify; all three are valid JSON escapes that parse back to the original characters. There is no unescaped twin, because a second entry point could only ever be chosen wrongly. **The escaping is idempotent**, so a caller layering its own pass over the output is safe — that is a tested guarantee, not an inference.
- **Do not `JSON.stringify(doc.toJsonLd())` into a page.** `toJsonLd` ships for frameworks that take an object; it is the documented escape hatch, not the serializer.
- **`@id` is required and always caller-supplied**, never derived — the package cannot know your base URL, and a hash-derived id is unlinkable and churns.
- **A dangling reference is not an error.** Pointing at an organization described on another page is correct and common. Duplicate `@id` *is* an error, as is a catch-all key colliding with a typed field.
- **All identity failure lands at assembly, not on the field.** `NodeRef.to` and every `make` are total; `buildResult` is where `InvalidNodeIdError`, `DuplicateNodeIdError` and `ConflictingTermError` surface. `JsonLdDocument.make` exists because `Schema.Class` reserves it and runs none of those checks — reach for `buildResult`.
- **Node-valued properties hold a `NodeRef`, never an embedded node.** The package declines the inline form at the type level rather than silently flattening one representation into the other.
- **Every node carries an open `additional` catch-all, and it is why the validator is not tautological.** Typed fields are correct by construction; the catch-all is the one door an undefined-on-this-type property can walk through.
- **The decode direction is declared unimplemented — and it half-works, which is worse.** Decoding the wire form *succeeds* and silently drops the catch-all, since a flattened term is just an excess key to the schema. A test pins that loss. Do not assume `decode(encode(doc))` round-trips.
- **Arity is fixed per property and never `T | Array<T>`.** Where arity was uncertain the choice is *many*, because the error costs are asymmetric: wrong toward many costs one pair of brackets, wrong toward one costs a breaking change. `mainEntity` is singular by schema.org's own definition — that collapse is not this package's to revisit.

## The validator's four rules

Legality is **set intersection** between a property's `domainIncludes` and the type's **ancestor closure** — `license` declares one domain (`CreativeWork`) and is legal on `SoftwareSourceCode` only by inheritance. Beyond that:

1. A `schema:`-prefixed term is identical to its bare spelling; issue payloads quote the term **as the author wrote it**.
2. A prefix the vocabulary document itself declares (`gs1:`, `unece:`, `foaf:`, …) is **skipped in silence** — the author opted into a vocabulary this package does not police.
3. A prefix the document does **not** declare is reported: an undeclared prefix is no evidence of a real vocabulary, and is at least as likely to be a typo in the prefix.
4. A node whose `@type` is unknown has its properties left unchecked — there is no type to check them against, and reporting every property as misplaced would bury the one issue that matters. Its references are still checked.

Outcomes are three-valued: `UnknownTerm` is always reported and never silently passed, distinct from `PropertyNotOnType`, with `{ unknownTerms: "fail" }` as strict mode. There is no severity field — severity is the consumer's policy, expressed through the options.

## The vocabulary

Vendored from schema.org **v30.0** at `.repos/schemaorg`, generated into `src/internal/vocabulary.ts` by a hand-run script under `lib/scripts/`. **Every schema-native term ships** — 933 classes and 1,521 properties, interned — not a subset scoped to the six modeled types. Scoping was measured and rejected: those six types' properties name 69 distinct range types and 64 fall outside such a scope, so ordinary graphs would report unknown on day one. With a subset, "unknown" is irreducibly ambiguous between *misspelled* and *not shipped*, and a validator that cannot tell you which is worse than none.

Regeneration is a **vocabulary review, not a version bump** — a term that moved domain changes what the gate accepts. The generator asserts its own invariants and fails rather than emitting a damaged table.

## Related

- [spdx.md](./spdx.md) — `licensesOf` feeds this package's `license`, which is modeled as **many**. Note the field is not typed as an SPDX id: schema.org's range is `CreativeWork | URL`, so an SPDX-typed field would reject a legal `https://example.com/eula`.
- [package-json.md](./package-json.md) — `Repository.directoryUrl` is what distinguishes monorepo members in `codeRepository`; `licenseExpressionOf` bridges a manifest's branded license to an expression.
- [constructs/schema-org.md](./constructs/schema-org.md) — every exported construct, generated.
