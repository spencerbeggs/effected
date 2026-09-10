// Region-confined scalar replacement for YamlFormat.modify (#659):
// a scalar write into an existing single-line scalar target splices ONLY the
// target's byte range — quote style preserved, CRLFs and every other byte
// outside the span untouched — and anything outside the fast path's
// preconditions keeps the whole-document pipeline's existing behavior.

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { YamlFormat, YamlModificationError } from "../src/YamlFormat.js";

const modify = (
	text: string,
	path: ReadonlyArray<string | number>,
	value: unknown,
	options?: Parameters<typeof YamlFormat.modify>[3],
) => Effect.runSync(YamlFormat.modify(text, path, value, options));
const modifyToString = (
	text: string,
	path: ReadonlyArray<string | number>,
	value: unknown,
	options?: Parameters<typeof YamlFormat.modifyToString>[3],
) => Effect.runSync(YamlFormat.modifyToString(text, path, value, options));

describe("YamlFormat.modify region-confined scalar replacement (#659)", () => {
	it("preserves single quotes and CRLF line endings — the issue repro", () => {
		const text = "generated:\r\n  by: x\r\n  at: '2020-01-01T00:00:00Z'\r\n";
		const out = modifyToString(text, ["generated", "at"], "2026-01-01T00:00:00Z");
		expect(out).toBe("generated:\r\n  by: x\r\n  at: '2026-01-01T00:00:00Z'\r\n");
	});

	it("emits exactly one edit confined to the scalar span", () => {
		const text = "generated:\n  by: x\n  at: '2020-01-01T00:00:00Z'\n";
		const edits = modify(text, ["generated", "at"], "2026-01-01T00:00:00Z");
		expect(edits).toHaveLength(1);
		const edit = edits[0] as { offset: number; length: number; content: string };
		expect(text.slice(edit.offset, edit.offset + edit.length)).toBe("'2020-01-01T00:00:00Z'");
		expect(edit.content).toBe("'2026-01-01T00:00:00Z'");
	});

	it("preserves double-quote style", () => {
		const text = 'a: 1\nb: "two"\n';
		const out = modifyToString(text, ["b"], "three");
		expect(out).toBe('a: 1\nb: "three"\n');
	});

	it("preserves plain style", () => {
		const text = "a: hello\nb: 2\n";
		const edits = modify(text, ["a"], "world");
		expect(edits).toHaveLength(1);
		expect(modifyToString(text, ["a"], "world")).toBe("a: world\nb: 2\n");
	});

	it("quotes a plain-target value that cannot stay plain, regionally", () => {
		const text = "flag: value\nother: 1\n";
		const out = modifyToString(text, ["flag"], "123");
		// "123" must not re-parse as a number: the stringifier quotes it.
		expect(out).toMatch(/^flag: (['"])123\1\nother: 1\n$/);
		const edits = modify(text, ["flag"], "123");
		expect(edits).toHaveLength(1);
		const edit = edits[0] as { offset: number; length: number };
		expect(edit.offset + edit.length).toBeLessThanOrEqual(text.indexOf("\nother"));
	});

	it("renders a non-string into a quoted target plain (type-correct), still regional", () => {
		const text = "count: '5'\nkeep: x\n";
		const out = modifyToString(text, ["count"], 7);
		expect(out).toBe("count: 7\nkeep: x\n");
		expect(modify(text, ["count"], 7)).toHaveLength(1);
	});

	it("handles booleans into quoted targets without quoting them; null keeps the pipeline", () => {
		expect(modifyToString('a: "x"\n', ["a"], true)).toBe("a: true\n");
		// null renders as an empty scalar in the whole-document pipeline
		// (`a:`), and the fast path deliberately defers to that convention.
		expect(modifyToString("a: 'x'\n", ["a"], null)).toBe("a:\n");
	});

	it("preserves a same-line trailing comment (it lives outside the span)", () => {
		const text = "a: 'v' # note\nb: 2\n";
		const out = modifyToString(text, ["a"], "w");
		expect(out).toBe("a: 'w' # note\nb: 2\n");
	});

	it("leaves LF bytes outside the span untouched, including EOF newline", () => {
		const text = "# header\n\nlist:\n  - 'one'\n  - two\n\n# footer\n";
		const out = modifyToString(text, ["list", 0], "uno");
		expect(out).toBe("# header\n\nlist:\n  - 'uno'\n  - two\n\n# footer\n");
	});

	it("returns no edits for a no-op replacement", () => {
		const text = "a: 'same'\r\n";
		expect(modify(text, ["a"], "same")).toHaveLength(0);
		expect(modifyToString(text, ["a"], "same")).toBe(text);
	});

	it("escapes an embedded single quote in single-quoted style", () => {
		const text = "a: 'plain'\n";
		expect(modifyToString(text, ["a"], "it's")).toBe("a: 'it''s'\n");
	});

	it("escapes newlines in double-quoted style without touching the rest", () => {
		const text = 'a: "x"\r\nb: 1\r\n';
		expect(modifyToString(text, ["a"], "line1\nline2")).toBe('a: "line1\\nline2"\r\nb: 1\r\n');
	});

	it("falls back to the full pipeline when a single-quoted target gets an unquotable value", () => {
		// A tab cannot live in single-quoted style; the whole-document
		// pipeline picks a style that can express it (double-quoted).
		const text = "a: 'x'\nb: 1\n";
		const out = modifyToString(text, ["a"], "has\ttab");
		expect(out).toContain("has\\ttab");
		expect(modify(text, ["a"], "has\ttab").length).toBeGreaterThanOrEqual(1);
	});

	it("falls back for object values (synthesized subtree, existing behavior)", () => {
		const text = "a: 'x'\nb: 1\n";
		const out = modifyToString(text, ["a"], { nested: true });
		expect(out).toContain("nested: true");
		expect(modify(text, ["a"], { nested: true }).length).toBeGreaterThanOrEqual(1);
	});

	it("falls back for removals and insertions (existing behavior)", () => {
		const text = "a: 'x'\nb: 1\n";
		expect(modifyToString(text, ["a"], undefined)).toBe("b: 1\n");
		expect(modifyToString(text, ["c"], "new")).toBe("a: 'x'\nb: 1\nc: new\n");
	});

	it("falls back for block scalar targets", () => {
		const text = "a: |\n  line1\n  line2\nb: 1\n";
		const out = modifyToString(text, ["a"], "replaced");
		expect(out).toContain("replaced");
		expect(out).toContain("b: 1");
	});

	it("falls back for tagged and anchored targets", () => {
		const tagged = "a: !str 'x'\nb: 1\n";
		expect(modifyToString(tagged, ["a"], "y")).toContain("y");
		const anchored = "a: &an 'x'\nb: 1\n";
		expect(modifyToString(anchored, ["a"], "y")).toContain("y");
	});

	it("falls back for a multi-line quoted span", () => {
		const text = "a: 'one\n  two'\nb: 1\n";
		const out = modifyToString(text, ["a"], "joined");
		expect(out).toContain("joined");
		expect(out).toContain("b: 1");
	});

	it("falls back to the whole-document pipeline on an explicit defaultScalarStyle", () => {
		const text = "a: 'x'\nb: 1\n";
		// The explicit style request skips the fast path; the pipeline renders
		// the replacement as it always has (pins the fallback branch).
		const out = modifyToString(text, ["a"], "y", { defaultScalarStyle: "double-quoted" });
		expect(out).toBe("a: y\nb: 1\n");
	});

	it("keeps typed navigation errors unchanged", () => {
		const text = "a: 1\n";
		const error = Effect.runSync(Effect.flip(YamlFormat.modify(text, ["missing", "deeper"], "v")));
		expect(error).toBeInstanceOf(YamlModificationError);
		expect((error as { path: ReadonlyArray<string | number> }).path).toEqual(["missing", "deeper"]);
	});

	it("still refuses multi-document streams and directives on the fast path shape", () => {
		const stream = "a: '1'\n---\na: '2'\n";
		const streamResult = Effect.runSyncExit(YamlFormat.modify(stream, ["a"], "x"));
		expect(streamResult._tag).toBe("Failure");
		const directives = "%YAML 1.2\n---\na: '1'\n";
		const directiveResult = Effect.runSyncExit(YamlFormat.modify(directives, ["a"], "x"));
		expect(directiveResult._tag).toBe("Failure");
	});

	it("splices sequence elements regionally", () => {
		const text = "list:\r\n  - 'a'\r\n  - \"b\"\r\n  - c\r\n";
		expect(modifyToString(text, ["list", 0], "A")).toBe("list:\r\n  - 'A'\r\n  - \"b\"\r\n  - c\r\n");
		expect(modifyToString(text, ["list", 1], "B")).toBe("list:\r\n  - 'a'\r\n  - \"B\"\r\n  - c\r\n");
		expect(modifyToString(text, ["list", 2], "C")).toBe("list:\r\n  - 'a'\r\n  - \"b\"\r\n  - C\r\n");
	});
});
