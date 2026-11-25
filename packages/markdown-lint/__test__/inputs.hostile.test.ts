// Inputs that once made a lint with every rule superlinear, each held to
// linear growth: four times the input costs about four times the CPU time. The shared document facts were recomputed by every
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
// Each unit measures a ratio, not a time: a ceiling in milliseconds held on the
// machine above and failed on a loaded runner, where a ratio holds on both
// (#1415). The file runs in the hostile tier (vitest.config.ts), one file at a
// time. The math scan's child cursor and single prefix strip are not guarded
// here: unfixed, that scan costs about 53 ms at 40 deep.

import { assert, describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { frontMatterLineCount, maskHtmlComments } from "../src/internal/reading.js";
import type { LintRule } from "../src/LintRule.js";
import { MarkdownLint } from "../src/MarkdownLint.js";
import { rules } from "../src/rules/all.js";
import { MD009 } from "../src/rules/MD009.js";
import { MD034 } from "../src/rules/MD034.js";
import { MD049 } from "../src/rules/MD049.js";
import { MD051 } from "../src/rules/MD051.js";
import { MD052 } from "../src/rules/MD052.js";
import { MD053 } from "../src/rules/MD053.js";
import { MD054 } from "../src/rules/MD054.js";
import { MD055 } from "../src/rules/MD055.js";

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

// An image's label is re-parsed with the definitions it names: one label naming one definition 8,000 times, whose title
// is 80 KB, once grew the re-parsed text past the longest string (`RangeError: Invalid string length`).
const labelNamingOneDefinition = (uses: number, title: number): string =>
	`# T\n\nSee ![${"[x] ".repeat(uses)}](i.png)\n\n[x]: http://e.com "${"t".repeat(title)}"\n`;
// Many images naming one definition as long as the document: the definition's source was re-parsed per image.
const imagesNamingOneLongDefinition = (count: number): string =>
	`# T\n\n${"![[x]](i.png)\n\n".repeat(Math.ceil(count / 10))}[x]: http://e.com "${"t".repeat(count * 4)}"\n`;
// One image's label holding many images: each nested image copied the whole label's offsets.
const imagesNestedInOneLabel = (count: number): string =>
	`# T\n\n![${"![a](b)".repeat(Math.ceil(count / 4))}](i.png)\n`;

// Images nested in one another's labels: each level's label was read by a recursive call, which overflowed the stack
// (MD049 by 2,000 levels, MD052 by 4,000), where markdownlint reads every level.
const deeplyNestedImages = (depth: number): string => `# T\n\n${"![".repeat(depth)}a${"](b)".repeat(depth)}\n`;

// MD034 checks each literal against the unbalanced label spans before it: one line of 20,000 bracketed addresses.
const bracketedAddresses = (count: number): string => `# T\n\n${"[a] b@c.de ".repeat(count)}\n`;

// MD034 pairs each inline HTML open tag with its close among the same siblings: one line of 24,000 unclosed tags,
// which a forward scan per open tag made quadratic (16,000 took 4.8 s with MD034 alone).
const unclosedInlineTags = (count: number): string => `# T\n\n${"<b> x ".repeat(count)}\n`;

// MD034 re-reads a block holding a `www.` in another case, and the rest of a block after a `[` in inline math, once
// each: 10,000 URLs and other-case hosts in emphasis after one, on one line.
const urlsAfterMathBracket = (count: number): string => `# T\n\n$[$ ${"*https://a.b* WWW.c.d ".repeat(count)}\n`;

// The reference data MD052 and MD053 read: each failed label end shims back to the latest label start, a formed link
// deactivates the link starts before it, and a label end takes the latest start not yet failed.
const undefinedReferences = (count: number): string => `# T\n\n${"[a] [b][c] [d][] ".repeat(count)}\n`;
const imagesAndLinks = (count: number): string => `# T\n\n${"![a] [b](u) ".repeat(count)}\n`;
const openersThenClosers = (count: number): string => `# T\n\n${"[".repeat(count)}x${"]".repeat(count)}\n`;
const unusedDefinitions = (count: number): string =>
	`# T\n\n${Array.from({ length: count }, (_, index) => `[u${index}]: https://u.example/${index}\n`).join("")}`;
const usesOfOneLabel = (count: number): string =>
	`# T\n\n${"[r] [x][r] ".repeat(count)}\n\n${"[r]: u\n".repeat(count)}`;

// MD054 reads every autolink, link and image with each style disallowed.
const linkStyles = (count: number): string =>
	`# T\n\n${"<https://a.example> [t](https://a.example) [t][r] [r][] [r] ![i][r] ".repeat(count)}\n\n[r]: https://r.example\n`;

// MD051 suffixes each repeated heading's fragment and looks each link's fragment up in every case: every link names
// the last repeat in another case, which a search of the fragments in order finds only at their end; four links a
// heading, so the lookups outweigh the parse.
const repeatedHeadings = (count: number): string =>
	`${"# Same\n\n".repeat(count)}${`[x](#SAME-${count - 1}) `.repeat(count * 4)}\n`;

// The table readers (MD055, MD056, MD058, MD060) read every row's raw line: a table of many rows, and a row that is one
// long run of pipes.
const tallTable = (count: number): string => `# T\n\n| a | b |\n| - | - |\n${"| c | d\n".repeat(count)}\ntext\n`;
const pipeRun = (count: number): string => `# T\n\n| a | b |\n| - | - |\n${"|".repeat(count)}\n`;

// 10,000 against 2,500 of `make`'s unit under `rule` alone, as `Growth.measure` times it.
const scalingRatio = (
	make: (count: number) => string,
	rule: LintRule,
	config: Record<string, unknown>,
): { readonly value: number; readonly detail: string } => {
	const { ratio, detail } = Growth.measure(
		(count) => {
			const source = make(count);
			return () => MarkdownLint.lint(source, [rule], { config: { default: false, [rule.name]: config } });
		},
		{ from: 2_500, bound: 8 },
	);
	return { value: ratio, detail };
};

/**
 * `make(size)` costs about four times `make(size / 4)`: linear work. No unit here bounds an elapsed time, since a
 * ceiling in milliseconds holds on one machine and fails on a loaded runner, while a ratio holds on both (#1415).
 */
const linear = (make: (count: number) => () => unknown, size: number): void => {
	Growth.assertOrder(make, { from: size / 4, order: 1 });
};

const scalingShapes: ReadonlyArray<
	readonly [name: string, make: (count: number) => string, rule: LintRule, config: Record<string, unknown>]
> = [
	["re-reads URLs after a bracket in inline math", (count) => urlsAfterMathBracket(count), MD034, {}],
	["reads undefined references and chains", undefinedReferences, MD052, { shortcut_syntax: true }],
	["reads alternating images and links", imagesAndLinks, MD052, { shortcut_syntax: true }],
	["re-parses image labels naming one long definition", imagesNamingOneLongDefinition, MD049, {}],
	["reads image labels naming one long definition", imagesNamingOneLongDefinition, MD052, { shortcut_syntax: true }],
	["re-parses images nested in one label", imagesNestedInOneLabel, MD049, {}],
	["reads images nested in one label", imagesNestedInOneLabel, MD052, { shortcut_syntax: true }],
	["reads label starts closed in reverse", openersThenClosers, MD052, { shortcut_syntax: true }],
	["checks fragments against repeated headings", repeatedHeadings, MD051, {}],
	["reads a tall table's rows", tallTable, MD055, {}],
	["reads a row of many pipes", pipeRun, MD055, {}],
	[
		"checks every link style",
		linkStyles,
		MD054,
		{ autolink: false, inline: false, full: false, collapsed: false, shortcut: false, url_inline: false },
	],
];

// Each shape with the size its name gives: `make(size)` is the input, and `make(size / 4)` the small side its growth
// is measured from.
const inputs: ReadonlyArray<readonly [name: string, make: (count: number) => string, size: number]> = [
	["a 400-column table with CJK cells", (rows) => wideTable(400, rows), 152],
	["2,000 unclosed fences in list items", unclosedFences, 2000],
	["an ordinary document of 9,000 blocks", ordinary, 9000],
	["3,000 lines in blockquotes 40 deep with inline HTML", (lines) => deepQuote(lines, 40), 3000],
	["a paragraph of 60,000 code spans, links and lone dollar signs", atomicDollars, 60000],
	["a 198 KB line holding an inline data-URI image", dataUriLine, 18000],
	["one line of 16,000 HTML comments", commentsOnOneLine, 16000],
	["2,000 HTML blocks each holding an emphasis line", htmlBlocksOfEmphasis, 2000],
	["a paragraph of 40,000 emphasis spans", emphasisSpans, 20000],
	["a blockquote of 20,000 one-item lists", quotedListsOfTwoMarkers, 20000],
	[
		"a list nested 40 deep in a blockquote, then 20,000 quoted blank lines",
		(blanks) => deepQuotedListThenBlanks(40, blanks),
		20000,
	],
	["one code span of 100,000 words over 10,000 lines", longCodeSpan, 100000],
	["one line of 30,000 spaced emphasis-marker pairs", spacedMarkersOnOneLine, 30000],
	["one line of 20,000 reversed links beside code spans", reversedLinksBesideCode, 20000],
	["2,000 images holding references, beside 2,000 definitions", imagesAndDefinitions, 2000],
	["one image label naming one 80 KB definition 8,000 times", (uses) => labelNamingOneDefinition(uses, 80000), 8000],
	["one line of 20,000 bracketed spans and addresses", bracketedAddresses, 20000],
	["one line of 24,000 unclosed inline HTML tags", unclosedInlineTags, 24000],
	["10,000 URLs in emphasis after a bracket in inline math", urlsAfterMathBracket, 10000],
	["one line of 20,000 undefined references, collapsed and full", undefinedReferences, 20000],
	["20,000 uses of one label beside 20,000 duplicate definitions", usesOfOneLabel, 20000],
	["20,000 unused definitions", unusedDefinitions, 20000],
	// Under every rule together the lookups are a small share of the work; the guard on MD051's lookups alone is this
	// shape's twin in `scalingShapes`, which fails the quadratic lookup at 9.5x.
	["5,000 repeated headings and 20,000 fragments in another case", repeatedHeadings, 5000],
	["a table of 20,000 rows", tallTable, 20000],
	["a table row of 50,000 pipes", pipeRun, 50000],
];

describe("hostile inputs", () => {
	for (const [name, make, size] of inputs) {
		it(`lints ${name} with every rule, in time linear in the input`, () => {
			assert.isAbove(MarkdownLint.lint(make(size), rules).length, 0);
			linear((count) => {
				const source = make(count);
				return () => MarkdownLint.lint(source, rules);
			}, size);
		});
	}

	// The re-parse reads only whether a label is defined, so it stays as long as the label whatever the definition holds.
	for (const rule of [MD049, MD052, MD053, MD054]) {
		it(`lints one image label naming one 80 KB definition 8,000 times under ${rule.name} without throwing`, () => {
			const source = labelNamingOneDefinition(8000, 80000);
			assert.doesNotThrow(() => MarkdownLint.lint(source, [rule]));
		});
	}

	// Every level is still re-parsed in turn, so the cost grows with depth times the label (see the module concept).
	for (const rule of [MD049, MD052]) {
		it(`lints 4,000 images nested in one another's labels under ${rule.name} without throwing`, {
			timeout: 60_000,
		}, () => {
			const source = deeplyNestedImages(4000);
			assert.doesNotThrow(() => MarkdownLint.lint(source, [rule]));
		});
	}

	// Scaling guards, as `@effected/markdown`'s pathological suite guards its own linear scans: a ceiling alone lets a
	// cheaper superlinear scan through at these sizes, a ratio does not. CPU time, not wall time, so load descheduling
	// the process cannot stretch one side; the minimum of five samples, since a pause only ever adds time. Linear is
	// about 4x for 4x the input, a per-item rescan about 16x.
	for (const [name, make, rule, config] of scalingShapes) {
		it(`${name} in time linear in the input`, { timeout: 60_000 }, () => {
			const ratio = scalingRatio(make, rule, config);
			assert.isBelow(
				ratio.value,
				8,
				`4x the input cost ${ratio.value.toFixed(1)}x the CPU time (${ratio.detail}); linear is about 4x`,
			);
		});
	}
});

// The readers that run before any rule, each with its own tighter ceiling.
describe("hostile inputs to the reading pass", () => {
	it("masks a long run of comments, one per line, in time linear in the run", () => {
		const text = "<!-- a -->\n".repeat(50_000);
		assert.strictEqual(maskHtmlComments(text).length, text.length);
		linear((count) => {
			const run = "<!-- a -->\n".repeat(count);
			return () => maskHtmlComments(run);
		}, 200_000);
	});

	it("counts a long unterminated front matter block in time linear in the block", () => {
		assert.strictEqual(frontMatterLineCount(`---\n${"x\n".repeat(100_000)}`), 0);
		linear((count) => {
			const text = `---\n${"x\n".repeat(count)}`;
			return () => frontMatterLineCount(text);
		}, 400_000);
	});

	it("counts a long run of fence-like lines in time linear in the run", () => {
		assert.strictEqual(frontMatterLineCount(`---\n${"--- x\n".repeat(100_000)}`), 0);
		linear((count) => {
			const text = `---\n${"--- x\n".repeat(count)}`;
			return () => frontMatterLineCount(text);
		}, 400_000);
	});
});

describe("hostile inputs to applyFixes", () => {
	it("applies 90,000 fixes in time linear in the fixes", () => {
		const source = `# T\n\n${"trailing spaces   \n\n".repeat(90_000)}`;
		const findings = MarkdownLint.lint(source, [MD009]);
		assert.strictEqual(findings.length, 90_000);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), `# T\n\n${"trailing spaces\n\n".repeat(90_000)}`);
		linear((count) => {
			const text = `# T\n\n${"trailing spaces   \n\n".repeat(count)}`;
			const found = MarkdownLint.lint(text, [MD009]);
			return () => MarkdownLint.applyFixes(text, found);
		}, 90_000);
	});
});

describe("hostile settings", () => {
	/**
	 * A setting a million times larger costs about the same: the fix it sizes is capped, so the work does not follow
	 * the setting. Work that did follow it would read as a ratio near a million.
	 */
	const flatInSetting = (lintUnder: (setting: number) => () => unknown, from: number): void => {
		const { ratio, detail } = Growth.measure(lintUnder, { from, factor: 1_000_000, bound: 4 });
		assert.isBelow(ratio, 4, `a setting 1,000,000x larger: ${detail}`);
	};

	// No size to grow: `1e999` is infinity. The lint returns, and returns no MD022 finding.
	it("lints a heading under lines_above: 1e999", () => {
		const source = '<!-- markdownlint-configure-file {"MD022":{"lines_above":1e999}} -->\n\n# T\n\nx\n';
		assert.deepStrictEqual(
			MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD022"),
			[],
		);
	});

	it("lints a tab under spaces_per_tab: 1e9 at the cost of 1e3, its fix capped", () => {
		const under = (setting: number): string =>
			`<!-- markdownlint-configure-file {"MD010":{"spaces_per_tab":${setting}}} -->\n\n# T\n\n\tx\n`;
		const source = under(1e9);
		const findings = MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD010");
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings).split("\n")[4], `${" ".repeat(1_000)}x`);
		flatInSetting((setting) => () => MarkdownLint.lint(under(setting), rules), 1_000);
	});

	it("lints a sublist under indent: 1e9 at the cost of 1e3, its fix capped", () => {
		const under = (setting: number): string =>
			`<!-- markdownlint-configure-file {"MD007":{"indent":${setting}}} -->\n\n# T\n\n- a\n  - b\n`;
		const source = under(1e9);
		const findings = MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD007");
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings).split("\n")[5], `${" ".repeat(1_002)}- b`);
		flatInSetting((setting) => () => MarkdownLint.lint(under(setting), rules), 1_000);
	});

	it("lints a list under ul_single: 1e9 at the cost of 1e3, its fix capped", () => {
		const under = (setting: number): string =>
			`<!-- markdownlint-configure-file {"MD030":{"ul_single":${setting}}} -->\n\n# T\n\n- a\n`;
		const source = under(1e9);
		const findings = MarkdownLint.lint(source, rules).filter((finding) => finding.ruleNames[0] === "MD030");
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings).split("\n")[4], `-${" ".repeat(1_000)}a`);
		flatInSetting((setting) => () => MarkdownLint.lint(under(setting), rules), 1_000);
	});

	it("lints proper names under a list of 1,000 names, in time linear in the text", () => {
		const names = Array.from({ length: 1_000 }, (_, index) => `Name${index}`);
		const text = (lines: number): string =>
			`${Array.from({ length: lines }, (_, index) => `name${index % 1_000} and www.name${index}.com and \`name1\``).join("\n\n")}\n`;
		const config = { default: false, MD044: { names } };
		assert.isAbove(MarkdownLint.lint(text(2_000), rules, { config }).length, 0);
		linear((lines) => {
			const source = text(lines);
			return () => MarkdownLint.lint(source, rules, { config });
		}, 2_000);
	});

	it("lints a one-letter proper name matching 100,000 words, in time linear in the words", () => {
		const config = { default: false, MD044: { names: ["A", "A B"] } };
		assert.isAbove(MarkdownLint.lint(`${"a ".repeat(100_000)}\n`, rules, { config }).length, 0);
		linear((words) => {
			const source = `${"a ".repeat(words)}\n`;
			return () => MarkdownLint.lint(source, rules, { config });
		}, 100_000);
	});

	it("lints a heading under lines_above: 1e8 at the cost of 1e2, its fix capped", () => {
		const source = "text\n# T\n";
		const under = (setting: number) => ({ default: false, MD022: { lines_above: setting } });
		const findings = MarkdownLint.lint(source, rules, { config: under(1e8) });
		assert.lengthOf(findings, 1);
		assert.strictEqual(MarkdownLint.applyFixes(source, findings), `text\n${"\n".repeat(1_000)}# T\n`);
		flatInSetting((setting) => () => MarkdownLint.lint(source, rules, { config: under(setting) }), 100);
	});
});
