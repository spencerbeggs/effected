import { assert, describe, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { SchemaValidator, SchemaValidatorError, ValidationFinding } from "../src/index.js";

// A stub implementation proving the contract is implementable — the pattern a
// real consumer follows when closing the seam with ajv at the edge: a strict
// "compile failure" answers findings as values; a broken engine fails typed.
const stubEngine = Layer.succeed(SchemaValidator, {
	validate: (document, options) => {
		if (document.boom === true) {
			return Effect.fail(SchemaValidatorError.make({ cause: new Error("engine exploded") }));
		}
		if ((options?.strict ?? true) && typeof document.unknownKeyword !== "undefined") {
			return Effect.succeed([
				ValidationFinding.make({
					path: "/unknownKeyword",
					message: 'strict mode: unknown keyword: "unknownKeyword"',
					keyword: "unknownKeyword",
				}),
			]);
		}
		return Effect.succeed([]);
	},
});

describe("SchemaValidator", () => {
	layer(SchemaValidator.noop)((it) => {
		it.effect("the noop layer validates nothing and answers a clean pass", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const findings = yield* validator.validate({ definitely: "not a schema" });
				assert.deepStrictEqual(findings, []);
			}),
		);
	});

	layer(stubEngine)((it) => {
		it.effect("a stub implementation answers findings as values for a rejected document", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const findings = yield* validator.validate({ type: "object", unknownKeyword: 1 });
				assert.strictEqual(findings.length, 1);
				assert.strictEqual(findings[0]?.path, "/unknownKeyword");
				assert.strictEqual(findings[0]?.keyword, "unknownKeyword");
			}),
		);

		it.effect("an omitted strictness means strict; strict: false relaxes the stub's gate", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const relaxed = yield* validator.validate({ unknownKeyword: 1 }, { strict: false });
				assert.deepStrictEqual(relaxed, []);
				const clean = yield* validator.validate({ type: "object" });
				assert.deepStrictEqual(clean, []);
			}),
		);

		it.effect("a mechanism failure fails typed with SchemaValidatorError", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const error = yield* Effect.flip(validator.validate({ boom: true }));
				assert.instanceOf(error, SchemaValidatorError);
				assert.strictEqual(error._tag, "SchemaValidatorError");
				assert.strictEqual(error.message, "Schema validation engine failed");
			}),
		);
	});

	layer(SchemaValidator.layerTest())((it) => {
		it.effect("an unstubbed layerTest member dies naming the member", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				const exit = yield* Effect.exit(validator.validate({}));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					const defect = Cause.squash(exit.cause);
					assert.instanceOf(defect, Error);
					assert.include((defect as Error).message, "validate() was called but not stubbed");
				}
			}),
		);
	});

	layer(SchemaValidator.layerTest({ validate: () => Effect.succeed([]) }))((it) => {
		it.effect("a stubbed layerTest member answers instead of dying", () =>
			Effect.gen(function* () {
				const validator = yield* SchemaValidator;
				assert.deepStrictEqual(yield* validator.validate({}), []);
			}),
		);
	});
});
