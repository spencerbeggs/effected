import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Block, RenderContext } from "../src/index.js";
import { Doc, Glyphs, Render, Status, Token } from "../src/index.js";
import { displayWidth } from "../src/internal/displayWidth.js";
import { contextOf } from "./helpers/renderContext.js";

const plain = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(contextOf(overrides), (ctx) => Render.plain(doc, ctx));

const linesOf = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(plain(doc, overrides), (out) => out.split("\n"));

const BOX = /[─│┌┐└┘├┤┬┴┼═║╔╗╚╝]/;
const ESC = "\u001B";

describe("Render.plain: no escapes of any kind (Review Focus 2)", () => {
	// User text that CONTAINS escape bytes in every place a string can enter a document.
	const SGR = `${ESC}[31mred${ESC}[0m`;
	const OSC = `${ESC}]8;;https://evil.test\u0007click${ESC}]8;;\u0007`;
	const LONE = `lone${ESC}escape`;
	const BELL = "bell\u0007";

	const composite = (): ReadonlyArray<Block> => {
		const vocab = Status.core;
		return [
			Doc.heading(1, [SGR, Doc.code(OSC)]),
			Doc.paragraph(
				Doc.status(vocab, "failure"),
				" ",
				Doc.text(SGR, "failure"),
				" ",
				Doc.text(LONE, Token.style({ bold: true, fg: "#ff0000" })),
				" ",
				Doc.path(SGR, LONE, BELL),
				" ",
				Doc.link({ url: `https://x.test/${LONE}` }, [Doc.text(OSC, "info")]),
				" ",
				Doc.link({ file: `/repo/${SGR}.ts`, line: 3, col: 4 }, LONE),
			),
			Doc.list([Doc.paragraph(SGR)], { cap: 0, overflow: (hidden) => [`${hidden} ${OSC}`] }),
			Doc.table([{ header: SGR }, { header: LONE, align: "right" }], [[OSC, BELL]]),
			Doc.tree({ label: SGR, children: [{ label: [Doc.code(LONE)] }] }),
			Doc.collapsible(OSC, [Doc.paragraph(BELL)], { open: true }),
			Doc.callout("warning", [Doc.paragraph(SGR)]),
			Doc.codeBlock(`${SGR}\n${LONE}\n${OSC}`, "ts"),
			Doc.diff(`${SGR}\n${LONE}`, `${OSC}\n${BELL}`),
			Doc.section(SGR, [
				Doc.counts({
					label: SGR,
					counters: [
						Doc.counter(vocab, "failure", { key: "f", label: `fail ${SGR}`, n: 2 }),
						Doc.counter(vocab, "success", { key: "p", label: LONE, n: 3 }),
					],
					qualifier: OSC,
					durationMs: 1234,
					layout: "inline",
				}),
				Doc.counts({ counters: [Doc.counter(vocab, "failure", { key: "f", label: OSC, n: 1 })], layout: "columns" }),
				Doc.counts({ counters: [Doc.counter(vocab, "failure", { key: "f", label: BELL, n: 1 })], layout: "row" }),
			]),
		];
	};

	for (const [name, overrides] of [
		["human audience, truecolor, hyperlinks available", {}],
		["agent audience", { audience: "agent" as const }],
		["ci audience", { audience: "ci" as const }],
		["ascii glyphs", { glyphs: Glyphs.ascii }],
	] as const) {
		it.effect(`${name}: no ESC, BEL or other control byte, whatever paint and link would have done`, () =>
			Effect.gen(function* () {
				const out = yield* plain(composite(), overrides);
				assert.notInclude(out, ESC);
				assert.notInclude(out, "\u0007");
				// Everything but line feeds and tabs: no control characters remain.
				// biome-ignore lint/suspicious/noControlCharactersInRegex: asserting their absence is the point
				assert.notMatch(out, /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/);
				assert.match(out, /red/, "the text around the escapes is kept");
				assert.match(out, /loneescape/);
			}),
		);
	}

	it.effect("paint and link are never called", () =>
		Effect.gen(function* () {
			const calls: Array<string> = [];
			const out = yield* plain(composite(), {
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
