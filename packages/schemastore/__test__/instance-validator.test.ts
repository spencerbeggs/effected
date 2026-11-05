import { assert, describe, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import { InstanceFinding, InstanceValidator, InstanceValidatorError } from "../src/index.js";

// A stub implementation proving the contract is implementable — the pattern a
// real consumer follows when closing the seam with ajv at the edge: a
// non-conforming instance answers findings as values; a broken engine fails
// typed.
const stubEngine = Layer.succeed(InstanceValidator, {
	validate: (document, instance, options) => {
		if (document.boom === true) {
			return Effect.fail(InstanceValidatorError.make({ cause: new Error("engine exploded") }));
		}
		if ((options?.strict ?? true) && typeof instance !== "object") {
			return Effect.succeed([
				InstanceFinding.make({
					path: "",
					message: "strict stub: expected an object instance",
					keyword: "type",
				}),
			]);
		}
		return Effect.succeed([]);
	},
});

describe("InstanceValidator", () => {
	// The contract and its doubles only: the shipped engine is
	// @effected/engine/schema's AjvInstanceValidator, tested there.
	layer(InstanceValidator.noop)((it) => {
		it.effect("the noop layer validates nothing and answers a clean pass", () =>
			Effect.gen(function* () {
				const validator = yield* InstanceValidator;
				const findings = yield* validator.validate({ definitely: "not a schema" }, { definitely: "not an instance" });
				assert.deepStrictEqual(findings, []);
			}),
		);
	});

	layer(stubEngine)((it) => {
		it.effect("a stub implementation answers findings as values for a rejected instance", () =>
			Effect.gen(function* () {
				const validator = yield* InstanceValidator;
				const findings = yield* validator.validate({ type: "object" }, "not an object");
				assert.strictEqual(findings.length, 1);
				assert.strictEqual(findings[0]?.path, "");
				assert.strictEqual(findings[0]?.keyword, "type");
			}),
		);

		it.effect("an omitted strictness means strict; strict: false relaxes the stub's gate", () =>
			Effect.gen(function* () {
				const validator = yield* InstanceValidator;
				const relaxed = yield* validator.validate({ type: "object" }, "not an object", { strict: false });
				assert.deepStrictEqual(relaxed, []);
				const clean = yield* validator.validate({ type: "object" }, { name: "x" });
				assert.deepStrictEqual(clean, []);
			}),
		);

		it.effect("a mechanism failure fails typed with InstanceValidatorError", () =>
			Effect.gen(function* () {
				const validator = yield* InstanceValidator;
				const error = yield* Effect.flip(validator.validate({ boom: true }, {}));
				assert.instanceOf(error, InstanceValidatorError);
				assert.strictEqual(error._tag, "InstanceValidatorError");
				assert.strictEqual(error.message, "Instance validation engine failed");
			}),
		);
	});

	layer(InstanceValidator.layerTest())((it) => {
		it.effect("an unstubbed layerTest member dies naming the member", () =>
			Effect.gen(function* () {
				const validator = yield* InstanceValidator;
				const exit = yield* Effect.exit(validator.validate({}, {}));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					const defect = Cause.squash(exit.cause);
					assert.instanceOf(defect, Error);
					assert.include((defect as Error).message, "validate() was called but not stubbed");
				}
			}),
		);
	});

	layer(InstanceValidator.layerTest({ validate: () => Effect.succeed([]) }))((it) => {
		it.effect("a stubbed layerTest member answers instead of dying", () =>
			Effect.gen(function* () {
				const validator = yield* InstanceValidator;
				assert.deepStrictEqual(yield* validator.validate({}, {}), []);
			}),
		);
	});
});
