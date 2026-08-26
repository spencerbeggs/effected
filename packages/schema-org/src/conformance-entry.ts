/**
 * The offline conformance half of `@effected/schema-org`: the vendored
 * schema.org vocabulary and the validator that reads it.
 *
 * This is a **separate entrypoint on purpose**. The vocabulary table is the
 * whole of what a graph-only consumer avoids: importing `@effected/schema-org`
 * loads the node classes and the serializer and nothing else, while the table
 * is reachable only from here. An unbundled Node consumer that imported one
 * barrel would otherwise load 73 KB of vocabulary literals it never reads, and
 * validation is the build-time half of a consumer's work — a CI gate — while
 * graph assembly runs in the page render path.
 *
 * The graph types below are re-exported **as types only**, so they are erased
 * at runtime and the split holds: `Conformance.check` takes a `JsonLdDocument`, and its
 * declaration has to be able to name one.
 *
 * @example
 * ```ts
 * import { Conformance, Vocabulary } from "@effected/schema-org/validate";
 *
 * console.log(Vocabulary.version); // => "30.0"
 * for (const issue of Conformance.check(graph)) console.log(issue.message);
 * ```
 *
 * @packageDocumentation
 */

// Type-only: named by the validator's signatures, erased at runtime.
export type { APIReference } from "./APIReference.js";
export type { ConformanceOptions } from "./Conformance.js";
export {
	Conformance,
	ConformanceIssue,
	DanglingReference,
	DeprecatedProperty,
	DeprecatedType,
	NonConformantGraphError,
	PropertyNotOnType,
	TermKind,
	UnknownTerm,
} from "./Conformance.js";
export type { CreativeWork } from "./CreativeWork.js";
export type { ConflictingTermError, DuplicateNodeIdError, JsonLdNode } from "./JsonLdDocument.js";
// `JsonLdDocument` is the one VALUE re-export here: it is the parameter type of every
// validator entry point, and API Extractor needs the class itself — not just
// its type — declared by this entrypoint. It costs a conformance consumer
// nothing they were not already holding, and it does not carry the vocabulary
// table in the other direction, which is the cost the split exists to avoid.
export { JsonLdDocument } from "./JsonLdDocument.js";
export type { HasNodeId, InvalidNodeIdError, NodeRef } from "./NodeRef.js";
export type { Organization } from "./Organization.js";
export type { Person } from "./Person.js";
export type { SoftwareSourceCode } from "./SoftwareSourceCode.js";
export type { TechArticle } from "./TechArticle.js";
export { Vocabulary } from "./Vocabulary.js";
