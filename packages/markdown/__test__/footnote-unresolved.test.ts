// Unresolved GFM footnote markers (effected#1189): a `[^label]` with no matching definition stays literal text,
// so `findAll("footnoteReference")` cannot see it. `MarkdownDocument.unresolvedFootnoteReferences` lists exactly
// those markers, recorded by the parse when it rejected them, with the spans every node carries.

import { assert, describe, it } from "@effect/vitest";
import { Result } from "effect";
import { MarkdownParseOptions } from "../src/Markdown.js";
import type { UnresolvedFootnoteReference } from "../src/MarkdownDocument.js";
import { MarkdownDocument } from "../src/MarkdownDocument.js";
import { Point, Position } from "../src/MarkdownNode.js";

const parse = (source: string, options: Partial<MarkdownParseOptions> = {}): MarkdownDocument =>
	Result.getOrThrow(MarkdownDocument.parseResult(source, MarkdownParseOptions.make(options)));

const labelsOf = (source: string, options: Partial<MarkdownParseOptions> = {}): ReadonlyArray<string> =>
	parse(source, options).unresolvedFootnoteReferences.map((marker) => marker.label);

/** The source text a marker's span covers — always the whole `[^label]`. */
const spanned = (source: string, marker: UnresolvedFootnoteReference): string =>
	source.slice(marker.position.start.offset, marker.position.end.offset);

const position = (start: readonly [number, number, number], end: readonly [number, number, number]): Position =>
	Position.make({
		start: Point.make({ line: start[0], column: start[1], offset: start[2] }),
		end: Point.make({ line: end[0], column: end[1], offset: end[2] }),
	});

describe("MarkdownDocument.unresolvedFootnoteReferences", () => {
	it("reports an undefined marker with its label, identifier and span, and not a defined one", () => {
		const source = "See [^a] and [^B].\n\n[^a]: Defined.\n";
		const document = parse(source);
		assert.deepStrictEqual(document.unresolvedFootnoteReferences, [
			{ label: "B", identifier: "b", position: position([1, 14, 13], [1, 18, 17]) },
		]);
		// The control: the defined marker did form a reference node, and the undefined one did not.
		assert.lengthOf(document.findAll("footnoteReference"), 1);
		assert.include(
			document
				.findAll("text")
				.map((text) => text.value)
				.join(""),
			"[^B]",
		);
	});

	it("leaves the node tree exactly as a parse without the accessor builds it", () => {
		const source = "x [^missing] y\n";
		const document = parse(source);
		assert.lengthOf(document.unresolvedFootnoteReferences, 1);
		assert.deepStrictEqual(document.root, parse(source).root);
		assert.deepStrictEqual(
			document.root.children.map((child) => child.type),
			["paragraph"],
		);
	});

	it("matches labels the way reference formation does: case-folded and whitespace-collapsed", () => {
		assert.deepStrictEqual(labelsOf("[^ABC] [^a  b]\n\n[^abc]: one\n\n[^a b]: two\n"), []);
		assert.deepStrictEqual(labelsOf("[^ABC]\n\n[^xyz]: one\n"), ["ABC"]);
	});

	it("excludes every place the parser does not read a marker", () => {
		const cases = [
			"`[^a]`",
			"``[^a]``",
			"```\n[^a]\n```",
			"    [^a]",
			"<http://example.com/[^a]>",
			'<span title="[^a]">x</span>',
			"<div>\n[^a]\n</div>",
			"<!-- [^a] -->",
			"\\[^a]",
			"[^a](/url)",
			"[^]",
			"[^ ]",
		];
		for (const source of cases) {
			assert.deepStrictEqual(labelsOf(`${source}\n`), [], source);
		}
		// The control: the same marker outside any of those IS reported.
		assert.deepStrictEqual(labelsOf("[^a]\n"), ["a"]);
	});

	it("finds markers nested in lists, blockquotes, tables, headings and footnote definitions, in source order", () => {
		const source = [
			"# Title [^h]",
			"",
			"- item [^l]",
			"  - nested [^n]",
			"",
			"> quote [^q]",
			"",
			"| a | b |",
			"| - | - |",
			"| [^t] | x |",
			"",
			"Cites [^d].",
			"",
			"[^d]: Defined, but it cites [^inner].",
			"",
		].join("\n");
		const markers = parse(source).unresolvedFootnoteReferences;
		assert.deepStrictEqual(
			markers.map((marker) => marker.label),
			["h", "l", "n", "q", "t", "inner"],
		);
		for (const marker of markers) {
			assert.strictEqual(spanned(source, marker), `[^${marker.label}]`, marker.label);
		}
		assert.deepStrictEqual(
			markers.map((marker) => marker.position.start.line),
			[1, 3, 4, 6, 10, 14],
		);
	});

	it("positions a marker on a CRLF line with the package's unist points", () => {
		const source = "a\r\nb [^x]\r\n";
		const [marker] = parse(source).unresolvedFootnoteReferences;
		assert.deepStrictEqual(marker?.position, position([2, 3, 5], [2, 7, 9]));
		assert.strictEqual(spanned(source, marker as UnresolvedFootnoteReference), "[^x]");
	});

	it("keeps the raw label, inline syntax included, when the brackets enclosed some", () => {
		const source = "[^*em*]\n";
		const [marker] = parse(source).unresolvedFootnoteReferences;
		assert.strictEqual(marker?.label, "*em*");
		assert.strictEqual(marker?.identifier, "*em*");
	});

	it("is always empty under the commonmark dialect, which has no footnotes", () => {
		assert.deepStrictEqual(labelsOf("[^a]\n", { dialect: "commonmark" }), []);
		assert.deepStrictEqual(labelsOf("[^a]\n", { dialect: "gfm" }), ["a"]);
	});

	it("never reads frontmatter, which never enters the inline pass", () => {
		assert.deepStrictEqual(labelsOf("---\ntitle: '[^fm]'\n---\n[^body]\n", { frontmatter: true }), ["body"]);
	});

	it("derives the record once for a document built with make, from source, as GFM", () => {
		const source = "---\ntitle: '[^fm]'\n---\n[^body] and [^more]\n";
		const parsed = parse(source, { frontmatter: true });
		const built = MarkdownDocument.make({
			source: parsed.source,
			root: parsed.root,
			diagnostics: [],
			definitions: new Map(),
		});
		const first = built.unresolvedFootnoteReferences;
		assert.deepStrictEqual(first, parsed.unresolvedFootnoteReferences);
		assert.strictEqual(built.unresolvedFootnoteReferences, first, "cached after the first access");
		// The root carries no frontmatter node, so the derivation reads the fences as ordinary content.
		const bare = MarkdownDocument.make({
			source,
			root: parse(source).root,
			diagnostics: [],
			definitions: new Map(),
		});
		assert.deepStrictEqual(
			bare.unresolvedFootnoteReferences.map((marker) => marker.label),
			["fm", "body", "more"],
		);
	});
});
