/**
 * schema.org as Effect Schema classes: build a JSON-LD graph of typed nodes,
 * and serialize it safely into a `<script>` element.
 *
 * Assemble nodes with {@link JsonLdDocument}, link them with {@link NodeRef},
 * and write the result with `toScriptBody()`, the escaped serializer. Offline
 * conformance checking against schema.org's vocabulary lives in the separate
 * `@effected/schema-org/validate` entrypoint so a graph-only consumer never
 * loads the vocabulary table.
 *
 * @example
 * ```ts
 * import { JsonLdDocument, NodeRef, SoftwareSourceCode, TechArticle } from "@effected/schema-org";
 * import { Result } from "effect";
 *
 * const built = JsonLdDocument.buildResult([
 * 	SoftwareSourceCode.make({ "@id": "https://example.com/pkg#source", name: "example" }),
 * 	TechArticle.make({
 * 		"@id": "https://example.com/pkg/docs#intro",
 * 		headline: "Getting started",
 * 		isPartOf: [NodeRef.to("https://example.com/pkg#source")],
 * 	}),
 * ]);
 *
 * console.log(Result.getOrThrow(built).toScriptBody());
 * ```
 *
 * @packageDocumentation
 */

export { APIReference } from "./APIReference.js";
export { CreativeWork, CreativeWorkFields } from "./CreativeWork.js";
export {
	ConflictingTermError,
	DuplicateNodeIdError,
	JsonLdDocument,
	JsonLdNode,
} from "./JsonLdDocument.js";
export type { HasNodeId } from "./NodeRef.js";
export { InvalidNodeIdError, NodeId, NodeRef } from "./NodeRef.js";
export { Organization } from "./Organization.js";
export { Person } from "./Person.js";
export { SoftwareSourceCode } from "./SoftwareSourceCode.js";
export { TechArticle, TechArticleFields } from "./TechArticle.js";
export { ThingFields } from "./Thing.js";
