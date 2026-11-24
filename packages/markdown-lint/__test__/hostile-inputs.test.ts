// Inputs that once made a lint with every rule superlinear, each held to a
// wall-clock ceiling. The shared document facts were recomputed by every
// rule, the container and fence readers walked the whole tree per line or
// per fence, inline math searched its atomic spans per character, the
// math-block scan re-stripped every container prefix at every depth, and
// MD060 measured every divider's line prefix from scratch.
//
// Measured on one machine with all 22 rules, before the fixes and after:
// - a 400-column, 150-row table with CJK cells: 12.4 s, 0.39 s;
// - 2,000 unclosed fenced code blocks in list items: 15.0 s, 0.06 s;
// - an ordinary mixed document of 9,000 blocks (27,900 lines): 11.9 s, 0.29 s;
// - 3,000 lines in blockquotes 40 deep, inline HTML on each: 21.3 s, 0.09 s;
// - one paragraph of 60,000 groups of a code span, a link and a lone `$`: 17.2 to 21.3 s with only the
//   inline-math cursor reverted (three runs), 0.68 to 0.71 s fixed;
// - one 198 KB line holding an inline data-URI image: 15.5 to 15.7 s with MD013's unanchored `\S*$` regex
//   (three runs), 11 ms with its scan back from the line end;
// - one line of 16,000 HTML comments: 9.3 to 10.5 s in the comment mask alone (three runs, no rules), which
//   re-read each comment's line from its start, 61 ms reading it once;
// - `applyFixes` over 90,000 MD009 fixes: 12.4 to 18.3 s rebuilding the text per fix (three runs), 27 to 38 ms
//   joining the pieces once.
//
// The ceiling is far above the fixed times, so a busy runner does not fail
// it, and far below the unfixed ones, so a regression to any of them does. It
// runs in the timing tier (vitest.config.ts), alone on its runner. The math
// scan's child cursor and single prefix strip are not guarded here: unfixed,
// that scan costs about 53 ms at 40 deep, under any useful ceiling.

import { assert, describe, it } from "@effect/vitest";
import { frontMatterLineCount, maskHtmlComments } from "../src/internal/reading.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { MD009 } from "../src/rules/MD009.js";

const CEILING_MS = 5_000;

const wideTable = (columns: number, rows: number): string => {
	const row = (cell: (column: number) => string) =>
		`| ${Array.from({ length: columns }, (_, column) => cell(column)).join(" | ")} |`;
	const body = Array.from({ length: rows }, (_, index) =>
		row((column) => (column % 3 === 0 ? `漢字${index}` : `v${column}`)),
	);
	return `${["# T", "", row((column) => `h${column}`), row(() => "---"), ...body].join("\n")}\n`;
};

const unclosedFences = (count: number): string =>
	`# T\n\n${Array.from({ length: count }, (_, index) => `- item\n  \`\`\`\n  code ${index}\n`).join("\n")}`;

const ordinary = (blocks: number): string => {
	const shapes: ReadonlyArray<(index: number) => ReadonlyArray<string>> = [
		(index) => [`## Section ${index}`],
		(index) => [`Paragraph ${index} with *emph*, \`code\`, a [link](http://x.com/${index}) and <b>html</b> text.`],
		() => ["- item one", "- item two", "  - nested"],
		(index) => ["```js", `const a${index} = 1;`, "```"],
		() => ["> quoted line", "> more quote"],
		(index) => ["| a | b |", "| - | - |", `| ${index} | x |`],
		(index) => ["<div>", `  <img src="a${index}.png">`, "</div>"],
		() => ["Some text with trailing spaces   ", `and a very long line ${"word ".repeat(25)}`],
		() => ["1. one", "2. two"],
		(index) => [`![alt](img${index}.png) and $x_${index}$ math`],
	];
	const lines = ["# Title", ""];
	for (let index = 0; index < blocks; index++)
		lines.push(...(shapes[index % 10] as (i: number) => ReadonlyArray<string>)(index), "");
	return lines.join("\n");
};

const deepQuote = (lines: number, depth: number): string =>
	`# T\n\n${Array.from({ length: lines }, (_, index) => `${"> ".repeat(depth)}line ${index} <b>x</b>`).join("\n")}\n`;

// Inline math reads past each atomic span (here a code span and a link destination) at every `$` it tries.
const atomicDollars = (groups: number): string =>
	`# T\n\n${Array.from({ length: groups }, (_, index) => `\`c${index}\` [l](u) $`).join(" ")}\n`;

// MD013's last run of non-space, which markdownlint finds under re2: a notebook export's inline image.
const dataUriLine = (repeats: number): string =>
	`# T\n\n![chart](data:image/png;base64,${"iVBORw0KGgo".repeat(repeats)}) and a caption\n`;

// The comment mask re-read each comment's line from its start: many comments on one line.
const commentsOnOneLine = (count: number): string => `x${"<!--a-->".repeat(count)}\n`;

// MD036 reads each top-level HTML block's re-read and each paragraph's children: emphasis lines inside HTML blocks,
// and one paragraph of emphasis spans.
const htmlBlocksOfEmphasis = (count: number): string =>
	`# T\n\n${Array.from({ length: count }, (_, index) => `<div>\n\n**Section ${index}**\n\n</div>\n`).join("\n")}`;
// `pairs` repeats of an emphasis and a strong: twice as many spans.
const emphasisSpans = (pairs: number): string => `# T\n\n${"*a* **b** ".repeat(pairs)}\n`;

// MD030 reads each list's end from the next block after it: alternating markers make every item a list.
const quotedListsOfTwoMarkers = (count: number): string =>
	`# T\n\n${Array.from({ length: count }, (_, index) => `> ${index % 2 === 0 ? "-" : "+"}  item ${index}`).join("\n")}\n`;

// Every nested list that ends on one line walks the quoted blank lines after it: depth times run.
const deepQuotedListThenBlanks = (depth: number, blanks: number): string =>
	`# T\n\n${Array.from({ length: depth }, (_, index) => `> ${"  ".repeat(index)}- item ${index}`).join("\n")}\n${">\n".repeat(blanks)}> text\n`;

// MD038 reads a code span's tokens back from its source: one span of 100,000 space-separated words over many lines.
const longCodeSpan = (words: number): string =>
	`# T\n\n\`  ${Array.from({ length: words }, (_, index) => (index % 10 === 9 ? `w${index}\n` : `w${index} `)).join("")}  \`\n`;

// MD037 pairs bare markers and reads the spaces beside each on its line: one line of 30,000 spaced marker pairs.
const spacedMarkersOnOneLine = (pairs: number): string => `# T\n\n${"a * b * ".repeat(pairs)}\n`;

// MD011 checks each reversed link against every code span and math span: one line of 20,000 of each.
const reversedLinksBesideCode = (count: number): string => `# T\n\n${"`c` (a)[b] ".repeat(count)}\n`;

// Image descriptions are re-parsed with the document's definitions when they can hold a reference.
const imagesAndDefinitions = (count: number): string =>
	`# T\n\n${Array.from({ length: count }, (_, index) => `![a [r${index}] *b*](i${index}.png)`).join("\n\n")}\n\n${Array.from({ length: count }, (_, index) => `[r${index}]: #`).join("\n")}\n`;

// MD034 checks each literal against the unbalanced label spans before it: one line of 20,000 bracketed addresses.
const bracketedAddresses = (count: number): string => `# T\n\n${"[a] b@c.de ".repeat(count)}\n`;

// MD034 pairs each inline HTML open tag with its close among the same siblings: one line of 24,000 unclosed tags,
// which a forward scan per open tag made quadratic (16,000 took 4.8 s with MD034 alone).
const unclosedInlineTags = (count: number): string => `# T\n\n${"<b> x ".repeat(count)}\n`;

// MD034 re-reads the rest of a block after a `[` in inline math, once: 20,000 URLs in emphasis after one, on one line.
const urlsAfterMathBracket = (count: number): string => `# T\n\n$[$ ${"*https://a.b* WWW.c.d ".repeat(count)}\n`;

const inputs: ReadonlyArray<readonly [name: string, source: string]> = [
	["a 400-column table with CJK cells", wideTable(400, 150)],
	["2,000 unclosed fences in list items", unclosedFences(2000)],
	["an ordinary document of 9,000 blocks", ordinary(9000)],
	["3,000 lines in blockquotes 40 deep with inline HTML", deepQuote(3000, 40)],
	["a paragraph of 60,000 code spans, links and lone dollar signs", atomicDollars(60000)],
	["a 198 KB line holding an inline data-URI image", dataUriLine(18000)],
	["one line of 16,000 HTML comments", commentsOnOneLine(16000)],
	["2,000 HTML blocks each holding an emphasis line", htmlBlocksOfEmphasis(2000)],
	["a paragraph of 40,000 emphasis spans", emphasisSpans(20000)],
	["a blockquote of 20,000 one-item lists", quotedListsOfTwoMarkers(20000)],
	["a list nested 40 deep in a blockquote, then 20,000 quoted blank lines", deepQuotedListThenBlanks(40, 20000)],
	["one code span of 100,000 words over 10,000 lines", longCodeSpan(100000)],
	["one line of 30,000 spaced emphasis-marker pairs", spacedMarkersOnOneLine(30000)],
	["one line of 20,000 reversed links beside code spans", reversedLinksBesideCode(20000)],
	["2,000 images holding references, beside 2,000 definitions", imagesAndDefinitions(2000)],
	["one line of 20,000 bracketed spans and addresses", bracketedAddresses(20000)],
	["one line of 24,000 unclosed inline HTML tags", unclosedInlineTags(24000)],
	["20,000 URLs in emphasis after a bracket in inline math", urlsAfterMathBracket(20000)],
];

describe("hostile inputs", () => {
	for (const [name, source] of inputs) {
		it(`lints ${name} with every rule under the ceiling`, { timeout: 30_000 }, () => {
			const start = performance.now();
			const findings = MarkdownLint.lint(source, rules);
			const elapsed = performance.now() - start;
			assert.isAbove(findings.length, 0);
			assert.isBelow(elapsed, CEILING_MS, `${name}: ${elapsed.toFixed(0)} ms`);
		});
	}
});

// The readers that run before any rule, each with its own tighter ceiling.
describe("hostile inputs to the reading pass", () => {
	const READING_CEILING_MS = 1_000;

	it("masks a long run of comments, one per line, under the ceiling", () => {
		const text = "<!-- a -->\n".repeat(50_000);
		const started = performance.now();
		const masked = maskHtmlComments(text);
		assert.isBelow(performance.now() - started, READING_CEILING_MS);
		assert.strictEqual(masked.length, text.length);
	});

	it("counts a long unterminated front matter block under the ceiling", () => {
		const text = `---\n${"x\n".repeat(100_000)}`;
		const started = performance.now();
		assert.strictEqual(frontMatterLineCount(text), 0);
		assert.isBelow(performance.now() - started, READING_CEILING_MS);
	});

	it("counts a long run of fence-like lines under the ceiling", () => {
		const text = `---\n${"--- x\n".repeat(100_000)}`;
		const started = performance.now();
		assert.strictEqual(frontMatterLineCount(text), 0);
		assert.isBelow(performance.now() - started, READING_CEILING_MS);
	});
});

describe("hostile inputs to applyFixes", () => {
	// One MD009 fix per paragraph: the splice once rebuilt the whole text per fix. Each paragraph is one line, so the
	// parse meets no run of hard line breaks.
	it("applies 90,000 fixes under the ceiling", { timeout: 60_000 }, () => {
		const source = `# T\n\n${"trailing spaces   \n\n".repeat(90_000)}`;
		const findings = MarkdownLint.lint(source, [MD009]);
		assert.strictEqual(findings.length, 90_000);
		const start = performance.now();
		const fixed = MarkdownLint.applyFixes(source, findings);
		const elapsed = performance.now() - start;
		assert.strictEqual(fixed, `# T\n\n${"trailing spaces\n\n".repeat(90_000)}`);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});
});

// Settings are document content (an inline `configure-file` comment), so a count or a width that drives a loop or a
// `repeat` is input too. markdownlint hangs on the first (it counts virtual blank lines past the document's top to
// `Infinity`) and throws on the second (a billion spaces per tab); the kit bounds both. Before the bounds the first
// never returned (killed at 20 s) and the second threw `RangeError: Invalid string length`.
describe("hostile settings", () => {
	it("lints a heading under lines_above: 1e999 under the ceiling", { timeout: 30_000 }, () => {
		const source = '<!-- markdownlint-configure-file {"MD022":{"lines_above":1e999}} -->\n\n# T\n\nx\n';
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules);
		const elapsed = performance.now() - start;
		// Every line above the heading reads as blank, as markdownlint reads the lines past the top: no MD022 finding.
		assert.deepStrictEqual(
			findings.filter((finding) => finding.ruleNames[0] === "MD022"),
			[],
		);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});

	it("lints a tab under spaces_per_tab: 1e9 under the ceiling, its fix capped", { timeout: 30_000 }, () => {
		const source = '<!-- markdownlint-configure-file {"MD010":{"spaces_per_tab":1e9}} -->\n\n# T\n\n\tx\n';
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD010");
		const elapsed = performance.now() - start;
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings).split("\n")[4], `${" ".repeat(1_000)}x`);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});

	it("lints a sublist under indent: 1e9 under the ceiling, its fix capped", { timeout: 30_000 }, () => {
		const source = '<!-- markdownlint-configure-file {"MD007":{"indent":1e9}} -->\n\n# T\n\n- a\n  - b\n';
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD007");
		const elapsed = performance.now() - start;
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings).split("\n")[5], `${" ".repeat(1_002)}- b`);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});

	it("lints a list under ul_single: 1e9 under the ceiling, its fix capped", { timeout: 30_000 }, () => {
		const source = '<!-- markdownlint-configure-file {"MD030":{"ul_single":1e9}} -->\n\n# T\n\n- a\n';
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD030");
		const elapsed = performance.now() - start;
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings).split("\n")[4], `-${" ".repeat(1_000)}a`);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});

	it("lints proper names under a list of 1,000 names under the ceiling", { timeout: 30_000 }, () => {
		const names = Array.from({ length: 1_000 }, (_, index) => `Name${index}`);
		const source = `${Array.from({ length: 2_000 }, (_, index) => `name${index % 1_000} and www.name${index}.com and \`name1\``).join("\n\n")}\n`;
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules, { config: { default: false, MD044: { names } } });
		const elapsed = performance.now() - start;
		assert.isAbove(findings.length, 0);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});

	it("lints a one-letter proper name matching 100,000 words under the ceiling", { timeout: 30_000 }, () => {
		const source = `${"a ".repeat(100_000)}\n`;
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules, { config: { default: false, MD044: { names: ["A", "A B"] } } });
		const elapsed = performance.now() - start;
		assert.isAbove(findings.length, 0);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});

	it("lints a heading under lines_above: 1e8 under the ceiling, its fix capped", { timeout: 30_000 }, () => {
		const source = "text\n# T\n";
		const start = performance.now();
		const findings = MarkdownLint.lint(source, rules, { config: { default: false, MD022: { lines_above: 1e8 } } });
		const elapsed = performance.now() - start;
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), `text\n${"\n".repeat(1_000)}# T\n`);
		assert.isBelow(elapsed, CEILING_MS, `${elapsed.toFixed(0)} ms`);
	});
});
