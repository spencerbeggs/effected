// FrontmatterSource.split under `bom: "skip"`: one leading U+FEFF is stepped
// over, reported, and counted in every offset; the default reads it as text.

import { assert, describe, it } from "@effect/vitest";
import { FrontmatterSource } from "../src/FrontmatterSource.js";

const BOM = "\uFEFF";
const skip = (source: string) => FrontmatterSource.split(source, { bom: "skip" });

describe("FrontmatterSource.split without the bom option", () => {
	it("reads a leading BOM as text, so the fence is absent and no bom field is recorded", () => {
		const source = `${BOM}---\ntype: x\n---\n`;
		for (const result of [FrontmatterSource.split(source), FrontmatterSource.split(source, { bom: "keep" })]) {
			assert.strictEqual(result.fence, "absent");
			assert.strictEqual(result.frontmatter, undefined);
			assert.strictEqual(result.body, source);
			assert.strictEqual(result.bodyOffset, 0);
			assert.isFalse("bom" in result);
		}
	});

	it("records no bom field on a source without one", () => {
		assert.isFalse("bom" in FrontmatterSource.split("---\na: 1\n---\n"));
	});
});

describe('FrontmatterSource.split with bom: "skip"', () => {
	it("reports a closed block with every offset relative to the source as passed", () => {
		const source = `${BOM}---\ntype: x\n---\nbody\n`;
		const result = skip(source);
		assert.strictEqual(result.bom, true);
		assert.strictEqual(result.fence, "closed");
		assert.strictEqual(result.fenceFormat, "yaml");
		assert.strictEqual(result.frontmatter?.value, "type: x\n");
		assert.strictEqual(result.frontmatter?.newline, "\n");
		assert.strictEqual(result.frontmatter?.valueStart, 5);
		assert.strictEqual(result.frontmatter?.valueEnd, 13);
		assert.strictEqual(result.bodyOffset, 17);
		assert.strictEqual(result.body, "body\n");
		assert.strictEqual(source.slice(result.frontmatter?.valueStart, result.frontmatter?.valueEnd), "type: x\n");
		assert.strictEqual(result.body, source.slice(result.bodyOffset));
	});

	it("shifts each offset by exactly one against the same source without the BOM", () => {
		for (const bare of [
			"---\ntype: x\n---\nbody\n",
			"+++\na = 1\n+++\n",
			'---json\n{"a":1}\n---',
			"---\r\na\r\n---\r\nb",
		]) {
			const plain = FrontmatterSource.split(bare);
			const marked = skip(`${BOM}${bare}`);
			assert.strictEqual(marked.fence, "closed", bare);
			assert.strictEqual(marked.fenceFormat, plain.fenceFormat, bare);
			assert.strictEqual(marked.frontmatter?.value, plain.frontmatter?.value, bare);
			assert.strictEqual(marked.frontmatter?.newline, plain.frontmatter?.newline, bare);
			assert.strictEqual(marked.frontmatter?.valueStart, (plain.frontmatter?.valueStart ?? -1) + 1, bare);
			assert.strictEqual(marked.frontmatter?.valueEnd, (plain.frontmatter?.valueEnd ?? -1) + 1, bare);
			assert.strictEqual(marked.bodyOffset, plain.bodyOffset + 1, bare);
			assert.strictEqual(marked.body, plain.body, bare);
		}
	});

	it("reports an unclosed fence after the BOM, body starting past the mark", () => {
		for (const [bare, format] of [
			["---\ntitle: hi\n", "yaml"],
			["+++", "toml"],
			["---json\n{", "json"],
		] as const) {
			const source = `${BOM}${bare}`;
			const result = skip(source);
			assert.strictEqual(result.bom, true, bare);
			assert.strictEqual(result.fence, "unclosed", bare);
			assert.strictEqual(result.fenceFormat, format, bare);
			assert.strictEqual(result.frontmatter, undefined, bare);
			assert.strictEqual(result.bodyOffset, 1, bare);
			assert.strictEqual(result.body, bare, bare);
			assert.strictEqual(result.body, source.slice(result.bodyOffset), bare);
		}
	});

	it("reports an absent fence after the BOM, body starting past the mark", () => {
		for (const bare of ["# Title\n", "", " ---\nx\n---\n"]) {
			const source = `${BOM}${bare}`;
			const result = skip(source);
			assert.strictEqual(result.bom, true, bare);
			assert.strictEqual(result.fence, "absent", bare);
			assert.isFalse("fenceFormat" in result, bare);
			assert.strictEqual(result.frontmatter, undefined, bare);
			assert.strictEqual(result.bodyOffset, 1, bare);
			assert.strictEqual(result.body, bare, bare);
		}
	});

	it("reports bom: false and the default offsets for every fence state on a source without a BOM", () => {
		for (const source of ["---\na: 1\n---\nb\n", "---\na: 1\n", "# plain\n", ""]) {
			const plain = FrontmatterSource.split(source);
			const result = skip(source);
			assert.strictEqual(result.bom, false, source);
			assert.strictEqual(result.fence, plain.fence, source);
			assert.strictEqual(result.fenceFormat, plain.fenceFormat, source);
			assert.strictEqual(result.bodyOffset, plain.bodyOffset, source);
			assert.strictEqual(result.body, plain.body, source);
			assert.deepStrictEqual(result.frontmatter, plain.frontmatter, source);
		}
	});

	it("skips only one BOM: a second mark is text, so offset 1 is not a fence", () => {
		const source = `${BOM}${BOM}---\na: 1\n---\n`;
		const result = skip(source);
		assert.strictEqual(result.bom, true);
		assert.strictEqual(result.fence, "absent");
		assert.strictEqual(result.frontmatter, undefined);
		assert.strictEqual(result.bodyOffset, 1);
		assert.strictEqual(result.body, `${BOM}---\na: 1\n---\n`);
	});

	it("does not treat a BOM after offset 0 as one to skip", () => {
		const result = skip(`---\n${BOM}a: 1\n---\n`);
		assert.strictEqual(result.bom, false);
		assert.strictEqual(result.frontmatter?.value, `${BOM}a: 1\n`);
		assert.strictEqual(result.frontmatter?.valueStart, 4);
	});
});

describe("FrontmatterSource.join of a BOM-skipping split", () => {
	it("re-emits the mark, so the round trip is byte-exact for every fence state", () => {
		for (const source of [
			`${BOM}---\ntype: x\n---\nbody\n`,
			`${BOM}+++\na = 1\n+++\n`,
			`${BOM}---\nunclosed\n`,
			`${BOM}# no block\n`,
			BOM,
			`${BOM}${BOM}---\na\n---\n`,
			"---\na\n---\nb\n",
			"# plain\n",
		]) {
			assert.strictEqual(FrontmatterSource.join(skip(source)), source, JSON.stringify(source));
		}
	});
});
