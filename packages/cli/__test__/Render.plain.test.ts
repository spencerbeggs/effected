import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Block, RenderContext } from "../src/index.js";
import { Doc, Glyphs, Render, Status } from "../src/index.js";
import { displayWidth } from "../src/internal/displayWidth.js";
import { ESC, composite } from "./helpers/hostileDoc.js";
import { contextOf } from "./helpers/renderContext.js";

const plain = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(contextOf(overrides), (ctx) => Render.plain(doc, ctx));

const linesOf = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(plain(doc, overrides), (out) => out.split("\n"));

const BOX = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝]/;

describe("Render.plain: no escapes of any kind (Review Focus 2)", () => {
	for (const [name, overrides] of [
		["human audience, truecolor, hyperlinks available", {}],
		["agent audience", { audience: "agent" as const }],
		["ci audience", { audience: "ci" as const }],
		["ascii glyphs", { glyphs: Glyphs.ascii }],
	] as const) {
		it.effect(`${name}: no ESC, BEL or other control byte, whatever paint and link would have done`, () =>
			Effect.gen(function* () {
				const out = yield* plain(composite({ codeAndPath: true }), overrides);
				assert.notInclude(out, ESC);
				assert.notInclude(out, "\u0007");
				// Everything but line feeds: no control character remains, a tab included.
				// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence is the point
				assert.notMatch(out, /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/);
				assert.match(out, /red/, "the text around the escapes is kept");
				assert.match(out, /loneescape/);
			}),
		);
	}

	it.effect("paint and link are never called", () =>
		Effect.gen(function* () {
			const calls: Array<string> = [];
			const out = yield* plain(composite({ codeAndPath: true }), {
				paint: (_token, text) => {
					calls.push("paint");
					return `${ESC}[1m${text}${ESC}[0m`;
				},
				link: (_target, label) => {
					calls.push("link");
					return `${ESC}]8;;u\u0007${label}${ESC}]8;;\u0007`;
				},
			});
			assert.deepStrictEqual(calls, []);
			assert.notInclude(out, ESC);
		}),
	);
});

describe("Render.plain: inline content", () => {
	it.effect("a heading is its text alone, and code carries literal backticks", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([Doc.heading(2, ["Run ", Doc.code("pnpm test")])]), ["Run `pnpm test`"]);
			assert.deepStrictEqual(yield* linesOf([Doc.heading(1, "Title"), Doc.heading(4, "Sub")]), ["Title", "Sub"]);
		}),
	);

	it.effect("a path joins with ' > ' for any audience and either glyph set; a status is its glyph", () =>
		Effect.gen(function* () {
			const doc = [Doc.paragraph(Doc.status(Status.core, "failure"), " ", Doc.path("src", "a.test.ts", "suite"))];
			assert.deepStrictEqual(yield* linesOf(doc), ["✗ src > a.test.ts > suite"]);
			assert.deepStrictEqual(yield* linesOf(doc, { audience: "human" }), ["✗ src > a.test.ts > suite"]);
			assert.deepStrictEqual(yield* linesOf(doc, { glyphs: Glyphs.ascii }), ["[FAIL] src > a.test.ts > suite"]);
		}),
	);

	it.effect("a link is its label, plus the target in parentheses when the label differs from it", () =>
		Effect.gen(function* () {
			const url = "https://example.test/x";
			const out = yield* linesOf([
				Doc.paragraph(Doc.link({ url }, "docs")),
				Doc.paragraph(Doc.link({ url })),
				Doc.paragraph(Doc.link({ url }, url)),
				Doc.paragraph(Doc.link({ url }, [Doc.text("multi "), Doc.code("span")])),
			]);
			assert.deepStrictEqual(out, [`docs (${url})`, url, url, `multi \`span\` (${url})`]);
		}),
	);

	it.effect("a line break in a link target cannot split the suffix: the target is one line", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([
				Doc.paragraph(Doc.link({ url: "https://example.test/a\nb\r\nc" }, "docs")),
				Doc.paragraph(Doc.link({ file: "/repo/a\nb.ts", line: 3 }, "a")),
			]);
			assert.deepStrictEqual(out, ["docs (https://example.test/abc)", "a (/repo/ab.ts:3)"]);
		}),
	);

	it.effect("a file link shows path:line:col through displayPath; a column needs a line", () =>
		Effect.gen(function* () {
			const displayPath = (absolute: string) => absolute.replace("/repo/", "");
			const out = yield* linesOf(
				[
					Doc.paragraph(Doc.link({ file: "/repo/src/a.ts", line: 3, col: 5 }, "a.ts")),
					Doc.paragraph(Doc.link({ file: "/repo/src/a.ts", line: 3 }, "a.ts")),
					Doc.paragraph(Doc.link({ file: "/repo/src/a.ts" }, "a.ts")),
					Doc.paragraph(Doc.link({ file: "/repo/src/a.ts", col: 5 }, "a.ts")),
					Doc.paragraph(Doc.link({ file: "/repo/src/a.ts", line: 3 }, "src/a.ts:3")),
				],
				{ displayPath },
			);
			assert.deepStrictEqual(out, [
				"a.ts (src/a.ts:3:5)",
				"a.ts (src/a.ts:3)",
				"a.ts (src/a.ts)",
				"a.ts (src/a.ts)",
				"src/a.ts:3",
			]);
		}),
	);
});

describe("Render.plain: a status glyph from a vocabulary", () => {
	it.effect("is sanitized like any other text, so a vocabulary cannot smuggle an escape", () =>
		Effect.gen(function* () {
			const vocab = Status.extend({
				odd: {
					glyph: `${ESC}[31m!${ESC}[0m`,
					ascii: `[${ESC}]8;;u\u0007x${ESC}]8;;\u0007]`,
					token: "failure",
					rank: 50,
				},
			});
			const unicode = yield* linesOf([Doc.paragraph(Doc.status(vocab, "odd"), " text")]);
			assert.deepStrictEqual(unicode, ["! text"]);
			const ascii = yield* linesOf([Doc.paragraph(Doc.status(vocab, "odd"), " text")], { glyphs: Glyphs.ascii });
			assert.deepStrictEqual(ascii, ["[x] text"]);
		}),
	);
});

describe("Render.plain: paragraphs", () => {
	it.effect("wraps to the width, never truncates, and loses no words", () =>
		Effect.gen(function* () {
			const text = "the quick brown fox jumps over the lazy dog and keeps running past the old stone bridge";
			for (const width of [10, 17, 25, 40, 200]) {
				const out = yield* linesOf([Doc.paragraph(text)], { width });
				assert.strictEqual(out.join(" "), text, `width ${width}: same words in the same order`);
				for (const line of out) assert.isAtMost(displayWidth(line), width, `width ${width}: "${line}"`);
			}
		}),
	);

	it.effect("keeps a URL or path longer than the width whole, on a line of its own", () =>
		Effect.gen(function* () {
			const url = "https://example.test/a/very/long/path/that/exceeds";
			const out = yield* linesOf([Doc.paragraph(`see ${url} now`)], { width: 12 });
			assert.deepStrictEqual(out, ["see", url, "now"]);
		}),
	);

	it.effect("an empty paragraph is an empty line, and an empty document is the empty string", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* plain([]), "");
			assert.deepStrictEqual(yield* linesOf([Doc.paragraph()]), [""]);
		}),
	);

	it.effect("top-level blocks are consecutive lines", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([Doc.heading(1, "T"), Doc.paragraph("a"), Doc.paragraph("b")]), [
				"T",
				"a",
				"b",
			]);
		}),
	);
});

describe("Render.plain: lists", () => {
	it.effect("uses '- ' items, indents continuation lines, and nests", () =>
		Effect.gen(function* () {
			const out = yield* linesOf(
				[Doc.list([Doc.paragraph("one two three four"), Doc.list([Doc.paragraph("inner")]), Doc.paragraph("last")])],
				{ width: 12 },
			);
			assert.deepStrictEqual(out, ["- one two", "  three four", "- - inner", "- last"]);
		}),
	);

	it.effect(
		"a cap shows that many items and then the overflow row; without an overflow function the row is a default",
		() =>
			Effect.gen(function* () {
				const items = ["a", "b", "c", "d"].map((t) => Doc.paragraph(t));
				assert.deepStrictEqual(yield* linesOf([Doc.list(items, { cap: 2 })]), ["- a", "- b", "… 2 more"]);
				assert.deepStrictEqual(yield* linesOf([Doc.list(items, { cap: 2 })], { glyphs: Glyphs.ascii }), [
					"- a",
					"- b",
					"... 2 more",
				]);
				assert.deepStrictEqual(
					yield* linesOf([
						Doc.list(items, { cap: 1, overflow: (hidden) => [`… ${hidden} more (see `, Doc.code("tool"), ")"] }),
					]),
					["- a", "… 3 more (see `tool`)"],
				);
				assert.deepStrictEqual(
					yield* linesOf([Doc.list(items, { cap: 4 })]),
					["- a", "- b", "- c", "- d"],
					"a cap that is not exceeded adds no row",
				);
				assert.deepStrictEqual(yield* linesOf([Doc.list(items, { cap: 0 })]), ["… 4 more"]);
			}),
	);
});

describe("Render.plain: tables", () => {
	const table = (align?: "left" | "right" | "center") =>
		Doc.table(
			[{ header: "Name" }, { header: "Count", ...(align === undefined ? {} : { align }) }],
			[
				["alpha", "1"],
				["b", "1234"],
			],
		);

	it.effect("aligns text columns to the widest cell, with a rule under the header and no box drawing", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([table()]);
			assert.deepStrictEqual(out, ["Name   Count", "-----  -----", "alpha  1", "b      1234"]);
			for (const line of out) assert.notMatch(line, BOX);
		}),
	);

	it.effect("honours align, per column, in the header and the cells", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([table("right")]), [
				"Name   Count",
				"-----  -----",
				"alpha      1",
				"b       1234",
			]);
			assert.deepStrictEqual(yield* linesOf([table("center")]), [
				"Name   Count",
				"-----  -----",
				"alpha    1",
				"b      1234",
			]);
		}),
	);

	it.effect("measures display width, so wide characters keep the columns aligned", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([
				Doc.table(
					[{ header: "k" }, { header: "v" }],
					[
						["日本", "1"],
						["ab", "2"],
					],
				),
			]);
			const valueColumns = out.slice(2).map((line) => displayWidth(line.slice(0, line.lastIndexOf(" ") + 1)));
			assert.strictEqual(new Set(valueColumns).size, 1, "both rows put the second column at the same display column");
		}),
	);

	it.effect("pads a short row with empty cells, and widens the table for a row longer than its columns", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.table([{ header: "a" }, { header: "b" }], [["1"], ["1", "2", "3"]])]);
			assert.deepStrictEqual(out, ["a  b", "-  -  -", "1", "1  2  3"]);
		}),
	);

	it.effect("has no header or rule when no column has a header, and never trailing spaces", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([
				Doc.table(
					[{ header: [] }, { header: [] }],
					[
						["a", ""],
						["bbb", "x"],
					],
				),
			]);
			assert.deepStrictEqual(out, ["a", "bbb  x"]);
			for (const line of yield* linesOf([table()])) assert.strictEqual(line, line.trimEnd());
		}),
	);

	it.effect("a cap shows that many rows, then the overflow row", () =>
		Effect.gen(function* () {
			const rows = [["1"], ["2"], ["3"]];
			const out = yield* linesOf([
				Doc.table([{ header: "n" }], rows, { cap: 1, overflow: (hidden) => `${hidden} hidden` }),
			]);
			assert.deepStrictEqual(out, ["n", "-", "1", "2 hidden"]);
		}),
	);

	it.effect("truncates cells only when the table exceeds the width, shrinking the widest column first", () =>
		Effect.gen(function* () {
			const wide = Doc.table(
				[{ header: "id" }, { header: "message" }, { header: "where" }],
				[["1", "a very long message that goes on and on", "src/x.ts"]],
			);
			const fits = yield* linesOf([wide], { width: 200 });
			assert.notMatch(fits.join("\n"), /…/, "it fits, so nothing is cut");

			const cut = yield* linesOf([wide], { width: 40 });
			for (const line of cut) assert.isAtMost(displayWidth(line), 40);
			const cells = cut[2]?.split(/ {2,}/) ?? [];
			assert.strictEqual(cells[0], "1", "the narrow columns are untouched");
			assert.strictEqual(cells[2], "src/x.ts");
			assert.match(cells[1] ?? "", /…$/, "the widest column is the one cut");
		}),
	);

	it.effect("a cell holding line breaks shows its first line and an ellipsis, so every row stays one line", () =>
		Effect.gen(function* () {
			const doc = Doc.table(
				[{ header: "what" }, { header: "where" }],
				[
					["first\nsecond\nthird", "a.ts"],
					["one\r\ntwo", "b.ts"],
					["\nleading", "c.ts"],
					["trailing\n\n", "d.ts"],
					["plain", "e.ts"],
				],
			);
			const out = yield* linesOf([doc]);
			assert.deepStrictEqual(out, [
				"what      where",
				"--------  -----",
				"first…    a.ts",
				"one…      b.ts",
				"…         c.ts",
				"trailing  d.ts",
				"plain     e.ts",
			]);
			const ascii = yield* linesOf([doc], { glyphs: Glyphs.ascii });
			assert.strictEqual(ascii[2], "first...  a.ts");
		}),
	);

	it.effect("a cell that has a line break and is then too wide is cut after taking its first line", () =>
		Effect.gen(function* () {
			const doc = Doc.table([{ header: "msg" }, { header: "id" }], [["a rather long first line\nsecond", "1"]]);
			const out = yield* linesOf([doc], { width: 12 });
			assert.strictEqual(out.length, 3);
			for (const line of out) assert.isAtMost(displayWidth(line), 12);
			assert.match(out[2] ?? "", /^a rathe…/);
			assert.notInclude(out.join("\n"), "second");
		}),
	);

	it.effect("a tie between the widest columns shrinks the left one first", () =>
		Effect.gen(function* () {
			const doc = Doc.table([{ header: "x" }, { header: "y" }], [["aaaaaaaaaa", "bbbbbbbbbb"]]);
			const out = yield* linesOf([doc], { width: 21 });
			assert.strictEqual(out[2], "aaaaaaaa…  bbbbbbbbbb");
			for (const line of out) assert.isAtMost(displayWidth(line), 21);
		}),
	);

	it.effect("a header wider than its cells sets the column width", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.table([{ header: "description" }, { header: "n" }], [["a", "1"]])]);
			assert.deepStrictEqual(out, ["description  n", "-----------  -", `a${" ".repeat(12)}1`]);
		}),
	);

	it.effect("a wide (CJK) cell is cut on a whole character, by display width", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.table([{ header: "k" }, { header: "v" }], [["日本語日本語", "1"]])], {
				width: 10,
			});
			assert.strictEqual(out[2], "日本語…  1");
			for (const line of out) assert.isAtMost(displayWidth(line), 10);
		}),
	);

	it.effect(
		"a table nested in a list, collapsible or callout stays within the context width, not just the indent-free one",
		() =>
			Effect.gen(function* () {
				const wide = Doc.table(
					[{ header: "id" }, { header: "message" }, { header: "where" }],
					[["1", "a very long message that goes on and on and on", "src/some/long/path.ts"]],
				);
				const placements: ReadonlyArray<readonly [string, Block]> = [
					["top level", wide],
					["list", Doc.list([wide])],
					["collapsible", Doc.collapsible("details", [wide])],
					["callout", Doc.callout("warning", [wide])],
					["list in a collapsible in a callout", Doc.callout("note", [Doc.collapsible("d", [Doc.list([wide])])])],
				];
				for (const [name, block] of placements) {
					const out = yield* linesOf([block], { width: 30 });
					for (const line of out) assert.isAtMost(displayWidth(line), 30, `${name}: "${line}"`);
				}
			}),
	);

	it.effect("a column that is empty in every row keeps its separators, so rows stay under their rule", () =>
		Effect.gen(function* () {
			const first = yield* linesOf([
				Doc.table(
					[{ header: [] }, { header: "b" }],
					[
						["", "1"],
						["", "22"],
					],
				),
			]);
			assert.deepStrictEqual(first, ["  b", "  --", "  1", "  22"]);
			const middle = yield* linesOf([
				Doc.table(
					[{ header: "a" }, { header: [] }, { header: "c" }],
					[
						["1", "", "3"],
						["2", "", "4"],
					],
				),
			]);
			assert.deepStrictEqual(middle, ["a    c", "-    -", "1    3", "2    4"]);
			const right = yield* linesOf([Doc.table([{ header: [] }, { header: "x y z", align: "right" }], [["", "1"]])]);
			assert.deepStrictEqual(right, ["  x y z", "  -----", "      1"]);
		}),
	);

	it.effect("never cuts below one column per cell, even when nothing fits", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.table([{ header: "a" }, { header: "b" }], [["xxxxxx", "yyyyyy"]])], { width: 3 });
			assert.isAbove(out.length, 0);
			assert.isTrue(out.every((line) => displayWidth(line) <= 4));
		}),
	);
});

describe("Render.plain: trees", () => {
	const tree = Doc.tree({
		label: "root",
		children: [{ label: "a", children: [{ label: "a1" }, { label: "a2" }] }, { label: "b" }],
	});

	it.effect("draws with the glyph set's segments: unicode", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([tree]), ["root", "├─ a", "│  ├─ a1", "│  └─ a2", "└─ b"]);
		}),
	);

	it.effect("draws with the glyph set's segments: ascii", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([tree], { glyphs: Glyphs.ascii });
			assert.deepStrictEqual(out, ["root", "|-- a", "|   |-- a1", "|   \\-- a2", "\\-- b"]);
			for (const line of out) assert.isTrue([...line].every((ch) => (ch.codePointAt(0) ?? 0) < 128));
		}),
	);

	it.effect("a lone root is just its label", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([Doc.tree({ label: "only" })]), ["only"]);
		}),
	);
});

describe("Render.plain: collapsible, callout, code and diff", () => {
	it.effect("a collapsible is its title line, then the body indented", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.collapsible("Stack", [Doc.paragraph("frame one"), Doc.codeBlock("a\nb")])]);
			assert.deepStrictEqual(out, ["Stack", "  frame one", "      a", "      b"]);
		}),
	);

	it.effect("a callout is its upper-case kind, then the body", () =>
		Effect.gen(function* () {
			for (const kind of ["note", "tip", "important", "warning", "caution"] as const) {
				const out = yield* linesOf([Doc.callout(kind, [Doc.paragraph("careful")])]);
				assert.deepStrictEqual(out, [`${kind.toUpperCase()}: careful`]);
			}
			assert.deepStrictEqual(yield* linesOf([Doc.callout("warning", [Doc.paragraph("one"), Doc.paragraph("two")])]), [
				"WARNING: one",
				"         two",
			]);
			assert.deepStrictEqual(yield* linesOf([Doc.callout("note", [])]), ["NOTE:"]);
		}),
	);

	it.effect("a code block is indented four spaces, blank lines stay empty, no fence", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.codeBlock("let a = 1;\n\nlet b = 2;\n", "ts")]);
			assert.deepStrictEqual(out, ["    let a = 1;", "", "    let b = 2;"]);
			assert.notInclude(out.join("\n"), "```");
		}),
	);

	it.effect("a diff is '- expected' lines then '+ received' lines, and a cap limits each side", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([Doc.diff("a\nb", "a\nc")]), ["- a", "- b", "+ a", "+ c"]);
			assert.deepStrictEqual(yield* linesOf([Doc.diff("1\n2\n3\n4", "x\ny", { cap: 2 })]), [
				"- 1",
				"- 2",
				"  … 2 more lines",
				"+ x",
				"+ y",
			]);
		}),
	);
});

describe("Render.plain: Counts", () => {
	const counters = [
		Doc.counter(Status.core, "success", { key: "ok", label: "passed", n: 3 }),
		Doc.counter(Status.core, "failure", { key: "bad", label: "failed", n: 1 }),
		Doc.counter(Status.core, "skip", { key: "skip", label: "skipped", n: 1 }),
		Doc.counter(Status.core, "pending", { key: "todo", label: "todo", n: 0 }),
	];

	it.effect(
		"inline: the first counter shows its share of the total, zero counters are hidden, then qualifier and duration",
		() =>
			Effect.gen(function* () {
				const out = yield* linesOf([Doc.counts({ counters, durationMs: 1200, layout: "inline" })]);
				assert.deepStrictEqual(out, ["3/5 passed, 1 failed, 1 skipped (1.2s)"]);
				assert.deepStrictEqual(
					yield* linesOf([Doc.counts({ label: "Widgets", counters, qualifier: "(1 flaky)", layout: "inline" })]),
					["Widgets: 3/5 passed, 1 failed, 1 skipped (1 flaky)"],
				);
			}),
	);

	it.effect("a counter that asks for showZero stays visible", () =>
		Effect.gen(function* () {
			const shown = [
				...counters.slice(0, 2),
				Doc.counter(Status.core, "pending", { key: "todo", label: "todo", n: 0, showZero: true }),
			];
			assert.deepStrictEqual(yield* linesOf([Doc.counts({ counters: shown, layout: "inline" })]), [
				"3/4 passed, 1 failed, 0 todo",
			]);
		}),
	);

	it.effect("the total comes from Doc.total: the caller's rule replaces the sum", () =>
		Effect.gen(function* () {
			const node = Doc.counts({ counters, total: () => 99, layout: "inline" });
			assert.strictEqual(Doc.total(node), 99);
			assert.deepStrictEqual(yield* linesOf([node]), ["3/99 passed, 1 failed, 1 skipped"]);
			const excludingSkips = Doc.counts({
				counters,
				total: (all) => all.filter((c) => c.key !== "skip").reduce((sum, c) => sum + c.n, 0),
				layout: "inline",
			});
			assert.deepStrictEqual(yield* linesOf([excludingSkips]), ["3/4 passed, 1 failed, 1 skipped"]);
		}),
	);

	it.effect("columns: aligned label and number pairs, numbers right-aligned, then qualifier and duration", () =>
		Effect.gen(function* () {
			const wide = [...counters.slice(0, 3), Doc.counter(Status.core, "info", { key: "n", label: "noted", n: 120 })];
			assert.deepStrictEqual(yield* linesOf([Doc.counts({ label: "Summary", counters: wide, layout: "columns" })]), [
				"Summary",
				"passed     3",
				"failed     1",
				"skipped    1",
				"noted    120",
			]);
			assert.deepStrictEqual(
				yield* linesOf([
					Doc.counts({ counters: counters.slice(0, 2), qualifier: "flaky", durationMs: 250, layout: "columns" }),
				]),
				["passed  3", "failed  1", "flaky", "250ms"],
			);
		}),
	);

	it.effect("row: one line of cells", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.counts({ label: "Widgets", counters, durationMs: 61000, layout: "row" })]);
			assert.deepStrictEqual(out, ["Widgets  3/5 passed  1 failed  1 skipped  1m 1s"]);
		}),
	);

	it.effect("no counter words come from the kit: only the node's own labels appear", () =>
		Effect.gen(function* () {
			const node = Doc.counts({
				counters: [Doc.counter(Status.core, "success", { key: "k", label: "frobs", n: 2 })],
				layout: "inline",
			});
			assert.deepStrictEqual(yield* linesOf([node]), ["2/2 frobs"]);
		}),
	);
});

describe("Render.plain: sections", () => {
	it.effect("a section is its title, then its children, separated by blank lines", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([
				Doc.section("Results", [
					Doc.paragraph("one"),
					Doc.list([Doc.paragraph("a")]),
					Doc.section(undefined, [Doc.paragraph("deep")]),
				]),
				Doc.paragraph("after"),
			]);
			assert.deepStrictEqual(out, ["Results", "", "one", "", "- a", "", "deep", "after"]);
		}),
	);
});

describe("Render.plain: a failure row built from nodes (the vitest-agent composition)", () => {
	it.effect("lines carry the ' > '-joined path, the classification, the diff lines and an indented stack", () =>
		Effect.gen(function* () {
			const row = Doc.section(undefined, [
				Doc.paragraph(
					Doc.status(Status.core, "failure"),
					" ",
					Doc.path("packages/cli", "__test__/Doc.test.ts", "Doc", "freezes nodes"),
					" ",
					Doc.text("[assertion]", "muted"),
				),
				Doc.diff("expected value\nsecond line", "received value\nsecond line"),
				Doc.collapsible("stack", [
					Doc.paragraph(Doc.link({ file: "/repo/src/Doc.ts", line: 12, col: 3 }, "Doc.ts")),
					Doc.codeBlock("at freeze (src/Doc.ts:12:3)"),
				]),
			]);
			const out = yield* linesOf([row], { displayPath: (p) => p.replace("/repo/", "") });

			const head = out.find((line) => line.includes(" > "));
			assert.isDefined(head);
			assert.include(head ?? "", "packages/cli > __test__/Doc.test.ts > Doc > freezes nodes");
			assert.include(head ?? "", "[assertion]");
			assert.isTrue((head ?? "").startsWith("✗"));

			assert.includeMembers(out, ["- expected value", "- second line", "+ received value", "+ second line"]);
			const diffAt = out.indexOf("- expected value");
			assert.isAbove(diffAt, out.indexOf(head ?? ""), "the diff follows the row head");

			const stackAt = out.indexOf("stack");
			assert.isAbove(stackAt, diffAt);
			assert.isTrue(
				out.slice(stackAt + 1).every((line) => line === "" || line.startsWith("  ")),
				"the stack body is indented",
			);
			assert.isTrue(
				out.some((line) => line.includes("Doc.ts (src/Doc.ts:12:3)")),
				"the frame link reads label and path:line:col",
			);
			assert.notInclude(out.join("\n"), ESC);
		}),
	);
});
