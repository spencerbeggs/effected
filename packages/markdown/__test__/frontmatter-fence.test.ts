// Frontmatter fence state and value offsets (effected#1187): `FrontmatterSource.split` reports whether the head of
// a source is `absent`, `unclosed` or `closed`, and places the value in the file; the parsed `Frontmatter` node
// carries the same `valueStart`; `MarkdownDocument.frontmatterFence` is the parsed-document accessor; and the
// frontmatter decoder's missing reason names an unclosed fence.

import { assert, describe, it } from "@effect/vitest";
import { Yaml } from "@effected/yaml";
import { Option, Result } from "effect";
import { FrontmatterSource, FrontmatterSourceBlock, FrontmatterSourceSplit } from "../src/FrontmatterSource.js";
import { MarkdownParseOptions } from "../src/Markdown.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { Frontmatter } from "../src/MarkdownNode.js";
import type { MdastNode } from "../src/Mdast.js";
import { Mdast } from "../src/Mdast.js";

const parse = (source: string, frontmatter = true): MarkdownDocument =>
	Result.getOrThrow(MarkdownDocument.parseResult(source, MarkdownParseOptions.make({ frontmatter })));

describe("FrontmatterSource.split fence state", () => {
	it("reports absent, with no format, when offset 0 is not an opening fence", () => {
		for (const source of [
			"",
			"# Title\n",
			"--- \nx\n---\n",
			" ---\nx\n---\n",
			"----\nx\n----\n",
			"---yaml\nx\n---\n",
		]) {
			const split = FrontmatterSource.split(source);
			assert.strictEqual(split.fence, "absent", JSON.stringify(source));
			assert.isUndefined(split.fenceFormat, JSON.stringify(source));
			assert.isUndefined(split.frontmatter, JSON.stringify(source));
		}
	});

	it("reports unclosed, with the opening fence's format, when no closing fence follows", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["---\ntitle: hi\n", "yaml"],
			["---\r\ntitle: hi\r\n\r\n# Body\r\n", "yaml"],
			["---\n", "yaml"],
			["+++\na = 1\n", "toml"],
			["---json\n{}\n", "json"],
			// A json block closes with `---`, never `---json`.
			["---json\n{}\n---json\n", "json"],
			// A toml block closes with `+++`, never `---`.
			["+++\na = 1\n---\n", "toml"],
		];
		for (const [source, format] of cases) {
			const split = FrontmatterSource.split(source);
			assert.strictEqual(split.fence, "unclosed", JSON.stringify(source));
			assert.strictEqual(split.fenceFormat, format, JSON.stringify(source));
			// Per the grammar an unclosed fence is not frontmatter: the body is the whole source.
			assert.isUndefined(split.frontmatter);
			assert.strictEqual(split.body, source);
			assert.strictEqual(split.bodyOffset, 0);
		}
	});

	it("reports an opening fence at end of file, with no line terminator and no body, as unclosed", () => {
		for (const [source, format] of [
			["---", "yaml"],
			["+++", "toml"],
			["---json", "json"],
		] as const) {
			const split = FrontmatterSource.split(source);
			assert.strictEqual(split.fence, "unclosed", source);
			assert.strictEqual(split.fenceFormat, format, source);
		}
	});

	it("reports closed, with the block's format, for every fence in the closed set", () => {
		for (const [source, format] of [
			["---\na: 1\n---\n", "yaml"],
			["+++\na = 1\n+++\n", "toml"],
			['---json\n{"a":1}\n---\n', "json"],
		] as const) {
			const split = FrontmatterSource.split(source);
			assert.strictEqual(split.fence, "closed", source);
			assert.strictEqual(split.fenceFormat, format, source);
			assert.strictEqual(split.frontmatter?.format, format, source);
		}
	});
});

describe("FrontmatterSource.split value offsets", () => {
	const cases: ReadonlyArray<readonly [label: string, source: string, valueStart: number, value: string]> = [
		["yaml, LF", "---\ntitle: hi\n---\n\n# Body\n", 4, "title: hi\n"],
		["yaml, CRLF", "---\r\ntitle: hi\r\n---\r\nbody", 5, "title: hi\r\n"],
		["yaml, bare CR", "---\rtitle: hi\r---\rbody", 4, "title: hi\r"],
		["toml", "+++\na = 1\n+++\n", 4, "a = 1\n"],
		["json, LF", '---json\n{"a":1}\n---\n', 8, '{"a":1}\n'],
		["json, CRLF", '---json\r\n{"a":1}\r\n---\r\n', 9, '{"a":1}\r\n'],
		["no value lines", "---\n---\nbody", 4, ""],
		["closing fence at end of file", "---\nfoo: 1\n---", 4, "foo: 1\n"],
	];

	for (const [label, source, valueStart, value] of cases) {
		it(`places the value in the file: ${label}`, () => {
			const block = FrontmatterSource.split(source).frontmatter;
			assert.isDefined(block);
			assert.strictEqual(block?.value, value);
			assert.strictEqual(block?.valueStart, valueStart);
			assert.strictEqual(block?.valueEnd, valueStart + value.length);
			assert.strictEqual(source.slice(block?.valueStart, block?.valueEnd), value);
		});
	}

	it("maps an offset a YAML parser reports inside the value onto the file", () => {
		const source = "---\r\ntitle: hi\r\ncount: [1,\r\n---\r\n# Body\r\n";
		const block = FrontmatterSource.split(source).frontmatter;
		const value = block?.value ?? "";
		const parsed = Yaml.parseResult(value);
		assert.isTrue(Result.isFailure(parsed), "the control: the value is malformed YAML");
		if (Result.isFailure(parsed)) {
			const diagnostic = parsed.failure.diagnostics[0];
			assert.isDefined(diagnostic);
			const inValue = diagnostic?.offset ?? -1;
			const inFile = (block?.valueStart ?? 0) + inValue;
			assert.isAbove(inValue, 0);
			// The file offset names the same position the YAML engine named inside the value.
			assert.strictEqual(source.slice(inFile, block?.valueEnd), value.slice(inValue));
		}
	});

	it("still joins a hand-built split that carries none of the informational fields", () => {
		const split = FrontmatterSourceSplit.make({
			frontmatter: FrontmatterSourceBlock.make({ format: "yaml", value: "a: 1\n" }),
			body: "body\n",
		});
		assert.isUndefined(split.fence);
		assert.strictEqual(FrontmatterSource.join(split), "---\na: 1\n---\nbody\n");
	});
});

describe("the parsed Frontmatter node's valueStart", () => {
	const sources = [
		"---\ntitle: hi\n---\n\n# Body\n",
		"---\r\ntitle: hi\r\n---\r\nbody",
		"---\rtitle: hi\r---\rbody",
		"+++\na = 1\n+++\n",
		'---json\r\n{"a":1}\r\n---\r\n',
		"---\n---\nbody",
		"---\nfoo: 1\n---",
	];

	it("equals the string-level split's, whatever the fence and its terminator", () => {
		for (const source of sources) {
			const node = Option.getOrThrow(parse(source).frontmatter);
			assert.strictEqual(node.valueStart, FrontmatterSource.split(source).frontmatter?.valueStart, source);
			// The node's value (which drops the final terminator) starts exactly there.
			assert.isTrue(source.slice(node.valueStart).startsWith(node.value), source);
		}
	});

	it("is absent on a node built by hand or admitted from plain mdast", () => {
		assert.isUndefined(Frontmatter.make({ format: "yaml", value: "a: 1" }).valueStart);
		const admitted = Result.getOrThrow(
			Mdast.fromMdastResult({ type: "root", children: [{ type: "yaml", value: "a: 1" }] }),
		);
		const head = admitted.children[0];
		assert.strictEqual(head?.type, "frontmatter");
		assert.isUndefined(head?.type === "frontmatter" ? head.valueStart : 0);
	});

	it("is never projected to plain mdast", () => {
		const projected = Mdast.toMdast(parse("---\na: 1\n---\n").root);
		const children = projected.children as ReadonlyArray<MdastNode>;
		const head = children[0];
		assert.strictEqual(head?.type, "yaml");
		assert.notProperty(head, "valueStart");
	});
});

describe("MarkdownDocument.frontmatterFence", () => {
	it("reads the source, whatever the capture toggle", () => {
		for (const frontmatter of [true, false]) {
			assert.strictEqual(parse("# Title\n", frontmatter).frontmatterFence, "absent");
			assert.strictEqual(parse("---\ntitle: hi\n\n# Body\n", frontmatter).frontmatterFence, "unclosed");
			assert.strictEqual(parse("---\ntitle: hi\n---\n# Body\n", frontmatter).frontmatterFence, "closed");
		}
	});

	it("is closed exactly when hasFrontmatterBlock is true, over every short source", () => {
		// Every string of up to four tokens from an alphabet of fence pieces, terminators and noise: the raw scan
		// behind frontmatterFence and the preprocessed scan behind hasFrontmatterBlock must agree on every one.
		const alphabet = ["---", "+++", "---json", "\n", "\r\n", "\r", "x", "\u0000", " "];
		let checked = 0;
		let closed = 0;
		const visit = (prefix: string, depth: number): void => {
			const document = MarkdownDocument.make({
				source: prefix,
				root: parse("").root,
				diagnostics: [],
				definitions: new Map(),
			});
			const fence = document.frontmatterFence;
			assert.strictEqual(fence === "closed", document.hasFrontmatterBlock, JSON.stringify(prefix));
			assert.strictEqual(fence, FrontmatterSource.split(prefix).fence, JSON.stringify(prefix));
			checked += 1;
			if (fence === "closed") closed += 1;
			if (depth < 4) for (const token of alphabet) visit(prefix + token, depth + 1);
		};
		visit("", 0);
		// The control: the sweep covered the space and reached closed blocks, so the agreement is not vacuous.
		assert.strictEqual(checked, (9 ** 5 - 1) / 8);
		assert.isAbove(closed, 10);
	});
});
