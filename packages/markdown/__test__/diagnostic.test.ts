import { assert, describe, it } from "@effect/vitest";
import type { MarkdownParseErrorCode, SourceDiagnostic } from "../src/index.js";
import { LineIndex, MarkdownDiagnostic } from "../src/index.js";
import {
	GuardExceeded,
	MARKDOWN_PARSE_ERROR_CODES,
	RawMarkdownError,
	isGuardExceeded,
	isRawMarkdownError,
} from "../src/internal/carriers.js";
import { MAX_NESTING_DEPTH } from "../src/internal/limits.js";

describe("MarkdownDiagnostic", () => {
	it("derives line and character from offset against LF source", () => {
		const d = MarkdownDiagnostic.fromRaw("aaaa\nbbbb\n", {
			code: "NestingDepthExceeded",
			message: "nesting depth exceeded",
			offset: 7,
			length: 1,
		});
		assert.strictEqual(d.line, 1);
		assert.strictEqual(d.character, 2);
	});

	it("derives line and character across CRLF newlines", () => {
		const d = MarkdownDiagnostic.fromRaw("aaaa\r\nbbbb\r\n", {
			code: "NestingDepthExceeded",
			message: "nesting depth exceeded",
			offset: 8,
			length: 1,
		});
		assert.strictEqual(d.line, 1);
		assert.strictEqual(d.character, 2);
	});

	it("clamps an offset at EOF to the final position", () => {
		const d = MarkdownDiagnostic.fromRaw("abc", {
			code: "NestingDepthExceeded",
			message: "m",
			offset: 3,
			length: 0,
		});
		assert.strictEqual(d.line, 0);
		assert.strictEqual(d.character, 3);
	});

	it("derives line and character when the offset lands on the newline itself", () => {
		const d = MarkdownDiagnostic.fromRaw("a\nb", { code: "NestingDepthExceeded", message: "m", offset: 1, length: 1 });
		assert.strictEqual(d.line, 0);
		assert.strictEqual(d.character, 1);
	});

	it("reads an offset at the LF of a CRLF as the end of its line, never character -1", () => {
		// The hand-rolled loop advanced past the pair and then subtracted,
		// answering line 1, character -1.
		const d = MarkdownDiagnostic.fromRaw("a\r\nb", {
			code: "NestingDepthExceeded",
			message: "m",
			offset: 2,
			length: 0,
		});
		assert.strictEqual(d.line, 0);
		assert.strictEqual(d.character, 1);
	});

	it("counts a bare CR as a line break and leaves U+2028 inside its line", () => {
		const cr = MarkdownDiagnostic.fromRaw("a\rb", { code: "NestingDepthExceeded", message: "m", offset: 2, length: 0 });
		assert.deepStrictEqual([cr.line, cr.character], [1, 0]);
		const ls = MarkdownDiagnostic.fromRaw("a\u2028b", {
			code: "NestingDepthExceeded",
			message: "m",
			offset: 2,
			length: 0,
		});
		assert.deepStrictEqual([ls.line, ls.character], [0, 2]);
	});

	it("accepts a prebuilt LineIndex and answers what the string form answers", () => {
		const text = "a\r\n\rb\nc";
		const index = LineIndex.make(text);
		for (let offset = 0; offset <= text.length; offset++) {
			const raw = { code: "NestingDepthExceeded", message: "m", offset, length: 0 } as const;
			const fromIndex = MarkdownDiagnostic.fromRaw(index, raw);
			const fromText = MarkdownDiagnostic.fromRaw(text, raw);
			assert.deepStrictEqual([fromIndex.line, fromIndex.character], [fromText.line, fromText.character]);
		}
	});

	it("satisfies @effected/source's SourceDiagnostic", () => {
		// Type-level: remove a positional field from the class and this stops
		// compiling.
		const d: SourceDiagnostic<MarkdownParseErrorCode> = MarkdownDiagnostic.fromRaw("a", {
			code: "NestingDepthExceeded",
			message: "m",
			offset: 0,
			length: 0,
		});
		assert.strictEqual(d.code, "NestingDepthExceeded");
	});

	it("constructs via make and compares structurally equal for identical fields", () => {
		const a = MarkdownDiagnostic.make({
			code: "NestingDepthExceeded",
			message: "m",
			offset: 0,
			length: 1,
			line: 0,
			character: 0,
		});
		const b = MarkdownDiagnostic.make({
			code: "NestingDepthExceeded",
			message: "m",
			offset: 0,
			length: 1,
			line: 0,
			character: 0,
		});
		assert.deepStrictEqual(a, b);
	});

	it("pins the P1 error code vocabulary", () => {
		assert.deepStrictEqual([...MARKDOWN_PARSE_ERROR_CODES], ["NestingDepthExceeded"]);
	});

	it("exposes the cross-package MAX_NESTING_DEPTH parity constant", () => {
		assert.strictEqual(MAX_NESTING_DEPTH, 256);
	});

	it("RawMarkdownError carries its diagnostic and is recognized by its predicate", () => {
		const e = new RawMarkdownError({ code: "NestingDepthExceeded", message: "m", offset: 0, length: 1 });
		assert.strictEqual(e.diagnostic.code, "NestingDepthExceeded");
		assert.isTrue(isRawMarkdownError(e));
		assert.isFalse(isRawMarkdownError(new Error("m")));
	});

	it("GuardExceeded carries its guard-trip fields and is recognized by its predicate", () => {
		const e = new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, 300, 42);
		assert.strictEqual(e.reason, "NestingDepthExceeded");
		assert.strictEqual(e.limit, MAX_NESTING_DEPTH);
		assert.strictEqual(e.actual, 300);
		assert.strictEqual(e.offset, 42);
		assert.isTrue(isGuardExceeded(e));
		assert.isFalse(isGuardExceeded(new Error("m")));
	});

	it("distinguishes RawMarkdownError from GuardExceeded via predicates", () => {
		const raw = new RawMarkdownError({ code: "NestingDepthExceeded", message: "m", offset: 0, length: 1 });
		const guard = new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, 300, 42);
		assert.isFalse(isRawMarkdownError(guard));
		assert.isFalse(isGuardExceeded(raw));
	});
});
