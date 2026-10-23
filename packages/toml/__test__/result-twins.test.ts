import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Result, Stream } from "effect";
import { Toml, TomlDocument, TomlFormat, TomlVisitor } from "../src/index.js";

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

const bomb = `a = ${"[".repeat(400)}${"]".repeat(400)}\n`;
const cyclic = (): Record<string, unknown> => {
	const self: Record<string, unknown> = { a: 1 };
	self.self = self;
	return self;
};

describe("TomlDocument Result twins", () => {
	const texts = [
		{ name: "valid", text: 'name = "Alice"\n[server]\nport = 1\n' },
		{ name: "lex error", text: 'a = "unterminated\n', code: "parse" },
		{ name: "nesting bomb", text: bomb, code: "NestingDepthExceeded" },
		{ name: "semantic DuplicateKey (data, not a failure)", text: "a = 1\na = 2\n" },
	];

	for (const row of texts) {
		it.effect(`parse agrees with parseResult: ${row.name}`, () =>
			Effect.gen(function* () {
				const result = TomlDocument.parseResult(row.text);
				if (row.code !== undefined) {
					if (!Result.isFailure(result)) return assert.fail(`expected a failure for ${row.name}`);
					if (row.code !== "parse") assert.strictEqual(result.failure.diagnostics[0]?.code, row.code);
				} else {
					assert.isTrue(Result.isSuccess(result));
				}
				yield* agrees(TomlDocument.parse(row.text), result);
			}),
		);
	}

	it.effect("a semantic DuplicateKey lands in diagnostics and fails only toValueResult", () =>
		Effect.gen(function* () {
			const parsed = TomlDocument.parseResult("a = 1\na = 2\n");
			if (!Result.isSuccess(parsed)) return assert.fail("a semantic violation must not fail the parse");
			const doc = parsed.success;
			assert.strictEqual(doc.diagnostics[0]?.code, "DuplicateKey");
			const value = doc.toValueResult();
			if (!Result.isFailure(value)) return assert.fail("toValueResult must refuse a document with diagnostics");
			assert.deepStrictEqual(value.failure.diagnostics, doc.diagnostics);
			yield* agrees(doc.toValue(), value);
		}),
	);

	it.effect("toValueResult succeeds on a clean document, matching toValue", () =>
		Effect.gen(function* () {
			const doc = yield* TomlDocument.parse('name = "Alice"\n[server]\nport = 1\n');
			const value = doc.toValueResult();
			assert.deepStrictEqual(value, Result.succeed({ name: "Alice", server: { port: 1 } }));
			yield* agrees(doc.toValue(), value);
		}),
	);
});

describe("TomlFormat Result twins", () => {
	const deepPath = Array.from({ length: 300 }, (_, i) => `k${i}`);
	const rows: ReadonlyArray<{
		name: string;
		text: string;
		path: ReadonlyArray<string | number>;
		value: unknown;
		tag?: string;
		code?: string;
	}> = [
		{ name: "replace", text: "port = 3000 # dev\n", path: ["port"], value: 8080 },
		{ name: "delete", text: "a = 1\nb = 2\n", path: ["a"], value: undefined },
		{ name: "insert into a section", text: "[server]\nport = 1\n", path: ["server", "host"], value: "x" },
		{ name: "unparseable source", text: 'a = "unterminated\n', path: ["a"], value: 1, tag: "TomlParseError" },
		{ name: "empty path", text: "a = 1\n", path: [], value: 1, tag: "TomlModificationError" },
		{
			name: "path over the depth cap",
			text: "a = 1\n",
			path: deepPath,
			value: 1,
			tag: "TomlModificationError",
			code: "NestingDepthExceeded",
		},
		{
			name: "function value",
			text: "a = 1\n",
			path: ["b"],
			value: () => 1,
			tag: "TomlModificationError",
			code: "UnsupportedValue",
		},
		{
			name: "symbol value",
			text: "a = 1\n",
			path: ["b"],
			value: Symbol("s"),
			tag: "TomlModificationError",
			code: "UnsupportedValue",
		},
		{
			name: "circular value",
			text: "a = 1\n",
			path: ["b"],
			value: cyclic(),
			tag: "TomlModificationError",
			code: "CircularReference",
		},
	];

	for (const row of rows) {
		it.effect(`modify agrees with modifyResult: ${row.name}`, () =>
			Effect.gen(function* () {
				const result = TomlFormat.modifyResult(row.text, row.path, row.value);
				if (row.tag !== undefined) {
					if (!Result.isFailure(result)) return assert.fail(`expected ${row.tag}`);
					assert.strictEqual(result.failure._tag, row.tag);
					if (row.code !== undefined && result.failure._tag === "TomlModificationError") {
						assert.strictEqual(result.failure.diagnostic.code, row.code);
					}
				} else {
					assert.isTrue(Result.isSuccess(result));
				}
				yield* agrees(TomlFormat.modify(row.text, row.path, row.value), result);
			}),
		);

		it.effect(`modifyToString agrees with modifyToStringResult: ${row.name}`, () =>
			agrees(
				TomlFormat.modifyToString(row.text, row.path, row.value),
				TomlFormat.modifyToStringResult(row.text, row.path, row.value),
			),
		);
	}

	it("modifyToStringResult applies the edits of modifyResult", () => {
		assert.deepStrictEqual(
			TomlFormat.modifyToStringResult("port = 3000 # dev\n", ["port"], 8080),
			Result.succeed("port = 8080 # dev\n"),
		);
	});
});

describe("TomlVisitor shares the parse error mapping", () => {
	// visit, Toml.parseResult and TomlDocument.parseResult all route engine
	// throws through one mapping, so the same input must fail identically.
	const inputs = [
		{ name: "lex error", text: 'a = "unterminated\n' },
		{ name: "semantic DuplicateKey", text: "a = 1\na = 2\n" },
		{ name: "nesting bomb", text: bomb },
	];

	for (const input of inputs) {
		it.effect(`visit fails exactly as Toml.parseResult does: ${input.name}`, () =>
			Effect.gen(function* () {
				const expected = Toml.parseResult(input.text);
				if (!Result.isFailure(expected)) return assert.fail("the input must fail to parse");
				const error = yield* Effect.flip(Stream.runDrain(TomlVisitor.visit(input.text)));
				assert.deepStrictEqual(error, expected.failure);
			}),
		);
	}
});

describe("Effect forms defer their work until run", () => {
	// The Effect forms bridge a Result twin, and a Result is evaluated the moment
	// it is built — so each form must suspend, or a genuine engine defect throws
	// out of the method call instead of dying inside the Effect or Stream.
	const diesWithoutFailing = <A, E>(exit: Exit.Exit<A, E>) => {
		if (!Exit.isFailure(exit)) return assert.fail("expected a defect, but the effect succeeded");
		assert.isTrue(Cause.hasDies(exit.cause));
		assert.isFalse(Cause.hasFails(exit.cause));
	};

	it.effect("TomlDocument#toValue on a forged instance returns an Effect that dies", () =>
		Effect.gen(function* () {
			const doc = yield* TomlDocument.parse("a = 1\n");
			// Instances are not frozen: a forged expression list is a defect the
			// engine cannot map, so it must die, not throw at call time.
			(doc as unknown as { expressions: unknown }).expressions = [{ bogus: true }];
			let effect: Effect.Effect<unknown, unknown>;
			try {
				effect = doc.toValue();
			} catch (defect) {
				return assert.fail(`toValue() threw at call time: ${String(defect)}`);
			}
			diesWithoutFailing(yield* Effect.exit(effect));
		}),
	);

	it.effect("TomlVisitor.visit builds the stream without parsing", () =>
		Effect.gen(function* () {
			const forged = null as unknown as string;
			let stream: Stream.Stream<unknown, unknown>;
			try {
				stream = TomlVisitor.visit(forged);
			} catch (defect) {
				return assert.fail(`visit() threw at construction: ${String(defect)}`);
			}
			diesWithoutFailing(yield* Effect.exit(Stream.runDrain(stream)));
		}),
	);
});
