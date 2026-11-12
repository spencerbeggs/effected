import { assert, describe, it } from "@effect/vitest";
import { StoreDocument } from "@effected/schemastore";
import { Effect, Predicate } from "effect";
import { EffectedConfigDocument, effectedConfigJsonSchemaOptions } from "../../src/config/EffectedConfigDocument.js";

// Guards the editor documentation of the published effected.toml schema
// (schemas/1.0/config.json): TSDoc never reaches a JSON Schema, so a field
// added without an `.annotate({ description })` would publish undocumented.

type Node = Readonly<Record<string, unknown>>;

const lower = Effect.fromResult(
	StoreDocument.fromSchemaResult(EffectedConfigDocument, {
		$id: "https://example.invalid/effected/config.json",
		jsonSchema: effectedConfigJsonSchemaOptions,
	}),
).pipe(Effect.map((document) => document.toJson()));

const nonEmpty = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0;

const REF_PREFIX = "#/$defs/";

// A property that is a bare `$ref` is documented by the definition it points at,
// because Draft-07 ignores a `$ref`'s siblings and editors show the target's text.
const isDescribed = (node: Node, defs: Node): boolean => {
	if (nonEmpty(node.description)) {
		return true;
	}
	const ref = node.$ref;
	if (typeof ref === "string" && ref.startsWith(REF_PREFIX)) {
		const target = defs[ref.slice(REF_PREFIX.length)];
		return Predicate.isObject(target) && nonEmpty((target as Node).description);
	}
	return false;
};

interface Findings {
	readonly undescribed: Array<string>;
	readonly untitled: Array<string>;
	visited: number;
}

const walk = (node: unknown, path: string, defs: Node, findings: Findings): void => {
	if (Array.isArray(node)) {
		for (const [index, child] of node.entries()) {
			walk(child, `${path}[${index}]`, defs, findings);
		}
		return;
	}
	if (!Predicate.isObject(node)) {
		return;
	}
	const schema = node as Node;
	const properties = schema.properties;
	if (Predicate.isObject(properties)) {
		if (!nonEmpty(schema.title)) {
			findings.untitled.push(path);
		}
		for (const [key, child] of Object.entries(properties as Node)) {
			findings.visited++;
			if (!Predicate.isObject(child) || !isDescribed(child as Node, defs)) {
				findings.undescribed.push(`${path}.${key}`);
			}
			walk(child, `${path}.${key}`, defs, findings);
		}
	}
	for (const keyword of ["items", "additionalProperties", "anyOf", "oneOf", "allOf"] as const) {
		if (keyword in schema) {
			walk(schema[keyword], `${path}/${keyword}`, defs, findings);
		}
	}
};

describe("the published effected.toml schema", () => {
	it.effect("gives every property at every level a description and every table a title", () =>
		Effect.gen(function* () {
			const document = yield* lower;
			const defs = (Predicate.isObject(document.$defs) ? document.$defs : {}) as Node;
			const findings: Findings = { undescribed: [], untitled: [], visited: 0 };
			walk(document, "#", defs, findings);
			for (const [name, definition] of Object.entries(defs)) {
				walk(definition, `#/$defs/${name}`, defs, findings);
			}
			assert.isAbove(findings.visited, 80, "the walk reached the document's properties");
			assert.deepStrictEqual(findings.undescribed, [], "properties with no description");
			assert.deepStrictEqual(findings.untitled, [], "tables with no title");
		}),
	);

	it.effect("carries the root annotations on the document root and names definitions without an Encoded suffix", () =>
		Effect.gen(function* () {
			const document = yield* lower;
			assert.isTrue(nonEmpty(document.title));
			assert.isTrue(nonEmpty(document.description));
			assert.strictEqual(document["x-tombi-toml-version"], "v1.1.0");
			assert.isUndefined(document.$ref, "the root is inline, not a $ref");
			const names = Object.keys((document.$defs ?? {}) as Node);
			assert.include(names, "PackageConfig");
			assert.include(names, "ActionConfig");
			assert.deepStrictEqual(
				names.filter((name) => name.endsWith("Encoded")),
				[],
			);
		}),
	);
});
