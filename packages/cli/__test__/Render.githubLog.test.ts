import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Block, RenderContext } from "../src/index.js";
import { Doc, Render, Status } from "../src/index.js";
import { neutralizeLines } from "../src/internal/renderGithubLog.js";
import { ESC, composite } from "./helpers/hostileDoc.js";
import { contextOf } from "./helpers/renderContext.js";

const log = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(contextOf(overrides), (ctx) => Render.githubLog(doc, ctx));
const plain = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(contextOf(overrides), (ctx) => Render.plain(doc, ctx));
/** The runner's own line breaks: it splits at a lone CR as well as at LF and CRLF. */
const LINE_BREAK = /\r\n|\r|\n/;

const linesOf = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(log(doc, overrides), (out) => out.split(LINE_BREAK));

/**
 * .NET's `Char.IsWhiteSpace`: what the runner's `TrimStart` removes before it looks for `::` or `##`. Written out from
 * that documented behaviour, not borrowed from the implementation. Note U+0085 is in it and U+200B and U+FEFF are not.
 */
const isDotNetWhitespace = (ch: string): boolean => {
	const code = ch.codePointAt(0) ?? 0;
	return (
		(code >= 0x09 && code <= 0x0d) ||
		code === 0x20 ||
		code === 0x85 ||
		code === 0xa0 ||
		code === 0x1680 ||
		(code >= 0x2000 && code <= 0x200a) ||
		code === 0x2028 ||
		code === 0x2029 ||
		code === 0x202f ||
		code === 0x205f ||
		code === 0x3000
	);
};

/** Would the runner read this line as a command: trim .NET whitespace, then `::` or a legacy `##` prefix. */
const isCommand = (line: string): boolean => {
	let i = 0;
	while (i < line.length && isDotNetWhitespace(line.charAt(i))) i++;
	const rest = line.slice(i);
	return rest.startsWith("::") || rest.startsWith("##");
};

describe("Render.githubLog: groups", () => {
	it.effect("a top-level collapsible is ::group:: title, its body, ::endgroup::", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([
				Doc.paragraph("before"),
				Doc.collapsible("Stack", [Doc.paragraph("frame one"), Doc.paragraph("frame two")]),
				Doc.paragraph("after"),
			]);
			assert.deepStrictEqual(out, ["before", "::group::Stack", "frame one", "frame two", "::endgroup::", "after"]);
		}),
	);

	it.effect("anything but a collapsible is what plain renders", () =>
		Effect.gen(function* () {
			const doc = [
				Doc.heading(1, "Title"),
				Doc.paragraph(Doc.status(Status.core, "failure"), " ", Doc.path("a", "b"), " ", Doc.code("x")),
				Doc.table([{ header: "a" }, { header: "b" }], [["1", "2"]]),
				Doc.list([Doc.paragraph("i")]),
				Doc.tree({ label: "r", children: [{ label: "c" }] }),
				Doc.callout("note", [Doc.paragraph("n")]),
				Doc.codeBlock("code"),
				Doc.diff("a", "b"),
				Doc.counts({
					counters: [Doc.counter(Status.core, "success", { key: "a", label: "ok", n: 1 })],
					layout: "inline",
				}),
			];
			assert.strictEqual(yield* log(doc), yield* plain(doc));
		}),
	);

	it.effect(
		"a nested collapsible flattens: GitHub does not nest groups, so its title is a line inside the outer group",
		() =>
			Effect.gen(function* () {
				const out = yield* linesOf([
					Doc.collapsible("Outer", [
						Doc.paragraph("a"),
						Doc.collapsible("Inner", [Doc.paragraph("b"), Doc.collapsible("Deep", [Doc.paragraph("c")])]),
						Doc.paragraph("d"),
					]),
				]);
				assert.deepStrictEqual(out, ["::group::Outer", "a", "Inner", "  b", "  Deep", "    c", "d", "::endgroup::"]);
				assert.strictEqual(out.filter((line) => line === "::endgroup::").length, 1);
				assert.strictEqual(out.filter((line) => line.startsWith("::group::")).length, 1);
			}),
	);

	it.effect(
		"sibling collapsibles are separate groups, in a section too, and a section's title and blank lines are plain's",
		() =>
			Effect.gen(function* () {
				const out = yield* linesOf([
					Doc.collapsible("One", [Doc.paragraph("1")]),
					Doc.section("Results", [Doc.paragraph("p"), Doc.collapsible("Two", [Doc.paragraph("2")])]),
				]);
				assert.deepStrictEqual(out, [
					"::group::One",
					"1",
					"::endgroup::",
					"Results",
					"",
					"p",
					"",
					"::group::Two",
					"2",
					"::endgroup::",
				]);
			}),
	);

	it.effect(
		"a collapsible that is not at the start of a line is not a group: in a list or callout it is plain's title and indented body",
		() =>
			Effect.gen(function* () {
				const nested = Doc.collapsible("Inside", [Doc.paragraph("body")]);
				const out = yield* linesOf([Doc.list([nested]), Doc.callout("note", [nested])]);
				assert.deepStrictEqual(out, ["- Inside", "    body", "NOTE: Inside", "        body"]);
				assert.isFalse(out.some((line) => line.includes("::group::")));
			}),
	);

	it.effect("an empty body is an open and a close, and the title is escaped like a command message", () =>
		Effect.gen(function* () {
			assert.deepStrictEqual(yield* linesOf([Doc.collapsible("T", [])]), ["::group::T", "::endgroup::"]);
			assert.deepStrictEqual(yield* linesOf([Doc.collapsible("100% ready\r\nnot a new line", [])]), [
				"::group::100%25 ready%0D%0Anot a new line",
				"::endgroup::",
			]);
			assert.deepStrictEqual(yield* linesOf([Doc.collapsible("", [Doc.paragraph("x")])]), [
				"::group::",
				"x",
				"::endgroup::",
			]);
		}),
	);
});

describe("Render.githubLog: document text cannot become a workflow command", () => {
	const hostileDoc = (): ReadonlyArray<Block> => [
		Doc.paragraph("::error::pwned"),
		Doc.paragraph("   ::warning file=a::pwned"),
		Doc.paragraph("##[error]pwned"),
		Doc.paragraph("##vso[task.setvariable variable=x]pwned"),
		Doc.heading(2, "::set-output name=x::y"),
		Doc.list([Doc.paragraph("::error::in a list")]),
		Doc.table([{ header: "::error::header" }], [["::error::cell"], ["##[group]cell"]]),
		Doc.codeBlock("::error::code\n  ::add-mask::secret"),
		Doc.tree({ label: "::error::root", children: [{ label: "::error::child" }] }),
		Doc.callout("warning", [Doc.paragraph("::error::in a callout")]),
		Doc.section("::error::section", [Doc.paragraph("::notice::child")]),
		Doc.collapsible("::error::title\n::error::second", [
			Doc.paragraph("::error::body"),
			Doc.codeBlock("::error::code"),
		]),
		Doc.counts({
			label: "::error::counts",
			counters: [Doc.counter(Status.core, "failure", { key: "f", label: "::error::n", n: 1 })],
			layout: "row",
		}),
		Doc.paragraph("one\n::error::after a newline"),
		Doc.paragraph("\u00A0::error::after a no-break space"),
		Doc.paragraph("\u3000##[error]after an ideographic space"),
		Doc.paragraph("\u2003::add-mask::after an em space"),
		Doc.paragraph("\u0085::error::after a next-line character"),
		Doc.counts({
			counters: [
				Doc.counter(Status.core, "failure", { key: "a", label: "\r::error::x", n: 1 }),
				Doc.counter(Status.core, "success", { key: "b", label: "ok\r\n::error::y", n: 2 }),
				Doc.counter(Status.core, "info", { key: "c", label: "\n##[error]z", n: 3 }),
			],
			layout: "inline",
		}),
		Doc.counts({
			counters: [Doc.counter(Status.core, "failure", { key: "a", label: "\r::error::x", n: 1 })],
			layout: "columns",
		}),
		Doc.counts({
			counters: [Doc.counter(Status.core, "failure", { key: "a", label: "\r::error::x", n: 1 })],
			layout: "row",
		}),
	];

	it.effect("no line but the renderer's own group commands starts with :: or ## (after its whitespace)", () =>
		Effect.gen(function* () {
			const out = yield* linesOf(hostileDoc());
			const commands = out.filter(isCommand);
			assert.deepStrictEqual(
				commands.filter((line) => !/^::(group::[^\r\n]*|endgroup::)$/.test(line)),
				[],
				"every command-looking line is a group or endgroup the renderer emitted",
			);
			assert.strictEqual(commands.filter((line) => line.startsWith("::group::")).length, 1);
			assert.strictEqual(commands.filter((line) => line === "::endgroup::").length, 1);
			assert.include(out.join("\n"), "pwned", "the text itself is kept");
		}),
	);

	it.effect("the group title holds no raw line break, so it cannot carry a second command", () =>
		Effect.gen(function* () {
			const out = yield* log([Doc.collapsible("a\n::error::b", [])]);
			assert.strictEqual(out, "::group::a%0A::error::b\n::endgroup::");
		}),
	);

	it.effect("the hostile composite has no escape and no command but its own", () =>
		Effect.gen(function* () {
			const out = yield* log(composite({ codeAndPath: true }));
			assert.notInclude(out, ESC);
			const commands = out.split(LINE_BREAK).filter(isCommand);
			assert.isTrue(
				commands.every((line) => /^::(group::|endgroup::)/.test(line)),
				JSON.stringify(commands),
			);
		}),
	);

	it.effect("a wrapped continuation line that starts with :: is neutralized too", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.paragraph("some words ::error::x then ::warning::y end")], { width: 12 });
			assert.isTrue(out.length > 2, "the paragraph wrapped");
			assert.deepStrictEqual(out.filter(isCommand), []);
			assert.isTrue(
				out.some((line) => line.includes("::error::x")),
				"the text is kept",
			);
		}),
	);

	it.effect(
		"a CR or CRLF in a counter label cannot start a line, in any Counts layout, and the counts stay one line",
		() =>
			Effect.gen(function* () {
				for (const label of ["\r::error::x", "a\r\n::error::x", "\n##[error]x", "x\r::error::y\r"]) {
					for (const layout of ["inline", "columns", "row"] as const) {
						const counts = Doc.counts({
							counters: [Doc.counter(Status.core, "failure", { key: "f", label, n: 1 })],
							layout,
						});
						const out = yield* linesOf([counts]);
						assert.deepStrictEqual(out.filter(isCommand), [], `${layout} ${JSON.stringify(label)}`);
						assert.strictEqual(out.length, 1, `${layout} ${JSON.stringify(label)}: one line`);
					}
				}
			}),
	);

	it("the neutralizer splits at a lone CR, LF and CRLF, as the runner does, and leaves the rest of each line alone", () => {
		const out = neutralizeLines(
			"a\r::error::x\r\n##[group]y\n  ::add-mask::z\rplain text\r\n\u00A0::warning::w\n\u0085::error::n",
		);
		assert.strictEqual(out.length, 7);
		assert.deepStrictEqual(out.filter(isCommand), []);
		assert.deepStrictEqual(
			out.map((line) => line.replace(/^\u200B/, "")),
			["a", "::error::x", "##[group]y", "  ::add-mask::z", "plain text", "\u00A0::warning::w", "\u0085::error::n"],
		);
		assert.deepStrictEqual(neutralizeLines("no command\nhere: ::"), ["no command", "here: ::"]);
	});

	it("the detector itself: it finds a command behind every .NET whitespace and not behind U+200B or BOM", () => {
		for (const ws of ["", " ", "\t", "\u00A0", "\u0085", "\u2003", "\u3000", "  \u00A0 "]) {
			assert.isTrue(isCommand(`${ws}::error::x`), JSON.stringify(ws));
			assert.isTrue(isCommand(`${ws}##[group]x`), JSON.stringify(ws));
		}
		for (const prefix of ["\u200B", "\uFEFF", "x", "- "])
			assert.isFalse(isCommand(`${prefix}::error::x`), JSON.stringify(prefix));
		assert.isFalse(isCommand("a :: b"));
		assert.isFalse(isCommand(": :error"));
	});

	it.effect("an ordinary line is left exactly as plain renders it, so only a command-looking one changes", () =>
		Effect.gen(function* () {
			const doc = [Doc.paragraph("a : b :: c ::"), Doc.paragraph("100% :: done"), Doc.paragraph("# not a command")];
			assert.strictEqual(yield* log(doc), yield* plain(doc));
		}),
	);
});
