// Reads a file the way markdownlint does: masks HTML comment bodies and counts
// leading front-matter lines. The differential cases run the real markdownlint
// (through a variable specifier, as markdownlint-host.test.ts does) with a probe
// custom rule that records what markdownlint itself computed.

import { assert, describe, it } from "@effect/vitest";
import { frontMatterLineCount, maskHtmlComments } from "../src/internal/reading.js";

interface Probe {
	readonly frontMatterLines: ReadonlyArray<string>;
	readonly lines: ReadonlyArray<string>;
}

interface MarkdownlintSync {
	readonly lint: (options: {
		readonly strings: Readonly<Record<string, string>>;
		readonly customRules: ReadonlyArray<unknown>;
		readonly config: Readonly<Record<string, unknown>>;
	}) => unknown;
}

const syncSpecifier = "markdownlint/sync";
const markdownlint: MarkdownlintSync = await import(syncSpecifier);

const probe = (text: string): Probe => {
	let seen: Probe | undefined;
	markdownlint.lint({
		strings: { input: text },
		customRules: [
			{
				names: ["probe"],
				description: "Records markdownlint's view of the file",
				tags: ["test"],
				parser: "none",
				function: (params: Probe) => {
					seen = { frontMatterLines: [...params.frontMatterLines], lines: [...params.lines] };
				},
			},
		],
		config: { default: false, probe: true },
	});
	if (seen === undefined) throw new Error("probe rule did not run");
	return seen;
};

// markdownlint's `lines` for an empty remainder is [""], not [].
const contentLines = (masked: string, count: number): Array<string> => {
	const rest = masked.split("\n").slice(count);
	return rest.length === 0 ? [""] : rest;
};

const frontMatterInputs: ReadonlyArray<readonly [string, string, number]> = [
	["a --- YAML block", "---\ntitle: x\n---\n# H\n", 3],
	["a block followed by two blank lines", "---\ntitle: x\n---\n\n\n# H\n", 5],
	["a +++ block closed by +++", "+++\ntitle = 'x'\n+++\n# H\n", 3],
	["a +++ block closed by ...", "+++\ntitle = 'x'\n...\n# H\n", 3],
	["a { } block", '{\n"title": "x"\n}\n# H\n', 3],
	["a --- block with trailing spaces on the fence", "---  \ntitle: x\n---\t\n# H\n", 3],
	["an empty --- block", "---\n---\n# H\n", 2],
	["no front matter", "# H\n\nbody\n", 0],
	["a --- opener with no closer", "---\ntitle: x\n# H\n", 0],
	["a block ending the file without a newline", "---\na: b\n---", 3],
	["a closing fence with trailing text", "---\na: b\n--- x\n# H\n", 0],
	["a longer closing dash run", "---\na: b\n----\n# H\n", 0],
	["a later closing fence after a failed candidate", "---\na: b\n--- x\nc: d\n---\n# H\n", 5],
	["a --- block closed by ...", "---\na: b\n...\n# H\n", 0],
	["a +++ block closed by ---", "+++\na = 1\n---\n# H\n", 0],
	["a { block closed by ---", '{\n"a": 1\n---\n# H\n', 0],
	["a { block with no }", '{\n"a": 1\n# H\n', 0],
	["a closer followed by U+2028", "---\na: b\n---\u2028x\n# H\n", 0],
	["an opener followed by U+2028", "---\u2028\na: b\n---\n# H\n", 0],
	["a U+2028 inside the block ahead of the closer", "---\na: b\u2028---\n# H\n", 0],
	["an opener followed by a vertical tab", "---\u000b\na: b\n---\n# H\n", 0],
	["a closer followed by a no-break space", "---\na: b\n---\u00a0\n# H\n", 0],
	["an opener and closer followed by tabs and form feeds", "---\t\f\na: b\n---\t\f\n# H\n", 3],
	["a closer followed by a newline then U+2029", "---\na: b\n---\n\u2029\n# H\n", 3],
	["a byte order mark before a block", "\uFEFF---\na: b\n---\n# H\n", 3],
];

const maskInputs: ReadonlyArray<readonly [string, string]> = [
	["a block comment", "<!-- hello -->\n# H\n"],
	["a multi-line comment", "# H\n\n<!-- a\nb -->\n\ntext\n"],
	["an inline comment", "text <!-- note --> more\n"],
	["an empty comment", "<!---->\n"],
	["trailing spaces inside a comment line", "<!-- a   \n  b   -->\n"],
	["an inline comment ending in -", "text <!--x---> more\n"],
	["an inline comment holding --", "text <!-- a -- b --> more\n"],
	["a block comment holding --", "<!-- a -- b -->\n"],
	["a comment spanning table cells", "| a | <!-- x\ny --> |\n"],
	["two comments on a line", "<!-- a --> and <!-- b -->\n"],
	["an unterminated comment", "<!-- x\n# H\n"],
	["a terminated then an unterminated comment", "<!-- a -->\n<!-- b\n# H\n"],
];

describe("maskHtmlComments", () => {
	it("keeps the input's length and line breaks", () => {
		for (const [, text] of maskInputs) {
			const masked = maskHtmlComments(text);
			assert.strictEqual(masked.length, text.length, JSON.stringify(text));
			assert.strictEqual(masked.replace(/[^\r\n]/g, ""), text.replace(/[^\r\n]/g, ""), JSON.stringify(text));
		}
	});

	it("turns a comment body into dots but keeps the delimiters and the newline", () => {
		assert.strictEqual(maskHtmlComments("<!-- a\nb -->"), "<!-- .\n. -->");
		assert.strictEqual(maskHtmlComments("<!-- hello -->\n# H\n"), "<!-- ..... -->\n# H\n");
	});

	it("leaves an empty comment alone", () => {
		assert.strictEqual(maskHtmlComments("<!---->"), "<!---->");
	});

	it("keeps an inline comment that is not a valid CommonMark comment", () => {
		for (const text of ["text <!--x---> more", "text <!-- a -- b --> more", "| a | <!-- x\ny --> |"])
			assert.strictEqual(maskHtmlComments(text), text, JSON.stringify(text));
	});

	it("masks a block comment even when it holds --", () => {
		assert.strictEqual(maskHtmlComments("<!-- a -- b -->"), "<!-- . .. . -->");
	});

	it("masks the trailing spaces of a comment line", () => {
		assert.strictEqual(maskHtmlComments("<!-- a   \n  b   -->"), "<!-- ....\n  .   -->");
	});

	it("leaves the rest of the text unmasked after an unterminated comment", () => {
		assert.strictEqual(maskHtmlComments("<!-- x\n# H\n"), "<!-- x\n# H\n");
		assert.strictEqual(maskHtmlComments("<!-- a -->\n<!-- b\n# H\n"), "<!-- . -->\n<!-- b\n# H\n");
	});

	it("is linear on a long run of comments", () => {
		const text = "<!-- a -->\n".repeat(50_000);
		const started = performance.now();
		const masked = maskHtmlComments(text);
		assert.isBelow(performance.now() - started, 1000);
		assert.strictEqual(masked.length, text.length);
	});
});

describe("frontMatterLineCount", () => {
	for (const [label, text, expected] of frontMatterInputs)
		it(`counts ${label}`, () => {
			assert.strictEqual(frontMatterLineCount(text), expected);
		});

	it("counts the same under CRLF line endings", () => {
		assert.strictEqual(frontMatterLineCount("---\r\ntitle: x\r\n---\r\n\r\n# H\r\n"), 4);
		assert.strictEqual(frontMatterLineCount("---\ntitle: x\n---\n\n# H\n".replace(/\n/g, "\r\n")), 4);
	});

	it("agrees with markdownlint on a CRLF file", () => {
		const text = "---\r\ntitle: x\r\n---\r\n\r\n# H\r\n";
		assert.strictEqual(frontMatterLineCount(text), probe(text).frontMatterLines.length);
	});

	it("is linear on a long unterminated block", () => {
		const text = `---\n${"x\n".repeat(100_000)}`;
		const started = performance.now();
		assert.strictEqual(frontMatterLineCount(text), 0);
		assert.isBelow(performance.now() - started, 1000);
	});

	it("is linear on a long run of fence-like lines", () => {
		const text = `---\n${"--- x\n".repeat(100_000)}`;
		const started = performance.now();
		assert.strictEqual(frontMatterLineCount(text), 0);
		assert.isBelow(performance.now() - started, 1000);
	});
});

describe("against markdownlint", () => {
	for (const [label, text] of frontMatterInputs)
		it(`reads ${label} as markdownlint does`, () => {
			const seen = probe(text);
			const count = frontMatterLineCount(text);
			assert.strictEqual(count, seen.frontMatterLines.length);
			const masked = maskHtmlComments(text);
			assert.deepStrictEqual(contentLines(masked, count), [...seen.lines]);
		});

	for (const [label, text] of maskInputs)
		it(`masks ${label} as markdownlint does`, () => {
			const seen = probe(text);
			const count = frontMatterLineCount(text);
			assert.strictEqual(count, seen.frontMatterLines.length);
			assert.deepStrictEqual(contentLines(maskHtmlComments(text), count), [...seen.lines]);
		});

	it("reads a file with both front matter and comments", () => {
		const text = "---\ntitle: <!-- x -->\n---\n\n<!-- a\nb -->\n# H\n";
		const seen = probe(text);
		const count = frontMatterLineCount(text);
		assert.strictEqual(count, seen.frontMatterLines.length);
		assert.deepStrictEqual(contentLines(maskHtmlComments(text), count), [...seen.lines]);
	});
});
