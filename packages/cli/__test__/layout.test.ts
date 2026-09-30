import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Inline, RenderContext } from "../src/index.js";
import { CliTheme, Doc, Glyphs, Status } from "../src/index.js";
import { displayWidth, graphemes, stripAnsi } from "../src/internal/displayWidth.js";
import type { Span } from "../src/internal/layout.js";
import { flatten, paintSpans, truncateSpans, widthOf, wrapSpans } from "../src/internal/layout.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: an OSC 8 hyperlink starts with ESC and ends with BEL or ST
const OSC8 = /\u001B\]8;[^;\u0007\u001B]*;([^\u0007\u001B]*)(?:\u0007|\u001B\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: an SGR sequence starts with ESC
const SGR = /\u001B\[([0-9;]*)m/g;

/** A link stub: a fixed OSC 8 wrapper. The real policy arrives with CliLinks. */
const link = (target: { readonly url: string } | { readonly file: string }, label: string): string =>
	`\u001B]8;;${"url" in target ? target.url : `file://${target.file}`}\u0007${label}\u001B]8;;\u0007`;

const contextOf = (overrides: Partial<RenderContext> = {}): Effect.Effect<RenderContext> =>
	Effect.gen(function* () {
		const theme = yield* CliTheme;
		const ctx: RenderContext = {
			width: 80,
			audience: "human",
			color: theme.color,
			paint: theme.paint,
			glyphs: theme.glyphs,
			link,
			displayPath: (absolute: string) => absolute,
			...overrides,
		};
		return ctx;
	}).pipe(Effect.provide(CliTheme.layerTest({ color: "truecolor" })));

/** Replays SGR by its meaning: every closer must close something open, and nothing may stay open. */
const sgrProblems = (text: string): ReadonlyArray<string> => {
	const problems: Array<string> = [];
	const active = new Set<string>();
	const closes: Record<string, string> = { "39": "fg", "22": "weight", "23": "italic", "24": "underline", "49": "bg" };
	for (const match of text.matchAll(SGR)) {
		const param = match[1] ?? "";
		if (param === "" || param === "0") {
			active.clear();
		} else if (param in closes) {
			const kind = closes[param] as string;
			if (!active.delete(kind)) problems.push(`stray closer ${param}`);
		} else if (param === "1" || param === "2") active.add("weight");
		else if (param === "3") active.add("italic");
		else if (param === "4") active.add("underline");
		else active.add("fg");
	}
	if (active.size > 0) problems.push(`left open: ${[...active].join(",")}`);
	return problems;
};

/** The hyperlinks of a string, in order: a non-empty target opens one, an empty target closes it. */
const linksOf = (text: string): { readonly pairs: number; readonly wrapped: string; readonly balanced: boolean } => {
	let open = false;
	let pairs = 0;
	let balanced = true;
	let wrapped = "";
	let last = 0;
	for (const match of text.matchAll(OSC8)) {
		const before = text.slice(last, match.index);
		if (open) wrapped += before;
		last = (match.index ?? 0) + match[0].length;
		if ((match[1] ?? "") !== "") {
			if (open) balanced = false;
			open = true;
			pairs++;
		} else {
			if (!open) balanced = false;
			open = false;
		}
	}
	return { pairs, wrapped: stripAnsi(wrapped), balanced: balanced && !open };
};

const CASES: ReadonlyArray<readonly [string, string]> = [
	["ascii", "a long coloured linked label"],
	["CJK", "日本語のラベルです長い"],
	["ZWJ family", "👨‍👩‍👧‍👦👨‍👩‍👧‍👦👨‍👩‍👧‍👦 team"],
	["combining marks", "café résumé née"],
	["flag and skin tone", "🇯🇵🇫🇷 👍🏽 ok"],
];

describe("flatten", () => {
	it.effect("turns a Path into its segments joined by the audience's separator", () =>
		Effect.gen(function* () {
			const human = yield* contextOf();
			assert.strictEqual(
				flatten([Doc.path("a", "b", "c")], human)
					.map((s) => s.text)
					.join(""),
				"a › b › c",
			);
			const agent = yield* contextOf({ audience: "agent" });
			assert.strictEqual(
				flatten([Doc.path("a", "b", "c")], agent)
					.map((s) => s.text)
					.join(""),
				"a > b > c",
			);
			const ascii = yield* contextOf({ glyphs: Glyphs.ascii });
			assert.strictEqual(
				flatten([Doc.path("a", "b")], ascii)
					.map((s) => s.text)
					.join(""),
				"a > b",
			);
			assert.strictEqual(
				flatten([Doc.path("only")], human)
					.map((s) => s.text)
					.join(""),
				"only",
			);
		}),
	);

	it.effect("turns a StatusMark into the glyph of the context's set, painted with the definition's token", () =>
		Effect.gen(function* () {
			const mark = Doc.status(Status.core, "failure");
			const unicode = yield* contextOf();
			assert.deepStrictEqual(flatten([mark], unicode), [{ text: "✗", token: "failure" }]);
			const ascii = yield* contextOf({ glyphs: Glyphs.ascii });
			assert.deepStrictEqual(flatten([mark], ascii), [{ text: "[FAIL]", token: "failure" }]);
		}),
	);

	it.effect("keeps a token, marks Code, and gives every span of a Link label the same link", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf();
			const target = { file: "src/a.ts", line: 3 };
			const spans = flatten(
				[Doc.text("x", "muted"), Doc.code("c"), Doc.link(target, [Doc.text("a", "info"), Doc.code("b")])],
				ctx,
			);
			assert.deepStrictEqual(spans, [
				{ text: "x", token: "muted" },
				{ text: "c", code: true },
				{ text: "a", token: "info", link: target },
				{ text: "b", code: true, link: target },
			]);
			assert.strictEqual(spans[2]?.link, spans[3]?.link, "one link, so one hyperlink when painted");
		}),
	);

	it.effect("drops escape sequences and empty spans from content", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf();
			const spans = flatten(
				[Doc.text("\u001B[31mred\u001B[0m"), Doc.text(""), Doc.code("\u001B]8;;u\u0007c\u001B]8;;\u0007")],
				ctx,
			);
			assert.deepStrictEqual(spans, [{ text: "red" }, { text: "c", code: true }]);
		}),
	);
});

describe("widthOf", () => {
	it("sums the display width of every span", () => {
		assert.strictEqual(widthOf([]), 0);
		assert.strictEqual(widthOf([{ text: "ab" }, { text: "日本", token: "info" }, { text: "👨‍👩‍👧‍👦" }]), 2 + 4 + 2);
	});
});

describe("truncateSpans: a coloured, linked label wider than the width (Review Focus 1)", () => {
	for (const [name, label] of CASES) {
		it.effect(
			`${name}: every width gives at most that many columns, balanced SGR, one intact link, whole graphemes`,
			() =>
				Effect.gen(function* () {
					const ctx = yield* contextOf();
					const target = { url: "https://example.test/x" };
					// Two spans under one link, in different styles, so a cut can land in either.
					const cut = Math.max(1, Math.floor(graphemes(label).length / 2));
					const first = graphemes(label).slice(0, cut).join("");
					const rest = graphemes(label).slice(cut).join("");
					const spans = flatten([Doc.link(target, [Doc.text(first, "failure"), Doc.text(rest, { bold: true })])], ctx);
					const total = widthOf(spans);
					assert.isAbove(total, 6, "the case is wider than the smallest width tried");

					for (let width = 0; width <= total + 2; width++) {
						const out = truncateSpans(spans, width, "…");
						const painted = paintSpans(out, ctx);
						const where = `${name} at width ${width}`;

						assert.isAtMost(displayWidth(painted), width, `${where}: within the width`);
						assert.deepStrictEqual(sgrProblems(painted), [], `${where}: SGR balanced`);

						const links = linksOf(painted);
						assert.isTrue(links.balanced, `${where}: hyperlink opened and closed`);
						const plain = stripAnsi(painted);
						if (plain === "") {
							assert.strictEqual(links.pairs, 0, `${where}: nothing kept, nothing linked`);
							continue;
						}
						assert.strictEqual(links.pairs, 1, `${where}: exactly one OSC 8 pair`);
						assert.strictEqual(links.wrapped, plain, `${where}: the pair wraps all of the kept text`);

						// Whole graphemes: what is kept, less the marker, is a prefix made of whole source graphemes.
						const original = graphemes(label);
						const kept = width >= total ? plain : plain.endsWith("…") ? plain.slice(0, -1) : plain;
						let prefix = "";
						let matched = kept === "";
						for (const g of original) {
							prefix += g;
							if (prefix === kept) matched = true;
						}
						assert.isTrue(matched, `${where}: "${kept}" is a prefix of whole graphemes of "${label}"`);
					}
				}),
		);
	}

	it.effect("text that already fits is returned unchanged", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf();
			const spans = flatten([Doc.text("abc", "info")], ctx);
			assert.strictEqual(truncateSpans(spans, 3, "…"), spans);
			assert.strictEqual(truncateSpans(spans, 10, "…"), spans);
		}),
	);

	it("marks the cut with the ellipsis inside the last kept span, and omits one that cannot fit", () => {
		const spans: ReadonlyArray<Span> = [{ text: "hello", token: "info" }];
		assert.deepStrictEqual(truncateSpans(spans, 4, "…"), [{ text: "hel…", token: "info" }]);
		assert.deepStrictEqual(truncateSpans(spans, 4, "..."), [{ text: "h...", token: "info" }]);
		assert.deepStrictEqual(truncateSpans(spans, 2, "..."), [{ text: "he", token: "info" }], "the marker cannot fit");
		assert.deepStrictEqual(truncateSpans(spans, 0, "…"), []);
		assert.deepStrictEqual(truncateSpans(spans, -3, "…"), []);
	});

	it("a wide character that would straddle the edge is dropped whole", () => {
		const spans: ReadonlyArray<Span> = [{ text: "日本語" }];
		const cut = (width: number, ellipsis: string) =>
			truncateSpans(spans, width, ellipsis)
				.map((s) => s.text)
				.join("");
		assert.strictEqual(cut(5, "…"), "日本…", "2 + 2 + 1 fits exactly");
		assert.strictEqual(cut(4, "…"), "日…", "the second wide character would pass the edge");
		assert.strictEqual(cut(4, ""), "日本");
		assert.strictEqual(cut(3, ""), "日", "a half-width gap is left rather than splitting the next character");
	});

	it("an ellipsis after a Code span is not inside the code, and keeps the link", () => {
		const target = { url: "u" };
		const spans: ReadonlyArray<Span> = [{ text: "codecode", code: true, link: target }];
		const out = truncateSpans(spans, 5, "…");
		assert.deepStrictEqual(out, [
			{ text: "code", code: true, link: target },
			{ text: "…", link: target },
		]);
	});

	it("when only the marker fits it stands for the label, so it keeps the first span's token and link", () => {
		const target = { url: "u" };
		const out = truncateSpans([{ text: "label", token: "failure", link: target }, { text: "more" }], 1, "…");
		assert.deepStrictEqual(out, [{ text: "…", token: "failure", link: target }]);
	});

	it("cuts across spans and drops the spans after the cut", () => {
		const out = truncateSpans(
			[{ text: "ab", token: "info" }, { text: "cd", token: "failure" }, { text: "ef" }],
			4,
			"…",
		);
		assert.deepStrictEqual(out, [
			{ text: "ab", token: "info" },
			{ text: "c…", token: "failure" },
		]);
	});
});

describe("paintSpans", () => {
	it.effect("paints each span, and wraps the spans of one Link in a single hyperlink", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf();
			const target = { url: "https://example.test" };
			const painted = paintSpans(
				flatten([Doc.text("a "), Doc.link(target, [Doc.text("b", "failure"), Doc.code("c")]), Doc.text(" d")], ctx),
				ctx,
			);
			assert.strictEqual(stripAnsi(painted), "a bc d");
			assert.deepStrictEqual(sgrProblems(painted), []);
			const links = linksOf(painted);
			assert.strictEqual(links.pairs, 1);
			assert.strictEqual(links.wrapped, "bc");
		}),
	);

	it.effect("two separate links stay two hyperlinks", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf();
			const inlines: ReadonlyArray<Inline> = [Doc.link({ url: "u1" }, "x"), Doc.link({ url: "u2" }, "y")];
			const links = linksOf(paintSpans(flatten(inlines, ctx), ctx));
			assert.strictEqual(links.pairs, 2);
			assert.isTrue(links.balanced);
		}),
	);

	it.effect("at colour none the output carries no SGR, and the link function alone decides hyperlinks", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ paint: (_token, text) => text, link: (_target, label) => label });
			const painted = paintSpans(flatten([Doc.text("a", "failure"), Doc.link({ url: "u" }, "b")], ctx), ctx);
			assert.strictEqual(painted, "ab");
		}),
	);
});

describe("wrapSpans", () => {
	const textOf = (line: ReadonlyArray<Span>): string => line.map((s) => s.text).join("");
	const lines = (spans: ReadonlyArray<Span>, width: number): ReadonlyArray<string> =>
		wrapSpans(spans, width).map(textOf);

	it("breaks at spaces and drops the space at the break", () => {
		assert.deepStrictEqual(lines([{ text: "the quick brown fox" }], 10), ["the quick", "brown fox"]);
		assert.deepStrictEqual(lines([{ text: "the quick brown fox" }], 9), ["the quick", "brown fox"]);
		assert.deepStrictEqual(lines([{ text: "the quick brown fox" }], 8), ["the", "quick", "brown", "fox"]);
	});

	it("keeps spaces inside a line, and text that fits is one line", () => {
		assert.deepStrictEqual(lines([{ text: "a  b" }], 10), ["a  b"]);
		assert.deepStrictEqual(lines([{ text: "  indented" }], 20), ["  indented"]);
		assert.deepStrictEqual(lines([], 10), [""]);
	});

	it("hard-breaks a word longer than the width, on a line of its own", () => {
		assert.deepStrictEqual(lines([{ text: "ab abcdefghij cd" }], 4), ["ab", "abcd", "efgh", "ij", "cd"]);
		for (const line of lines([{ text: "abcdefghij" }], 4)) assert.isAtMost(displayWidth(line), 4);
	});

	it("never lets a wide character straddle the edge", () => {
		const out = lines([{ text: "日本語日本語" }], 5);
		assert.deepStrictEqual(out, ["日本", "語日", "本語"]);
		for (const line of out) assert.isAtMost(displayWidth(line), 5);
	});

	it("never splits a grapheme, such as a ZWJ family (width 2) or a base with a combining mark", () => {
		const family = "👨‍👩‍👧‍👦";
		const out = lines([{ text: `${family}${family}${family}` }], 3);
		assert.deepStrictEqual(out, [family, family, family]);
		assert.deepStrictEqual(lines([{ text: "ééé" }], 2), ["éé", "é"]);
	});

	it("keeps every span's style on the characters that carry it, across lines", () => {
		const spans: ReadonlyArray<Span> = [
			{ text: "red words ", token: "failure" },
			{ text: "and plain ones" },
			{ text: " linked", link: { url: "u" } },
		];
		const wrapped = wrapSpans(spans, 7);
		const pairs = (list: ReadonlyArray<Span>) =>
			list.flatMap((span) =>
				graphemes(span.text)
					.filter((g) => g !== " ")
					.map((g) => [g, span.token ?? null, span.link === undefined ? null : JSON.stringify(span.link)] as const),
			);
		assert.deepStrictEqual(
			wrapped.flatMap((line) => pairs(line)),
			pairs(spans),
			"nothing lost, added or restyled",
		);
		for (const line of wrapped) assert.isAtMost(widthOf(line), 7);
	});

	it("a newline is a forced break", () => {
		assert.deepStrictEqual(lines([{ text: "ab\ncd\r\nef" }], 10), ["ab", "cd", "ef"]);
	});

	it("a width under one is treated as one, and always makes progress", () => {
		assert.deepStrictEqual(lines([{ text: "abc" }], 0), ["a", "b", "c"]);
		assert.deepStrictEqual(lines([{ text: "日本" }], 1), ["日", "本"]);
	});

	it("an unbounded width is one line", () => {
		assert.deepStrictEqual(lines([{ text: "a b c" }], Number.POSITIVE_INFINITY), ["a b c"]);
	});
});
