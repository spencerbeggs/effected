import { Schema } from "effect";
import { NodeRef } from "./NodeRef.js";
import { ThingFields } from "./Thing.js";

/**
 * A schema.org `Person` — an author, maintainer or contributor.
 *
 * Carries only `Thing`-level fields plus the two person-specific ones. The
 * `CreativeWork` vocabulary (`license`, `author`, `datePublished`, …) is
 * deliberately absent: those properties are not `domainIncludes`-legal on
 * `Person`, and the package's self-conformance test asserts it.
 *
 * @example
 * ```ts
 * import { Person } from "@effected/schema-org";
 *
 * const alice = Person.make({
 * 	"@id": "https://example.com/#alice",
 * 	name: "Alice Example",
 * 	url: "https://example.com/alice",
 * });
 * ```
 *
 * @public
 */
export class Person extends Schema.Class<Person>("Person")({
	...ThingFields,
	/** The JSON-LD type discriminator, populated automatically. */
	"@type": Schema.tag("Person"),
	/** An email address for the person. Single-valued. */
	email: Schema.optional(Schema.String),
	/** Organizations the person is affiliated with, by reference. Repeatable. */
	affiliation: Schema.optional(Schema.Array(NodeRef)),
}) {}
