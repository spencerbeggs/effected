import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { DocumentLint, NonJsonValueError, SchemaValidator, StoreDocument } from "../src/index.js";

const $id = "https://example.com/x-ai.schema.json";

// End-to-end through StoreDocument.fromSchema + the real ajv-backed
// SchemaValidator.layer + DocumentLint — no SchemaPipeline. Proves the
// x-ai- family reaches the emitted document exactly like any other
// declared family, and that the whole document still passes both gates
// once it is adopted.
describe("the x-ai- machine-annotation family, end to end", () => {
	// Field-level annotation at the DEFINITION site. Root-level "x-ai" (no
	// dash) is the negative control: it is not a declared family (bare
	// "x-ai" fails KeywordFamilies.isDeclared per the exact-prefix rule), so
	// fromSchema never admits it and it must not reach the document at all.
	const Annotated = Schema.Struct({
		name: Schema.String.annotate({ "x-ai-hint": "the display name" }),
	}).annotate({ "x-ai": true });

	it.effect("a field's x-ai-hint reaches the emitted document", () =>
		Effect.gen(function* () {
			const document = yield* StoreDocument.fromSchema(Annotated, { $id });
			const properties = document.root.properties as Record<string, Record<string, unknown>>;
			assert.strictEqual(properties.name?.["x-ai-hint"], "the display name");
		}),
	);

	it.effect("an undeclared root-level x-ai key does NOT survive (negative control)", () =>
		Effect.gen(function* () {
			const document = yield* StoreDocument.fromSchema(Annotated, { $id });
			assert.isFalse(Object.hasOwn(document.root, "x-ai"));
		}),
	);

	it.effect("DocumentLint reports no findings for the adopted family", () =>
		Effect.gen(function* () {
			const document = yield* StoreDocument.fromSchema(Annotated, { $id });
			assert.deepStrictEqual(DocumentLint.lint(document), []);
		}),
	);

	it.effect("the real ajv validator reports no findings for the adopted family", () =>
		Effect.gen(function* () {
			const document = yield* StoreDocument.fromSchema(Annotated, { $id });
			const findings = yield* Effect.provide(
				Effect.gen(function* () {
					const validator = yield* SchemaValidator;
					return yield* validator.validate(document.toJson());
				}),
				SchemaValidator.layer,
			);
			assert.deepStrictEqual(findings, []);
		}),
	);

	it("a JSON-hostile x-ai-hint value fails serializeResult with NonJsonValueError", () => {
		const document = StoreDocument.draft07({
			$id,
			root: { type: "object", "x-ai-hint": () => "not JSON" },
		});
		const result = document.serializeResult();
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			assert.instanceOf(result.failure, NonJsonValueError);
		}
	});
});
