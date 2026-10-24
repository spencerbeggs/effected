import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Result } from "effect";
import {
	Yaml,
	YamlDocument,
	YamlFormat,
	YamlMap,
	YamlModificationError,
	YamlPair,
	YamlScalar,
	YamlSeq,
} from "../src/index.js";

// Every Result twin must agree with its Effect form on BOTH channels: the
// Effect form is defined in terms of the twin, so a divergence means a second
// derivation path crept back in.
const agrees = <A, E>(effect: Effect.Effect<A, E>, result: Result.Result<A, E>) =>
	Effect.gen(function* () {
		const exit = yield* Effect.exit(effect);
		if (Result.isSuccess(result)) {
			if (!Exit.isSuccess(exit)) return assert.fail("the Effect form failed where the Result form succeeded");
			assert.deepStrictEqual(exit.value, result.success);
		} else {
			if (!Exit.isFailure(exit)) return assert.fail("the Effect form succeeded where the Result form failed");
			const error = yield* Effect.flip(effect);
			assert.deepStrictEqual(error, result.failure);
		}
	});

const cyclic = (): Record<string, unknown> => {
	const self: Record<string, unknown> = { a: 1 };
	self.self = self;
	return self;
};

/** `levels` nested arrays around a scalar leaf: the leaf sits `levels` below the value's own node. */
const nested = (levels: number): unknown => {
	let value: unknown = 1;
	for (let i = 0; i < levels; i++) value = [value];
	return value;
};

describe("YamlFormat Result twins", () => {
	const rows: ReadonlyArray<{
		name: string;
		text: string;
		path: ReadonlyArray<string | number>;
		value: unknown;
		code?: string;
	}> = [
		{ name: "regional scalar splice", text: "port: 3000 # dev\n", path: ["port"], value: 8080 },
		{ name: "whole-document fallback", text: "a: 1\n", path: ["m"], value: { x: [1, 2] } },
		{ name: "delete", text: "a: 1\nb: 2\n", path: ["a"], value: undefined },
		{ name: "nested null", text: "a: 1\n", path: ["a"], value: { b: null } },
		{ name: "sequence of undefined and null", text: "a: 1\n", path: ["a"], value: [undefined, null] },
		{ name: "multi-document stream", text: "a: 1\n---\nb: 2\n", path: ["a"], value: 2, code: "MultiDocumentStream" },
		{ name: "fatal parse", text: "a: [1, 2\n", path: ["a"], value: 2 },
		{
			name: "directive-carrying document",
			text: "%YAML 1.2\n---\na: 1\n",
			path: ["a"],
			value: { b: 1 },
			code: "DirectiveCarryingDocument",
		},
		{ name: "path not found", text: "a: 1\n", path: ["x", "y"], value: 2, code: "PathNotFound" },
		{ name: "circular value", text: "a: 1\n", path: ["m"], value: cyclic(), code: "CircularReference" },
		{ name: "value past the cap", text: "a: 1\n", path: ["m"], value: nested(300), code: "NestingDepthExceeded" },
	];

	for (const row of rows) {
		it.effect(`modify agrees with modifyResult: ${row.name}`, () =>
			Effect.gen(function* () {
				const result = YamlFormat.modifyResult(row.text, row.path, row.value);
				if (row.code !== undefined) {
					if (!Result.isFailure(result)) return assert.fail(`expected ${row.code}`);
					assert.strictEqual(result.failure.diagnostics[0]?.code, row.code);
				}
				yield* agrees(YamlFormat.modify(row.text, row.path, row.value), result);
			}),
		);

		it.effect(`modifyToString agrees with modifyToStringResult: ${row.name}`, () =>
			agrees(
				YamlFormat.modifyToString(row.text, row.path, row.value),
				YamlFormat.modifyToStringResult(row.text, row.path, row.value),
			),
		);
	}

	it("modifyToStringResult applies the edits of modifyResult", () => {
		const text = "port: 3000 # dev\n";
		const result = YamlFormat.modifyToStringResult(text, ["port"], 8080);
		assert.deepStrictEqual(result, Result.succeed("port: 8080 # dev\n"));
	});
});

describe("YamlFormat.modify depth is counted from the document root", () => {
	// The stringifier counts one level per node from the document root, so a
	// value's budget shrinks with its path. Lowering used to start at zero
	// whatever the path, so a value that fit at [] died with an untyped
	// StringifyDepthExceeded defect one key down.
	const cases = [
		{ name: "at the root", text: "a: 1\n", path: [] as ReadonlyArray<string>, fits: 256 },
		{ name: "one key down", text: "a: 1\n", path: ["a"], fits: 255 },
		{ name: "three keys down", text: "a:\n  b:\n    c: 1\n", path: ["a", "b", "c"], fits: 253 },
	];

	for (const c of cases) {
		it(`${c.name}: the largest value that fits succeeds`, () => {
			const result = YamlFormat.modifyToStringResult(c.text, c.path, nested(c.fits));
			assert.isTrue(Result.isSuccess(result));
		});

		it(`${c.name}: one level more fails typed with the lowering diagnostic`, () => {
			const result = YamlFormat.modifyResult(c.text, c.path, nested(c.fits + 1));
			if (!Result.isFailure(result)) return assert.fail("expected NestingDepthExceeded");
			assert.instanceOf(result.failure, YamlModificationError);
			assert.strictEqual(result.failure.diagnostics[0]?.code, "NestingDepthExceeded");
			assert.include(result.failure.diagnostics[0]?.message ?? "", "Replacement value");
		});

		it.effect(`${c.name}: no depth near the cap escapes as a defect`, () =>
			Effect.gen(function* () {
				for (let levels = c.fits - 4; levels <= c.fits + 4; levels++) {
					const exit = yield* Effect.exit(YamlFormat.modifyToString(c.text, c.path, nested(levels)));
					if (Exit.isFailure(exit)) {
						const error = yield* Effect.flip(YamlFormat.modifyToString(c.text, c.path, nested(levels)));
						assert.strictEqual(error._tag, "YamlModificationError", `levels=${levels}`);
					}
				}
			}),
		);
	}
});

describe("YamlDocument Result twins", () => {
	const texts = [
		"# header\nname: Alice\n",
		"a: [1, 2\n",
		"a: 1\na: 2\n",
		"%YAML 1.2\n%YAML 1.2\n---\na: 1\n",
		"a: 1\n---\nb: 2\n",
		"",
	];

	for (const text of texts) {
		it.effect(`parse agrees with parseResult: ${JSON.stringify(text)}`, () =>
			agrees(YamlDocument.parse(text), YamlDocument.parseResult(text)),
		);

		it.effect(`parseAll agrees with parseAllResult: ${JSON.stringify(text)}`, () =>
			agrees(YamlDocument.parseAll(text), YamlDocument.parseAllResult(text)),
		);
	}

	it("parseAllResult fails on a stream-level InvalidDirective", () => {
		const result = YamlDocument.parseAllResult("a: 1\n%YAML 1.2\n---\nb: 2\n");
		if (!Result.isFailure(result)) return assert.fail("expected a stream-level failure");
		assert.isTrue(result.failure.diagnostics.some((d) => d.code === "InvalidDirective"));
	});

	it("parseResult fails on a fatal diagnostic and keeps non-fatal ones as data", () => {
		assert.isTrue(Result.isFailure(YamlDocument.parseResult("a: [1, 2\n")));
		const ok = YamlDocument.parseResult("a: 1\na: 2\n");
		if (!Result.isSuccess(ok)) return assert.fail("a duplicate key is not fatal at the document level");
		assert.isTrue(ok.success.warnings.some((w) => w.code === "DuplicateKey"));
	});

	it.effect("stringifyResult agrees with stringify on a parsed document", () =>
		Effect.gen(function* () {
			const doc = yield* YamlDocument.parse("# keep\nname: Alice\n");
			yield* agrees(doc.stringify(), doc.stringifyResult());
			assert.deepStrictEqual(doc.stringifyResult(), Result.succeed("# keep\nname: Alice\n"));
		}),
	);

	it.effect("stringifyResult fails NestingDepthExceeded on an over-deep synthetic AST, matching stringify", () =>
		Effect.gen(function* () {
			let contents: YamlSeq | YamlScalar = YamlScalar.make({ value: 1, style: "plain", offset: 0, length: 0 });
			for (let i = 0; i < 300; i++)
				contents = YamlSeq.make({ items: [contents], style: "block", offset: 0, length: 0 });
			const doc = YamlDocument.make({ contents, errors: [], warnings: [], directives: [] });
			const result = doc.stringifyResult();
			if (!Result.isFailure(result)) return assert.fail("expected NestingDepthExceeded");
			assert.strictEqual(result.failure.diagnostics[0]?.code, "NestingDepthExceeded");
			yield* agrees(doc.stringify(), result);
		}),
	);

	it.effect("stringifyResult fails CircularReference on a cyclic synthetic AST, matching stringify", () =>
		Effect.gen(function* () {
			const items: Array<YamlSeq | YamlScalar> = [];
			const seq = YamlSeq.make({ items, style: "block", offset: 0, length: 0 });
			// Close the cycle after construction: the class instances are not frozen.
			(seq.items as Array<unknown>).push(seq);
			const doc = YamlDocument.make({ contents: seq, errors: [], warnings: [], directives: [] });
			const result = doc.stringifyResult();
			// The node path keeps the value path's ancestor set, so the cycle is
			// named as such on the first re-entry — not left for the depth cap.
			if (!Result.isFailure(result)) return assert.fail("expected a typed failure");
			assert.strictEqual(result.failure._tag, "YamlStringifyError");
			assert.strictEqual(result.failure.diagnostics[0]?.code, "CircularReference");
			yield* agrees(doc.stringify(), result);
		}),
	);

	it.effect("a cycle through a mapping value is CircularReference too, and a shared acyclic subtree is not", () =>
		Effect.gen(function* () {
			const pairs: Array<YamlPair> = [];
			const map = YamlMap.make({ items: pairs, style: "block", offset: 0, length: 0 });
			const key = YamlScalar.make({ value: "self", style: "plain", offset: 0, length: 0 });
			(map.items as Array<unknown>).push(YamlPair.make({ key, value: map }));
			const cyclic = YamlDocument.make({ contents: map, errors: [], warnings: [], directives: [] });
			const result = cyclic.stringifyResult();
			if (!Result.isFailure(result)) return assert.fail("expected CircularReference");
			assert.strictEqual(result.failure.diagnostics[0]?.code, "CircularReference");
			yield* agrees(cyclic.stringify(), result);

			// The same leaf collection under two keys is sharing, not a cycle.
			const leaf = YamlSeq.make({
				items: [YamlScalar.make({ value: 1, style: "plain", offset: 0, length: 0 })],
				style: "block",
				offset: 0,
				length: 0,
			});
			const shared = YamlMap.make({
				items: ["a", "b"].map((k) =>
					YamlPair.make({ key: YamlScalar.make({ value: k, style: "plain", offset: 0, length: 0 }), value: leaf }),
				),
				style: "block",
				offset: 0,
				length: 0,
			});
			const doc = YamlDocument.make({ contents: shared, errors: [], warnings: [], directives: [] });
			assert.deepStrictEqual(doc.stringifyResult(), Result.succeed("a:\n- 1\nb:\n- 1\n"));
		}),
	);
});

describe("Yaml.stringify after the stringifyOrFail removal", () => {
	it.effect("fails exactly as stringifyResult does on a circular value", () =>
		Effect.gen(function* () {
			const value = cyclic();
			const result = Yaml.stringifyResult(value);
			if (!Result.isFailure(result)) return assert.fail("expected CircularReference");
			assert.strictEqual(result.failure.diagnostics[0]?.code, "CircularReference");
			yield* agrees(Yaml.stringify(value), result);
		}),
	);
});

describe("YamlDocument#stringify defers its work until run", () => {
	it.effect("a forged instance returns an Effect that dies inside the span, not a call-time throw", () =>
		Effect.gen(function* () {
			const seq = YamlSeq.make({ items: [], style: "block", offset: 0, length: 0 });
			// Instances are not frozen: a forged non-iterable item list is a
			// defect the facade cannot map to a YamlStringifyError, so it must
			// die when run.
			(seq as unknown as { items: unknown }).items = 42;
			const doc = YamlDocument.make({ contents: seq, errors: [], warnings: [], directives: [] });
			let effect: Effect.Effect<string, unknown>;
			try {
				effect = doc.stringify();
			} catch (defect) {
				return assert.fail(`stringify() threw at call time: ${String(defect)}`);
			}
			const exit = yield* Effect.exit(effect);
			if (!Exit.isFailure(exit)) return assert.fail("expected a defect, but the effect succeeded");
			assert.isTrue(Cause.hasDies(exit.cause));
			assert.isFalse(Cause.hasFails(exit.cause));
		}),
	);
});
