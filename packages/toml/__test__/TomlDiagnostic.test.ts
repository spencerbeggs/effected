import { assert, describe, it } from "@effect/vitest";
import type { SourceDiagnostic, SourceLocation } from "@effected/source";
import {
	RawTomlError,
	TOML_LEX_ERROR_CODES,
	TOML_PARSE_ERROR_CODES,
	TOML_SEMANTIC_ERROR_CODES,
	TOML_STRINGIFY_ERROR_CODES,
} from "../src/internal/diagnostics.js";
import type { TomlErrorCode } from "../src/TomlDiagnostic.js";
import { TomlDiagnostic } from "../src/TomlDiagnostic.js";

describe("TomlDiagnostic", () => {
	it("derives line and character from offset against LF source", () => {
		const d = TomlDiagnostic.fromRaw("a = 1\nb = ?\n", {
			code: "ExpectedValue",
			message: "expected a value",
			offset: 10,
			length: 1,
		});
		assert.strictEqual(d.line, 1);
		assert.strictEqual(d.character, 4);
	});
	it("derives line and character across CRLF newlines", () => {
		const d = TomlDiagnostic.fromRaw("a = 1\r\nb = ?\r\n", {
			code: "ExpectedValue",
			message: "expected a value",
			offset: 11,
			length: 1,
		});
		assert.strictEqual(d.line, 1);
		assert.strictEqual(d.character, 4);
	});
	it("clamps an offset at EOF to the final position", () => {
		const d = TomlDiagnostic.fromRaw("a = ", { code: "ExpectedValue", message: "m", offset: 4, length: 0 });
		assert.strictEqual(d.line, 0);
		assert.strictEqual(d.character, 4);
	});
	it("derives line and character when the offset lands on the newline itself", () => {
		const d = TomlDiagnostic.fromRaw("a\nb", { code: "ExpectedValue", message: "m", offset: 1, length: 1 });
		assert.strictEqual(d.line, 0);
		assert.strictEqual(d.character, 1);
	});
	it("reads an offset at the \\n of a \\r\\n as the end of its line, never character -1", () => {
		// The hand-rolled loop this replaced answered { line: 1, character: -1 }.
		const d = TomlDiagnostic.fromRaw("a\r\nb", { code: "ExpectedValue", message: "m", offset: 2, length: 0 });
		assert.strictEqual(d.line, 0);
		assert.strictEqual(d.character, 1);
	});
	it("treats a bare \\r as a line break and U+2028 as ordinary text (the LSP rule)", () => {
		const cr = TomlDiagnostic.fromRaw("a\rb", { code: "ExpectedValue", message: "m", offset: 2, length: 0 });
		assert.deepStrictEqual([cr.line, cr.character], [1, 0]);
		const ls = TomlDiagnostic.fromRaw(`a${String.fromCodePoint(0x2028)}b`, {
			code: "ExpectedValue",
			message: "m",
			offset: 2,
			length: 0,
		});
		assert.deepStrictEqual([ls.line, ls.character], [0, 2]);
	});
	it("satisfies @effected/source's SourceDiagnostic and SourceLocation structurally", () => {
		const d = TomlDiagnostic.fromRaw("a = ", { code: "ExpectedValue", message: "m", offset: 4, length: 0 });
		const diagnostic: SourceDiagnostic<TomlErrorCode> = d;
		const location: SourceLocation = d;
		// @ts-expect-error -- the code union is closed: a foreign code is not a TomlErrorCode.
		const foreign: SourceDiagnostic<"NotATomlCode"> = d;
		assert.strictEqual(diagnostic.code, "ExpectedValue");
		assert.strictEqual(location.character, 4);
		assert.isDefined(foreign);
	});
	it("pins the stage code array overlap contract", () => {
		const stageArrays = [
			TOML_LEX_ERROR_CODES,
			TOML_PARSE_ERROR_CODES,
			TOML_SEMANTIC_ERROR_CODES,
			TOML_STRINGIFY_ERROR_CODES,
		];
		for (const codes of stageArrays) {
			assert.strictEqual(new Set(codes).size, codes.length);
		}

		const lex = new Set(TOML_LEX_ERROR_CODES);
		const parse = new Set(TOML_PARSE_ERROR_CODES);
		const semantic = new Set(TOML_SEMANTIC_ERROR_CODES);
		const stringify = new Set(TOML_STRINGIFY_ERROR_CODES);
		const intersect = (a: ReadonlySet<string>, b: ReadonlySet<string>) => [...a].filter((code) => b.has(code)).sort();

		// The lex and semantic stages share no codes with any other stage.
		assert.deepStrictEqual(intersect(lex, parse), []);
		assert.deepStrictEqual(intersect(lex, semantic), []);
		assert.deepStrictEqual(intersect(lex, stringify), []);
		assert.deepStrictEqual(intersect(semantic, parse), []);
		assert.deepStrictEqual(intersect(semantic, stringify), []);
		// Parse and stringify intentionally share these two codes (same concept,
		// two stages); pin the overlap so a future addition must be a decision.
		assert.deepStrictEqual(intersect(parse, stringify), ["IntegerOutOfRange", "NestingDepthExceeded"]);
	});
	it("RawTomlError carries its diagnostic", () => {
		const e = new RawTomlError({ code: "DuplicateKey", message: "m", offset: 0, length: 1 });
		assert.strictEqual(e.diagnostic.code, "DuplicateKey");
	});
});
