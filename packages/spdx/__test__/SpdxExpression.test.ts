import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { InvalidSpdxExpressionError } from "../src/License.js";
import { SpdxExpression, isValidExpression } from "../src/SpdxExpression.js";

const VALID = [
	"MIT",
	"Apache-2.0+",
	"(MIT OR Apache-2.0)",
	"MIT AND BSD-3-Clause",
	"GPL-2.0-or-later WITH Bison-exception-2.2",
	"LicenseRef-Proprietary",
	"(MIT AND (Apache-2.0 OR BSD-3-Clause))",
];
const INVALID = ["NOPE-1.0", "MIT AND", "(MIT", "MIT OR OR Apache-2.0", ""];

describe("SpdxExpression", () => {
	for (const s of VALID) {
		it.effect(`parses ${s}`, () =>
			Effect.gen(function* () {
				const expr = yield* SpdxExpression.parse(s);
				assert.isDefined(expr);
			}),
		);
		it(`validates ${s} synchronously`, () => assert.isTrue(isValidExpression(s)));
	}
	for (const s of INVALID) {
		it.effect(`rejects ${JSON.stringify(s)} as a typed error`, () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(SpdxExpression.parse(s));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					// discriminate a typed failure from a defect
					assert.isFalse(Cause.hasDies(exit.cause));
				}
			}),
		);
		it(`invalidates ${JSON.stringify(s)} synchronously`, () => assert.isFalse(isValidExpression(s)));
	}
	it.effect("fails invalid input with the typed InvalidSpdxExpressionError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(SpdxExpression.parse("NOPE-1.0"));
			assert.instanceOf(error, InvalidSpdxExpressionError);
			assert.strictEqual(error.input, "NOPE-1.0");
		}),
	);
	it.effect("round-trips through toString", () =>
		Effect.gen(function* () {
			const expr = yield* SpdxExpression.parse("(MIT OR Apache-2.0)");
			assert.strictEqual(expr.toString(), "(MIT OR Apache-2.0)");
		}),
	);
	it.effect("FromString decodes a string to the AST that re-serializes to canonical form", () =>
		Effect.gen(function* () {
			const ast = yield* Schema.decodeUnknownEffect(SpdxExpression.FromString)("(MIT OR Apache-2.0)");
			assert.strictEqual(ast._tag, "Or");
			// the decoded AST is the same tree the sync parser produces
			assert.strictEqual(ast.toString(), "(MIT OR Apache-2.0)");
		}),
	);
	// A TRUE codec round-trip: encode must yield the canonical SPDX string (the
	// regression is encode returning "[object Object]"), and decode∘encode must
	// be identity across a leaf `+`, an OR compound, a WITH, and a nested case.
	for (const s of [
		"(MIT OR Apache-2.0)",
		"Apache-2.0+",
		"GPL-2.0-or-later WITH Bison-exception-2.2",
		"(MIT AND (Apache-2.0 OR BSD-3-Clause))",
	]) {
		it.effect(`FromString encode round-trips ${s}`, () =>
			Effect.gen(function* () {
				const ast = yield* Schema.decodeUnknownEffect(SpdxExpression.FromString)(s);
				const encoded = yield* Schema.encodeEffect(SpdxExpression.FromString)(ast);
				// encode emits the canonical string the input already is
				assert.strictEqual(encoded, s);
				// decode∘encode is identity: the string re-decodes and re-encodes to itself
				const reAst = yield* Schema.decodeUnknownEffect(SpdxExpression.FromString)(encoded);
				const reEncoded = yield* Schema.encodeEffect(SpdxExpression.FromString)(reAst);
				assert.strictEqual(reEncoded, encoded);
			}),
		);
	}
	it.effect("preserves the + marker", () =>
		Effect.gen(function* () {
			const expr = yield* SpdxExpression.parse("Apache-2.0+");
			assert.strictEqual(expr.toString(), "Apache-2.0+");
		}),
	);
	it.effect("does not overflow on deeply nested input", () =>
		Effect.gen(function* () {
			const deep = `${"(".repeat(5000)}MIT${")".repeat(5000)}`;
			const exit = yield* Effect.exit(SpdxExpression.parse(deep));
			// caps out as a typed failure, never a RangeError defect
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isFalse(Cause.hasDies(exit.cause));
				assert.isTrue(Cause.hasFails(exit.cause));
			}
		}),
	);
	it.effect("caps a long AND chain as a typed failure, not a defect", () =>
		Effect.gen(function* () {
			const chain = Array.from({ length: 6000 }, () => "MIT").join(" AND ");
			const exit = yield* Effect.exit(SpdxExpression.parse(chain));
			assert.isTrue(Exit.isFailure(exit));
			if (Exit.isFailure(exit)) {
				assert.isFalse(Cause.hasDies(exit.cause));
			}
		}),
	);
});
