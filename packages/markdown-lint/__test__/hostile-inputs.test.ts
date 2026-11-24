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

const inputs: ReadonlyArray<readonly [name: string, source: string]> = [
	["a 400-column table with CJK cells", wideTable(400, 150)],
	["2,000 unclosed fences in list items", unclosedFences(2000)],
	["an ordinary document of 9,000 blocks", ordinary(9000)],
	["3,000 lines in blockquotes 40 deep with inline HTML", deepQuote(3000, 40)],
	["a paragraph of 60,000 code spans, links and lone dollar signs", atomicDollars(60000)],
	["a 198 KB line holding an inline data-URI image", dataUriLine(18000)],
	["one line of 16,000 HTML comments", commentsOnOneLine(16000)],
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
