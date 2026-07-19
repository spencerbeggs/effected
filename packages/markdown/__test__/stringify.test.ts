// Canonical stringify: hand-built trees in, markdown source out.
//
// Two kinds of assertion live here. Exact-string cases pin the canonical
// form where it is stable and documented (the default table in
// `src/internal/stringify.ts`); re-parse cases assert the operational
// contract — emitted text must parse back to a render-equivalent document —
// for shapes where the exact spelling is an implementation detail. The
// corpus-wide version of the re-parse property lives in
// `__test__/e2e/stringify-roundtrip.e2e.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { Markdown, MarkdownStringifyError } from "../src/Markdown.js";
import {
	Blockquote,
	Break,
	Code,
	Definition,
	Delete,
	Emphasis,
	FootnoteDefinition,
	FootnoteReference,
	Frontmatter,
	Heading,
	Html,
	Image,
	ImageReference,
	InlineCode,
	Link,
	LinkReference,
	List,
	ListItem,
	Paragraph,
	Point,
	Position,
	Root,
	Strong,
	Table,
	TableCell,
	TableRow,
	Text,
	ThematicBreak,
} from "../src/MarkdownNode.js";

/** A throwaway span. Stringify never reads offsets, only shapes. */
const span = (): Position =>
	Position.make({
		start: Point.make({ line: 1, column: 1, offset: 0 }),
		end: Point.make({ line: 1, column: 1, offset: 0 }),
	});

const text = (value: string): Text => Text.make({ value, position: span() });

const paragraph = (...children: Paragraph["children"][number][]): Paragraph =>
	Paragraph.make({ children, position: span() });

const rootOf = (...children: ReadonlyArray<Root["children"][number]>): Root =>
	Root.make({ children, position: span() });

/** stringify, asserting success. */
const out = (root: Root): string => {
	const result = Markdown.stringifyResult(root);
	if (Result.isFailure(result)) {
		assert.fail(`stringify failed: ${result.failure.message}`);
	}
	return Result.getOrThrow(result);
};

/** Render-equivalence through the real parser: emitted text re-parses. */
const reparses = (root: Root, expectType: string): void => {
	const emitted = out(root);
	const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
	assert.strictEqual(reparsed.children[0]?.type, expectType, `emitted: ${JSON.stringify(emitted)}`);
};

describe("Markdown.stringify", () => {
	describe("blocks, canonical defaults", () => {
		it("paragraph", () => {
			assert.strictEqual(out(rootOf(paragraph(text("hello world")))), "hello world\n");
		});

		it("ATX heading by default", () => {
			const heading = Heading.make({ depth: 2, children: [text("Title")], position: span() });
			assert.strictEqual(out(rootOf(heading)), "## Title\n");
		});

		it("setext heading when fidelity says so", () => {
			const heading = Heading.make({
				depth: 1,
				children: [text("Title")],
				position: span(),
				headingStyle: "setext",
			});
			assert.strictEqual(out(rootOf(heading)), "Title\n=====\n");
		});

		it("setext fidelity at depth 3 falls back to ATX", () => {
			const heading = Heading.make({
				depth: 3,
				children: [text("Title")],
				position: span(),
				headingStyle: "setext",
			});
			assert.strictEqual(out(rootOf(heading)), "### Title\n");
		});

		it("thematic break defaults to ***", () => {
			assert.strictEqual(out(rootOf(ThematicBreak.make({ position: span() }))), "***\n");
		});

		it("thematic break honors markerChar", () => {
			assert.strictEqual(out(rootOf(ThematicBreak.make({ position: span(), markerChar: "_" }))), "___\n");
		});

		it("fenced code with fidelity", () => {
			const code = Code.make({
				value: "let x = 1;",
				lang: "js",
				position: span(),
				fenceChar: "~",
				fenceLength: 4,
			});
			assert.strictEqual(out(rootOf(code)), "~~~~js\nlet x = 1;\n~~~~\n");
		});

		it("indented code when fidelity marks it indented", () => {
			const code = Code.make({ value: "a\nb", position: span() });
			assert.strictEqual(out(rootOf(code)), "    a\n    b\n");
		});

		it("indented fidelity with a lang forces a fence", () => {
			const code = Code.make({ value: "x", lang: "js", position: span() });
			assert.strictEqual(out(rootOf(code)), "```js\nx\n```\n");
		});

		it("fence grows past interior backtick runs", () => {
			const code = Code.make({ value: "``` inside", position: span(), fenceChar: "`", fenceLength: 3 });
			assert.strictEqual(out(rootOf(code)), "````\n``` inside\n````\n");
		});

		it("blockquote prefixes every line", () => {
			const quote = Blockquote.make({
				children: [paragraph(text("a")), paragraph(text("b"))],
				position: span(),
			});
			assert.strictEqual(out(rootOf(quote)), "> a\n>\n> b\n");
		});

		it("html block passes through verbatim", () => {
			const html = Html.make({ value: "<div>\n<p>x</p>\n</div>", position: span() });
			assert.strictEqual(out(rootOf(html)), "<div>\n<p>x</p>\n</div>\n");
		});

		it("definition with title, label case preserved", () => {
			const definition = Definition.make({
				identifier: "ref",
				label: "Ref",
				url: "/url",
				title: "the title",
				position: span(),
			});
			assert.strictEqual(out(rootOf(definition)), '[Ref]: /url "the title"\n');
		});

		it("definition with an empty or spacey destination uses pointy brackets", () => {
			const empty = Definition.make({ identifier: "a", url: "", position: span() });
			const spacey = Definition.make({ identifier: "b", url: "/u r l", position: span() });
			assert.strictEqual(out(rootOf(empty)), "[a]: <>\n");
			assert.strictEqual(out(rootOf(spacey)), "[b]: </u r l>\n");
		});

		it("blocks join with one blank line", () => {
			assert.strictEqual(out(rootOf(paragraph(text("a")), paragraph(text("b")))), "a\n\nb\n");
		});

		it("empty root stringifies to the empty string", () => {
			assert.strictEqual(out(rootOf()), "");
		});
	});

	describe("lists", () => {
		it("tight bullet list with defaults", () => {
			const list = List.make({
				ordered: false,
				spread: false,
				children: [
					ListItem.make({ spread: false, children: [paragraph(text("one"))], position: span() }),
					ListItem.make({ spread: false, children: [paragraph(text("two"))], position: span() }),
				],
				position: span(),
			});
			assert.strictEqual(out(rootOf(list)), "- one\n- two\n");
		});

		it("ordered list counts up from start with fidelity delimiter", () => {
			const list = List.make({
				ordered: true,
				start: 3,
				spread: false,
				children: [
					ListItem.make({ spread: false, children: [paragraph(text("a"))], position: span() }),
					ListItem.make({ spread: false, children: [paragraph(text("b"))], position: span() }),
				],
				position: span(),
				delimiter: ")",
			});
			assert.strictEqual(out(rootOf(list)), "3) a\n4) b\n");
		});

		it("loose list separates items with a blank line", () => {
			const list = List.make({
				ordered: false,
				spread: true,
				children: [
					ListItem.make({ spread: true, children: [paragraph(text("a"))], position: span() }),
					ListItem.make({ spread: true, children: [paragraph(text("b"))], position: span() }),
				],
				position: span(),
			});
			assert.strictEqual(out(rootOf(list)), "- a\n\n- b\n");
		});

		it("continuation lines indent to the marker width", () => {
			const list = List.make({
				ordered: false,
				spread: true,
				children: [
					ListItem.make({
						spread: true,
						children: [paragraph(text("first")), paragraph(text("second"))],
						position: span(),
					}),
				],
				position: span(),
			});
			assert.strictEqual(out(rootOf(list)), "- first\n\n  second\n");
		});

		it("task items carry their checkbox", () => {
			const list = List.make({
				ordered: false,
				spread: false,
				children: [
					ListItem.make({ spread: false, checked: true, children: [paragraph(text("done"))], position: span() }),
					ListItem.make({ spread: false, checked: false, children: [paragraph(text("todo"))], position: span() }),
				],
				position: span(),
			});
			assert.strictEqual(out(rootOf(list)), "- [x] done\n- [ ] todo\n");
		});

		it("adjacent same-marker lists alternate markers so they stay separate", () => {
			const item = (label: string): ListItem =>
				ListItem.make({ spread: false, children: [paragraph(text(label))], position: span() });
			const listA = List.make({ ordered: false, spread: false, children: [item("a")], position: span() });
			const listB = List.make({ ordered: false, spread: false, children: [item("b")], position: span() });
			const emitted = out(rootOf(listA, listB));
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			assert.deepStrictEqual(
				reparsed.children.map((child) => child.type),
				["list", "list"],
				`emitted: ${JSON.stringify(emitted)}`,
			);
		});

		it("nested list nests by indentation", () => {
			const inner = List.make({
				ordered: false,
				spread: false,
				children: [ListItem.make({ spread: false, children: [paragraph(text("inner"))], position: span() })],
				position: span(),
			});
			const outer = List.make({
				ordered: false,
				spread: false,
				children: [ListItem.make({ spread: false, children: [paragraph(text("outer")), inner], position: span() })],
				position: span(),
			});
			assert.strictEqual(out(rootOf(outer)), "- outer\n  - inner\n");
		});
	});

	describe("gfm blocks", () => {
		it("table with alignment row", () => {
			const cell = (value: string): TableCell => TableCell.make({ children: [text(value)], position: span() });
			const row = (...cells: ReadonlyArray<TableCell>): TableRow =>
				TableRow.make({ children: cells, position: span() });
			const table = Table.make({
				align: ["left", null, "center"],
				children: [row(cell("a"), cell("b"), cell("c")), row(cell("1"), cell("2"), cell("3"))],
				position: span(),
			});
			assert.strictEqual(out(rootOf(table)), "| a | b | c |\n| :-- | --- | :-: |\n| 1 | 2 | 3 |\n");
		});

		it("pipes inside cells are escaped", () => {
			const table = Table.make({
				children: [
					TableRow.make({
						children: [TableCell.make({ children: [text("a|b")], position: span() })],
						position: span(),
					}),
				],
				position: span(),
			});
			const emitted = out(rootOf(table));
			assert.include(emitted, "a\\|b");
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			assert.strictEqual(reparsed.children[0]?.type, "table");
		});

		it("footnote definition with continuation indentation", () => {
			const definition = FootnoteDefinition.make({
				identifier: "note",
				children: [paragraph(text("first")), paragraph(text("second"))],
				position: span(),
			});
			assert.strictEqual(out(rootOf(definition)), "[^note]: first\n\n    second\n");
		});

		it("footnote reference round-trips against its definition", () => {
			const tree = rootOf(
				paragraph(text("body"), FootnoteReference.make({ identifier: "n", position: span() })),
				FootnoteDefinition.make({ identifier: "n", children: [paragraph(text("note"))], position: span() }),
			);
			const emitted = out(tree);
			assert.include(emitted, "[^n]");
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const firstParagraph = reparsed.children[0];
			assert.strictEqual(firstParagraph?.type, "paragraph");
			assert.isTrue(
				firstParagraph.type === "paragraph" &&
					firstParagraph.children.some((child) => child.type === "footnoteReference"),
				`emitted: ${JSON.stringify(emitted)}`,
			);
		});
	});

	describe("frontmatter fences", () => {
		it("yaml", () => {
			const tree = rootOf(
				Frontmatter.make({ format: "yaml", value: "title: x", position: span() }),
				paragraph(text("body")),
			);
			assert.strictEqual(out(tree), "---\ntitle: x\n---\n\nbody\n");
		});

		it("toml", () => {
			const tree = rootOf(Frontmatter.make({ format: "toml", value: 'title = "x"', position: span() }));
			assert.strictEqual(out(tree), '+++\ntitle = "x"\n+++\n');
		});

		it("json closes with three dashes and re-parses", () => {
			const tree = rootOf(Frontmatter.make({ format: "json", value: '{ "a": 1 }', position: span() }));
			const emitted = out(tree);
			assert.strictEqual(emitted, '---json\n{ "a": 1 }\n---\n');
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted, { frontmatter: true }));
			assert.strictEqual(reparsed.children[0]?.type, "frontmatter");
		});
	});

	describe("inlines", () => {
		it("emphasis and strong with default markers", () => {
			const tree = rootOf(
				paragraph(
					Emphasis.make({ children: [text("em")], position: span() }),
					text(" and "),
					Strong.make({ children: [text("st")], position: span() }),
				),
			);
			assert.strictEqual(out(tree), "*em* and **st**\n");
		});

		it("underscore fidelity is honored", () => {
			const tree = rootOf(paragraph(Emphasis.make({ children: [text("em")], position: span(), markerChar: "_" })));
			assert.strictEqual(out(tree), "_em_\n");
		});

		it("strikethrough", () => {
			const tree = rootOf(paragraph(Delete.make({ children: [text("gone")], position: span() })));
			assert.strictEqual(out(tree), "~~gone~~\n");
		});

		it("nested strong-in-emphasis re-parses to the same shape", () => {
			const tree = rootOf(
				paragraph(
					Emphasis.make({
						children: [Strong.make({ children: [text("both")], position: span() })],
						position: span(),
					}),
				),
			);
			reparses(tree, "paragraph");
			const emitted = out(tree);
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const p = reparsed.children[0];
			assert.isTrue(p?.type === "paragraph" && p.children[0]?.type === "emphasis", `emitted: ${emitted}`);
		});

		it("emphasis-in-strong flips the inner marker rather than fusing runs", () => {
			const tree = rootOf(
				paragraph(
					Strong.make({
						children: [Emphasis.make({ children: [text("both")], position: span() })],
						position: span(),
					}),
				),
			);
			const emitted = out(tree);
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const p = reparsed.children[0];
			assert.isTrue(p?.type === "paragraph" && p.children[0]?.type === "strong", `emitted: ${emitted}`);
		});

		it("inline code picks a longer run than its content", () => {
			const tree = rootOf(paragraph(InlineCode.make({ value: "a ` b", position: span() })));
			assert.strictEqual(out(tree), "``a ` b``\n");
		});

		it("inline code starting with a backtick pads with spaces", () => {
			const tree = rootOf(paragraph(InlineCode.make({ value: "`x", position: span() })));
			assert.strictEqual(out(tree), "`` `x ``\n");
		});

		it("hard break defaults to backslash", () => {
			const tree = rootOf(paragraph(text("a"), Break.make({ position: span() }), text("b")));
			assert.strictEqual(out(tree), "a\\\nb\n");
		});

		it("hard break honors the spaces spelling", () => {
			const tree = rootOf(paragraph(text("a"), Break.make({ position: span(), breakStyle: "spaces" }), text("b")));
			assert.strictEqual(out(tree), "a  \nb\n");
		});

		it("soft break is a newline in the text and survives", () => {
			const tree = rootOf(paragraph(text("a\nb")));
			assert.strictEqual(out(tree), "a\nb\n");
		});

		it("link with title", () => {
			const tree = rootOf(paragraph(Link.make({ url: "/u", title: "t", children: [text("x")], position: span() })));
			assert.strictEqual(out(tree), '[x](/u "t")\n');
		});

		it("image with alt and no title", () => {
			const tree = rootOf(paragraph(Image.make({ url: "/i.png", alt: "pic", position: span() })));
			assert.strictEqual(out(tree), "![pic](/i.png)\n");
		});

		it("link reference forms by referenceType", () => {
			// A shortcut or collapsed reference's bracket IS its label, so
			// those forms emit the label; only a full reference carries free
			// content in its first bracket. In a parsed tree the label and
			// children always agree — the divergence here is synthesized.
			const make = (referenceType: "full" | "collapsed" | "shortcut"): Root =>
				rootOf(
					paragraph(
						LinkReference.make({
							identifier: "ref",
							label: "Ref",
							referenceType,
							children: [text("Ref")],
							position: span(),
						}),
					),
					Definition.make({ identifier: "ref", label: "Ref", url: "/u", position: span() }),
				);
			assert.strictEqual(out(make("full")), "[Ref][Ref]\n\n[Ref]: /u\n");
			assert.strictEqual(out(make("collapsed")), "[Ref][]\n\n[Ref]: /u\n");
			assert.strictEqual(out(make("shortcut")), "[Ref]\n\n[Ref]: /u\n");
		});

		it("image reference", () => {
			const tree = rootOf(
				paragraph(ImageReference.make({ identifier: "ref", referenceType: "shortcut", alt: "ref", position: span() })),
				Definition.make({ identifier: "ref", url: "/u", position: span() }),
			);
			assert.strictEqual(out(tree), "![ref]\n\n[ref]: /u\n");
		});

		it("inline html passes through", () => {
			const tree = rootOf(paragraph(text("a "), Html.make({ value: "<b>", position: span() }), text("c")));
			assert.strictEqual(out(tree), "a <b>c\n");
		});
	});

	describe("escaping", () => {
		const literal = (value: string, expectHtmlText: string): void => {
			const emitted = out(rootOf(paragraph(text(value))));
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const p = reparsed.children[0];
			assert.strictEqual(p?.type, "paragraph", `emitted: ${JSON.stringify(emitted)} became ${p?.type}`);
			if (p?.type !== "paragraph") return;
			assert.deepStrictEqual(
				p.children.map((child) => child.type),
				["text"],
				`emitted: ${JSON.stringify(emitted)} split into ${JSON.stringify(p.children.map((c) => c.type))}`,
			);
			const only = p.children[0];
			assert.isTrue(only?.type === "text" && only.value === expectHtmlText, `round-trip: ${JSON.stringify(emitted)}`);
		};

		it("emphasis markers stay literal", () => literal("a *b* _c_", "a *b* _c_"));
		it("backticks stay literal", () => literal("a `b`", "a `b`"));
		it("brackets stay literal", () => literal("[not a link](x)", "[not a link](x)"));
		it("footnote-shaped text stays literal", () => literal("[^note]", "[^note]"));
		it("autolink-shaped text stays literal", () => literal("<http://x.example>", "<http://x.example>"));
		it("entity-shaped text stays literal", () => literal("&amp; &#65;", "&amp; &#65;"));
		it("tilde runs stay literal", () => literal("~~x~~", "~~x~~"));
		it("backslashes stay literal", () => literal("a \\ b \\* c", "a \\ b \\* c"));
		it("leading hash stays literal", () => literal("# not a heading", "# not a heading"));
		it("leading quote marker stays literal", () => literal("> not a quote", "> not a quote"));
		it("leading list markers stay literal", () => {
			literal("- not a list", "- not a list");
			literal("+ not a list", "+ not a list");
			literal("1. not a list", "1. not a list");
			literal("1) not a list", "1) not a list");
		});
		it("setext-lookalike second line stays a paragraph", () => literal("para\n===", "para\n==="));
		it("thematic-lookalike second line stays a paragraph", () => literal("para\n---", "para\n---"));
		it("line-start rules apply after soft breaks", () => literal("a\n# b\n> c", "a\n# b\n> c"));
		it("pipes stay literal under gfm", () => {
			const emitted = out(rootOf(paragraph(text("a | b\n--- | ---"))));
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			assert.strictEqual(reparsed.children[0]?.type, "paragraph", `emitted: ${JSON.stringify(emitted)}`);
		});
		it("www autolink literal shape survives as text content", () => {
			// Under gfm a bare www literal re-parses as a link; the design's
			// bar is render equivalence of TEXT — a literal that was plain
			// text must stay plain text. The www matcher reads RAW source, so
			// an escaped dot defeats it while decoding back to the same text.
			const emitted = out(rootOf(paragraph(text("www.example.com"))));
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const p = reparsed.children[0];
			assert.isTrue(
				p?.type === "paragraph" && p.children.every((child) => child.type === "text"),
				`emitted: ${JSON.stringify(emitted)} must not re-parse as an autolink`,
			);
		});
		it("scheme autolink literal shape survives as text content", () => {
			const emitted = out(rootOf(paragraph(text("see http://example.com here"))));
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const p = reparsed.children[0];
			assert.isTrue(
				p?.type === "paragraph" && p.children.every((child) => child.type === "text"),
				`emitted: ${JSON.stringify(emitted)} must not re-parse as an autolink`,
			);
		});
		it("KNOWN LIMITATION: email-shaped plain text re-parses as an autolink under gfm", () => {
			// The email matcher is a postprocess over DECODED text (the P2
			// hook-placement ruling), so no backslash or entity spelling can
			// hide an email-shaped run from it — the escape decodes away
			// before the scan. Canonical stringify therefore cannot keep
			// email-shaped plain text plain under the gfm dialect; this test
			// pins the limitation so a future fix is a deliberate change.
			const emitted = out(rootOf(paragraph(text("mail a@b.example please"))));
			const reparsed = Result.getOrThrow(Markdown.parseResult(emitted));
			const p = reparsed.children[0];
			assert.isTrue(
				p?.type === "paragraph" && p.children.some((child) => child.type === "link"),
				`emitted: ${JSON.stringify(emitted)} — if this now stays text, the limitation was fixed; update this pin`,
			);
		});
	});

	describe("guard and facade posture", () => {
		it("depth past the cap fails typed, never a RangeError", () => {
			let tree: Root["children"][number] = paragraph(text("x"));
			for (let i = 0; i < 300; i += 1) {
				tree = Blockquote.make({ children: [tree as never], position: span() });
			}
			const result = Markdown.stringifyResult(rootOf(tree));
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.instanceOf(result.failure, MarkdownStringifyError);
				assert.strictEqual(result.failure.diagnostic.code, "NestingDepthExceeded");
			}
		});

		it("the Effect variant agrees with the Result variant", () =>
			Effect.gen(function* () {
				const tree = rootOf(paragraph(text("same")));
				const fromEffect = yield* Markdown.stringify(tree);
				assert.strictEqual(fromEffect, Result.getOrThrow(Markdown.stringifyResult(tree)));
			}).pipe(Effect.runPromise));

		it("encode through MarkdownFromString round-trips", () => {
			const encode = Schema.encodeEffect(Markdown.MarkdownFromString);
			const decode = Schema.decodeUnknownEffect(Markdown.MarkdownFromString);
			return Effect.gen(function* () {
				const root = yield* decode("# Title\n\npara *em* text\n\n- a\n- b\n");
				const emitted = yield* encode(root);
				const again = yield* decode(emitted);
				assert.deepStrictEqual(
					again.children.map((child) => child.type),
					root.children.map((child) => child.type),
				);
			}).pipe(Effect.runPromise);
		});
	});
});
