// YamlToken / YamlTokens (#129): the public positioned token stream — the
// sync Result primitive, the derived Stream form, the field reconciliation
// (internal value/column → public text/character), and the total-tokenizer
// contract (error-kind tokens in the success array, never a failure).

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema, Stream } from "effect";
import type { SourceLocation } from "../src/index.js";
import { YamlDiagnostic, YamlToken, YamlTokens } from "../src/index.js";

const tokensOf = (text: string): ReadonlyArray<YamlToken> => {
	const result = YamlTokens.tokenize(text);
	assert.isTrue(Result.isSuccess(result));
	return Result.isSuccess(result) ? result.success : [];
};

describe("YamlTokens", () => {
	describe("tokenize (sync Result primitive)", () => {
		it("produces positioned tokens with the public field vocabulary", () => {
			const tokens = tokensOf("a: 1 # note\n");
			assert.isAbove(tokens.length, 0);
			for (const token of tokens) {
				assert.instanceOf(token, YamlToken);
				// The reconciled spelling: text/character, never value/column.
				assert.isString(token.text);
				assert.isNumber(token.character);
				assert.notProperty(token, "value");
				assert.notProperty(token, "column");
				assert.strictEqual("a: 1 # note\n".slice(token.offset, token.offset + token.length), token.text);
			}
		});

		it("covers the source: ordered spans, whitespace-only gaps, byte-faithful slices", () => {
			const source = "name: deploy\non:\n  push: # only main\n    branches:\n      - main\n";
			let cursor = 0;
			for (const token of tokensOf(source)) {
				assert.isAtLeast(token.offset, cursor, "tokens must not overlap");
				assert.match(source.slice(cursor, token.offset), /^[ \t\r]*$/, "gaps must be whitespace-only");
				cursor = token.offset + token.length;
			}
			assert.strictEqual(cursor, source.length);
		});

		it("reports line/character zero-based, matching the diagnostic vocabulary", () => {
			const tokens = tokensOf("a: 1\nb: 2\n");
			const b = tokens.find((t) => t.text === "b");
			assert.isDefined(b);
			assert.strictEqual(b?.line, 1);
			assert.strictEqual(b?.character, 0);
		});

		it("breaks lines where the composer does: a bare CR is line content", () => {
			// Lint fixes are computed from token positions, and the composer does
			// not break at a bare `\r`. Counting one as a break put "line ends"
			// inside scalars, so `YamlLint.fix("a: 1\r")` appended `...` to `1`.
			const tokens = tokensOf("a: 1\rb: 2\r");
			const b = tokens.find((t) => t.text === "b");
			assert.deepStrictEqual([b?.line, b?.character], [0, 5]);
			const crlf = tokensOf("a: 1\r\nb: 2\r\n").find((t) => t.text === "b");
			assert.deepStrictEqual([crlf?.line, crlf?.character], [1, 0]);
		});

		it("keeps the CR of a CRLF on its own line and agrees with YamlDiagnostic", () => {
			const text = "a: 1\r\nb: 2\u2028c\n";
			for (const token of tokensOf(text)) {
				const d = YamlDiagnostic.fromRaw({ code: "MissingKey", message: "m", offset: token.offset, length: 0 }, text);
				assert.deepStrictEqual([token.line, token.character], [d.line, d.character], `token at ${token.offset}`);
			}
			const b = tokensOf(text).find((t) => t.text === "b");
			assert.deepStrictEqual([b?.line, b?.character], [1, 0]);
		});

		it("satisfies @effected/source's SourceLocation", () => {
			// Type-level: remove a positional field from YamlToken and this stops
			// compiling.
			const locations: ReadonlyArray<SourceLocation> = tokensOf("a: 1\n");
			assert.isAbove(locations.length, 0);
		});

		it("tokenizes comments as comment-kind tokens carrying the raw # slice", () => {
			const comment = tokensOf("a: 1 # note\n").find((t) => t.kind === "comment");
			assert.isDefined(comment);
			assert.strictEqual(comment?.text, "# note");
		});

		it("is TOTAL: malformed input succeeds with error-kind tokens, never a failure", () => {
			// The reserved failure channel must not fire — linting has to run on
			// documents that do not parse (parse-validity exists for exactly that).
			const result = YamlTokens.tokenize("a: [unclosed\n\tb:\t:");
			assert.isTrue(Result.isSuccess(result));
		});

		it("tokenizes the empty string to an empty array", () => {
			assert.deepStrictEqual(tokensOf(""), []);
		});
	});

	describe("stream (derived form)", () => {
		it.effect("yields exactly the primitive's tokens in order", () =>
			Effect.gen(function* () {
				const source = "steps:\n  - build\n  - test\n";
				const streamed = yield* Stream.runCollect(YamlTokens.stream(source));
				assert.deepStrictEqual([...streamed], [...tokensOf(source)]);
			}),
		);

		it.effect("supports partial consumption via Stream.take", () =>
			Effect.gen(function* () {
				const first = yield* Stream.runCollect(Stream.take(YamlTokens.stream("a: 1\nb: 2\n"), 2));
				assert.strictEqual([...first].length, 2);
			}),
		);
	});

	describe("YamlToken schema", () => {
		it("decodes and re-encodes through the class codec", () => {
			const token = YamlToken.make({ kind: "scalar", text: "a", offset: 0, length: 1, line: 0, character: 0 });
			const encoded = Schema.encodeSync(YamlToken)(token);
			const decoded = Schema.decodeSync(YamlToken)(encoded);
			assert.deepStrictEqual(decoded, token);
		});
	});
});
