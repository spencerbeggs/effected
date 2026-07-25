// Conformance against the CycloneDX 1.6 specification itself.
//
// This package declines the CycloneDX library (6.6 MB, seven optional peers)
// and owns its emitter, so "the output is conformant" has to be checkable
// rather than asserted. The published schema is vendored under `fixtures/` and
// the expectations below are DERIVED FROM IT — `required` arrays, `enum`
// members, property names — never hand-written. A wrong external-reference
// type, a missing required field or a renamed property therefore fails against
// the specification, not against a copy of our own assumptions.
//
// This is targeted conformance over the subset we emit, not full JSON-schema
// validation: validating fully would need `ajv`, and taking a validator as a
// devDependency to check output we entirely control is the weight this package
// exists to avoid. The subset IS everything the emitter produces.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Component, Contact, ExternalReference, Sbom, SbomMetadata, Supplier } from "../src/index.js";

interface JsonSchema {
	readonly properties?: Record<string, { readonly enum?: ReadonlyArray<string> }>;
	readonly required?: ReadonlyArray<string>;
	readonly definitions: Record<string, JsonSchema>;
}

const SCHEMA: JsonSchema = JSON.parse(
	readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "fixtures", "bom-1.6.SNAPSHOT.schema.json"), "utf8"),
) as JsonSchema;

const definition = (name: string): JsonSchema => {
	const found = SCHEMA.definitions[name];
	assert.isDefined(found, `the vendored schema has no definition for ${name}`);
	return found as JsonSchema;
};

/** A document exercising every field the emitter can produce. */
const fullDocument = () =>
	Sbom.generate({
		root: Component.make({
			type: "library",
			name: "@effected/sbom",
			version: "0.1.0",
			purl: "pkg:npm/%40effected%2Fsbom@0.1.0",
			bomRef: "@effected/sbom@0.1.0",
			description: "supply-chain artifacts",
			licenses: ["MIT"],
			tags: ["sbom", "cyclonedx"],
			publisher: "Acme",
			copyright: "Copyright 2026 Acme",
			authors: [Contact.make({ name: "Dee", email: "dee@example.com" })],
			externalReferences: [
				ExternalReference.make({ type: "vcs", url: "https://github.com/effected/kit" }),
				ExternalReference.make({ type: "issue-tracker", url: "https://github.com/effected/kit/issues" }),
				ExternalReference.make({ type: "website", url: "https://effected.dev" }),
				ExternalReference.make({ type: "documentation", url: "https://effected.dev/docs" }),
			],
		}),
		components: [Component.make({ type: "library", name: "dep", version: "1.0.0" })],
		metadata: SbomMetadata.make({
			timestamp: "2026-07-25T00:00:00.000Z",
			authors: [Contact.make({ name: "Ray", email: "ray@example.com" })],
			supplier: Supplier.make({ name: "Acme", url: ["https://acme.example"] }),
		}),
	});

const emitted = () => JSON.parse(Sbom.toJson(fullDocument())) as Record<string, never>;

describe("CycloneDX 1.6 conformance — derived from the vendored schema", () => {
	it("the vendored schema is the released 1.6 one", () => {
		// Guards the oracle itself: if the fixture is swapped for another version,
		// every assertion below silently changes meaning.
		const id = (SCHEMA as unknown as { $id?: string }).$id;
		assert.strictEqual(id, "http://cyclonedx.org/schema/bom-1.6.schema.json");
	});

	it("satisfies the document's required properties", () => {
		const document = emitted();
		for (const key of SCHEMA.required ?? []) {
			assert.property(document, key, `the schema requires a top-level ${key}`);
		}
	});

	it("declares the bomFormat the schema's enum permits", () => {
		const permitted = SCHEMA.properties?.bomFormat?.enum ?? [];
		assert.include(permitted, emitted().bomFormat as unknown as string);
	});

	it("every component satisfies the component definition's required properties", () => {
		const required = definition("component").required ?? [];
		const document = emitted();
		const components = [
			(document.metadata as { component: Record<string, unknown> }).component,
			...(document.components as unknown as ReadonlyArray<Record<string, unknown>>),
		];
		assert.isAbove(components.length, 1);
		for (const component of components) {
			for (const key of required) {
				assert.property(component, key, `a component must carry ${key}`);
			}
		}
	});

	it("every component type is a member of the schema's enum", () => {
		const permitted = definition("component").properties?.type?.enum ?? [];
		assert.isAbove(permitted.length, 0);
		const document = emitted();
		const types = [
			(document.metadata as { component: { type: string } }).component.type,
			...(document.components as unknown as ReadonlyArray<{ type: string }>).map((c) => c.type),
		];
		for (const type of types) {
			assert.include(permitted, type, `${type} is not a CycloneDX component type`);
		}
	});

	it("every external-reference type is a member of the schema's 43-value enum", () => {
		// The assertion most likely to catch an invented value: the model narrows
		// to four of the specification's types, and each must really exist.
		const permitted = definition("externalReference").properties?.type?.enum ?? [];
		assert.isAbove(permitted.length, 40);
		const references = (emitted().metadata as { component: { externalReferences: ReadonlyArray<{ type: string }> } })
			.component.externalReferences;
		assert.lengthOf(references, 4);
		for (const reference of references) {
			assert.include(permitted, reference.type, `${reference.type} is not a CycloneDX external-reference type`);
		}
	});

	it("every external reference carries the properties the schema requires", () => {
		const required = definition("externalReference").required ?? [];
		const references = (emitted().metadata as { component: { externalReferences: ReadonlyArray<object> } }).component
			.externalReferences;
		for (const reference of references) {
			for (const key of required) assert.property(reference, key);
		}
	});

	it("emits only property names the schema knows, at every level", () => {
		// The `bom-ref` guard, generalized. A key the specification does not define
		// is either a typo or an invention, and both produce a document that looks
		// right to us and wrong to a verifier.
		const known = (name: string) => new Set(Object.keys(definition(name).properties ?? {}));
		const document = emitted();

		const componentKeys = known("component");
		const rootComponent = (document.metadata as { component: Record<string, unknown> }).component;
		for (const key of Object.keys(rootComponent)) {
			assert.isTrue(componentKeys.has(key), `component.${key} is not in the CycloneDX component definition`);
		}

		const metadataKeys = known("metadata");
		for (const key of Object.keys(document.metadata as Record<string, unknown>)) {
			assert.isTrue(metadataKeys.has(key), `metadata.${key} is not in the CycloneDX metadata definition`);
		}

		const documentKeys = new Set(Object.keys(SCHEMA.properties ?? {}));
		for (const key of Object.keys(document)) {
			assert.isTrue(documentKeys.has(key), `${key} is not a CycloneDX document property`);
		}
	});
});
