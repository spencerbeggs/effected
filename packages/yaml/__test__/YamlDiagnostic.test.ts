import { assert, describe, it } from "@effect/vitest";
import type { SourceDiagnostic, YamlErrorCode } from "../src/index.js";
import { LineIndex, YamlDiagnostic } from "../src/index.js";

describe("YamlDiagnostic", () => {
	describe("fromRaw", () => {
		it("derives line/character from offset against the source text", () => {
			const text = "first: 1\nsecond: 2\nthird: 3";
			const d = YamlDiagnostic.fromRaw({ code: "UnexpectedToken", message: "boom", offset: 12, length: 3 }, text);
			assert.strictEqual(d.code, "UnexpectedToken");
			assert.strictEqual(d.message, "boom");
			assert.strictEqual(d.offset, 12);
			assert.strictEqual(d.length, 3);
			assert.strictEqual(d.line, 1);
			assert.strictEqual(d.character, 3);
		});

		it("counts CRLF as one line break and aligns characters after it", () => {
			const text = "a: 1\r\nb: 2";
			const d = YamlDiagnostic.fromRaw({ code: "MissingValue", message: "m", offset: 9, length: 1 }, text);
			assert.strictEqual(d.line, 1);
			assert.strictEqual(d.character, 3);
		});

		it("does not count LS/PS as line breaks (YAML 1.2, the lexer and LSP agree)", () => {
			// YAML 1.2 dropped U+2028/U+2029 from its line breaks, the lexer and
			// YamlToken never counted them, and neither does an LSP client: a
			// diagnostic and a token at the same offset must agree.
			for (const separator of ["\u2028", "\u2029"]) {
				const text = `a${separator}b: 2`;
				const d = YamlDiagnostic.fromRaw({ code: "MissingKey", message: "m", offset: 3, length: 1 }, text);
				assert.strictEqual(d.line, 0);
				assert.strictEqual(d.character, 3);
			}
		});

		it("counts a bare CR as a line break", () => {
			const d = YamlDiagnostic.fromRaw({ code: "MissingKey", message: "m", offset: 2, length: 1 }, "a\rb: 2");
			assert.strictEqual(d.line, 1);
			assert.strictEqual(d.character, 0);
		});

		it("reads an offset at the LF of a CRLF as the end of its line, never character -1", () => {
			// The hand-rolled loop advanced past the pair and then subtracted,
			// answering line 1, character -1.
			const d = YamlDiagnostic.fromRaw({ code: "MissingKey", message: "m", offset: 2, length: 0 }, "a\r\nb");
			assert.strictEqual(d.line, 0);
			assert.strictEqual(d.character, 1);
		});

		it("clamps offsets past the end of the text into it", () => {
			const d = YamlDiagnostic.fromRaw({ code: "UnexpectedToken", message: "m", offset: 99, length: 0 }, "ab");
			assert.strictEqual(d.offset, 99, "the record's own offset is kept");
			assert.strictEqual(d.line, 0);
			assert.strictEqual(d.character, 2);
		});

		it("accepts a prebuilt LineIndex and answers what the string form answers", () => {
			const text = "a: 1\r\nb: [\rc";
			const index = LineIndex.make(text);
			for (let offset = 0; offset <= text.length; offset++) {
				const raw = { code: "MissingKey", message: "m", offset, length: 0 } as const;
				const fromIndex = YamlDiagnostic.fromRaw(raw, index);
				const fromText = YamlDiagnostic.fromRaw(raw, text);
				assert.deepStrictEqual([fromIndex.line, fromIndex.character], [fromText.line, fromText.character]);
				assert.deepStrictEqual(index.positionAt(offset), { line: fromText.line, character: fromText.character });
			}
		});
	});

	describe("structural contract", () => {
		it("satisfies @effected/source's SourceDiagnostic", () => {
			// Type-level: a YamlDiagnostic is assignable to SourceDiagnostic with
			// its own code union. Remove a positional field from the class and
			// this stops compiling.
			const d: SourceDiagnostic<YamlErrorCode> = YamlDiagnostic.fromRaw(
				{ code: "MissingKey", message: "m", offset: 0, length: 0 },
				"a",
			);
			assert.strictEqual(d.code, "MissingKey");
		});
	});

	describe("isFatal — the single fatal-code predicate", () => {
		it("declares exactly the union of the v3 fatal lists fatal", () => {
			const fatal = [
				"UndefinedAlias",
				"DuplicateAnchor",
				"AliasCountExceeded",
				"UnexpectedToken",
				"InvalidDirective",
				"MalformedFlowCollection",
				"InvalidIndentation",
				"TabIndentation",
				"UnresolvedTag",
				// Hardening additions beyond the v3 lists:
				"UnexpectedCharacter",
				"NestingDepthExceeded",
			] as const;
			for (const code of fatal) {
				assert.isTrue(YamlDiagnostic.isFatal(code), `${code} should be fatal`);
			}
			const nonFatal = [
				"DuplicateKey",
				"MissingValue",
				"MissingKey",
				"InvalidBlockStructure",
				"CircularAlias",
				"InvalidTagValue",
				"UnterminatedString",
				"CircularReference",
				"UnrepresentableValue",
			] as const;
			for (const code of nonFatal) {
				assert.isFalse(YamlDiagnostic.isFatal(code), `${code} should not be fatal`);
			}
		});
	});

	describe("construction", () => {
		it("constructs via make with the parity five-field core plus message", () => {
			const d = YamlDiagnostic.make({
				code: "DuplicateKey",
				message: "Duplicate key: a",
				offset: 5,
				length: 1,
				line: 1,
				character: 0,
			});
			assert.strictEqual(d.code, "DuplicateKey");
			assert.strictEqual(d.line, 1);
			assert.strictEqual(d.character, 0);
		});
	});
});
