import { assert, describe, it } from "@effect/vitest";
import { parseBlocks } from "../src/internal/blockParser.js";
import { decodeEntity } from "../src/internal/entities.js";
import { ENTITY_MAP } from "../src/internal/entityMap.js";
import type { PhrasingContent } from "../src/MarkdownNode.js";

/** The phrasing children of a source that parses to a single paragraph. */
const inlinesOf = (source: string): ReadonlyArray<PhrasingContent> => {
	const [first] = parseBlocks(source).root.children;
	return first?.type === "paragraph" || first?.type === "heading" ? first.children : [];
};

/** The node types of a source's phrasing content, for shape assertions. */
const shapeOf = (source: string): ReadonlyArray<string> => inlinesOf(source).map((node) => node.type);

/** The single phrasing child of a source, when there is exactly one. */
const onlyInline = (source: string): PhrasingContent | undefined => {
	const children = inlinesOf(source);
	return children.length === 1 ? children[0] : undefined;
};

describe("entities", () => {
	describe("the generated map", () => {
		it("holds every semicolon-terminated HTML5 name", () => {
			// 2125 of the 2231 WHATWG names; the rest are the legacy forms
			// without a semicolon, which CommonMark's grammar cannot match.
			assert.strictEqual(ENTITY_MAP.size, 2125);
		});

		it("decodes the multi-codepoint names", () => {
			assert.strictEqual(ENTITY_MAP.get("nvap"), "≍⃒");
		});

		it("decodes names whose value is itself a control character", () => {
			assert.strictEqual(ENTITY_MAP.get("NewLine"), "\n");
			assert.strictEqual(ENTITY_MAP.get("Tab"), "\t");
		});
	});

	describe("decodeEntity", () => {
		it("decodes a named reference", () => {
			assert.strictEqual(decodeEntity("&amp;"), "&");
			assert.strictEqual(decodeEntity("&ouml;"), "ö");
		});

		it("decodes decimal and hexadecimal references", () => {
			assert.strictEqual(decodeEntity("&#35;"), "#");
			assert.strictEqual(decodeEntity("&#x22;"), '"');
			assert.strictEqual(decodeEntity("&#X22;"), '"');
		});

		it("maps U+0000 to the replacement character", () => {
			assert.strictEqual(decodeEntity("&#0;"), "�");
		});

		it("maps an out-of-range code point to the replacement character", () => {
			assert.strictEqual(decodeEntity("&#1114112;"), "�");
			assert.strictEqual(decodeEntity("&#x110000;"), "�");
		});

		it("maps a lone surrogate to the replacement character", () => {
			assert.strictEqual(decodeEntity("&#xD800;"), "�");
		});

		it("returns undefined for a name it does not know", () => {
			assert.isUndefined(decodeEntity("&MissingHorseTermMark;"));
			assert.isUndefined(decodeEntity("&#;"));
			assert.isUndefined(decodeEntity("not an entity"));
		});
	});

	describe("in a document", () => {
		it("decodes a reference into the surrounding text run", () => {
			const node = onlyInline("&amp; and &#35;\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "& and #");
		});

		it("leaves an unknown name as literal source text", () => {
			const node = onlyInline("&MissingHorseTermMark;\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "&MissingHorseTermMark;");
		});
	});
});

describe("inline pass", () => {
	describe("backslash escapes", () => {
		it("takes the escaped punctuation literally", () => {
			const node = onlyInline("\\*not emphasis\\*\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "*not emphasis*");
		});

		it("escapes every character in the punctuation set", () => {
			const punctuation = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
			const escaped = [...punctuation].map((char) => `\\${char}`).join("");
			const node = onlyInline(`${escaped}\n`);
			assert.strictEqual(node?.type === "text" ? node.value : "", punctuation);
		});

		it("leaves a backslash before a non-escapable character literal", () => {
			const node = onlyInline("\\a\\ \\3\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "\\a\\ \\3");
		});

		it("does not escape inside a code span", () => {
			const [code] = inlinesOf("`\\*not escaped*`\n");
			assert.strictEqual(code?.type === "inlineCode" ? code.value : "", "\\*not escaped*");
		});
	});

	describe("code spans", () => {
		it("closes on a run of exactly the same length", () => {
			const node = onlyInline("`foo`\n");
			assert.strictEqual(node?.type, "inlineCode");
			assert.strictEqual(node?.type === "inlineCode" ? node.value : "", "foo");
		});

		it("lets a longer fence hold a shorter run", () => {
			const node = onlyInline("`` foo ` bar ``\n");
			assert.strictEqual(node?.type === "inlineCode" ? node.value : "", "foo ` bar");
		});

		it("strips one space of padding from each side", () => {
			const node = onlyInline("`` `foo` ``\n");
			assert.strictEqual(node?.type === "inlineCode" ? node.value : "", "`foo`");
		});

		it("keeps content that is all spaces", () => {
			const node = onlyInline("`  `\n");
			assert.strictEqual(node?.type === "inlineCode" ? node.value : "", "  ");
		});

		it("turns a line ending inside the span into a space", () => {
			const node = onlyInline("`foo\nbar`\n");
			assert.strictEqual(node?.type === "inlineCode" ? node.value : "", "foo bar");
		});

		it("leaves an unclosed run as literal backticks", () => {
			const node = onlyInline("`foo\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "`foo");
		});
	});

	describe("autolinks", () => {
		it("parses an absolute URI", () => {
			const node = onlyInline("<http://foo.bar.baz>\n");
			assert.strictEqual(node?.type, "link");
			if (node?.type !== "link") {
				return;
			}
			assert.strictEqual(node.url, "http://foo.bar.baz");
			assert.strictEqual(node.children[0]?.type === "text" ? node.children[0].value : "", "http://foo.bar.baz");
			assert.isFalse(Object.hasOwn(node, "title"));
		});

		it("parses an email address with a mailto destination", () => {
			const node = onlyInline("<foo@bar.example.com>\n");
			assert.strictEqual(node?.type === "link" ? node.url : "", "mailto:foo@bar.example.com");
		});

		it("stores the decoded destination, leaving encoding to the renderer", () => {
			const node = onlyInline("<http://example.com/a b>\n");
			// A space is not legal in an autolink, so this is not one.
			assert.strictEqual(node?.type, "text");
		});

		it("requires a scheme, leaving anything else to the other constructs", () => {
			// `<5>` is neither an autolink nor a legal tag, so it falls all the
			// way through to literal text and merges with what surrounds it.
			assert.deepStrictEqual(shapeOf("a <5> b\n"), ["text"]);
		});
	});

	describe("raw inline html", () => {
		it("keeps an open tag with attributes verbatim", () => {
			const [html] = inlinesOf('<a href="foo" class="bar">x\n');
			assert.strictEqual(html?.type, "html");
			assert.strictEqual(html?.type === "html" ? html.value : "", '<a href="foo" class="bar">');
		});

		it("keeps closing tags, comments, declarations, instructions and CDATA", () => {
			// Each source leads with text on purpose: the same constructs at the
			// start of a line would open an HTML BLOCK instead, and there would
			// be no paragraph to hold an inline.
			const sources: ReadonlyArray<readonly [string, string]> = [
				["x </a>\n", "</a>"],
				["x <!-- comment -->\n", "<!-- comment -->"],
				["x <!DOCTYPE html>\n", "<!DOCTYPE html>"],
				["x <?php echo $y; ?>\n", "<?php echo $y; ?>"],
				["x <![CDATA[raw]]>\n", "<![CDATA[raw]]>"],
			];
			for (const [source, expected] of sources) {
				const [, html] = inlinesOf(source);
				assert.strictEqual(html?.type === "html" ? html.value : "", expected, `failed for ${source}`);
			}
		});

		it("does not match a malformed tag", () => {
			assert.deepStrictEqual(shapeOf("<33> x\n"), ["text"]);
		});

		it("prefers an autolink to a raw tag", () => {
			assert.deepStrictEqual(shapeOf("<http://example.com>\n"), ["link"]);
		});
	});

	describe("line breaks", () => {
		it("makes two trailing spaces a hard break", () => {
			assert.deepStrictEqual(shapeOf("foo  \nbar\n"), ["text", "break", "text"]);
			const [, node] = inlinesOf("foo  \nbar\n");
			assert.strictEqual(node?.type === "break" ? node.breakStyle : undefined, "spaces");
		});

		it("makes a trailing backslash a hard break", () => {
			const [, node] = inlinesOf("foo\\\nbar\n");
			assert.strictEqual(node?.type, "break");
			assert.strictEqual(node?.type === "break" ? node.breakStyle : undefined, "backslash");
		});

		it("keeps a soft break as a newline inside one text value, with no node", () => {
			const node = onlyInline("foo\nbar\n");
			assert.strictEqual(node?.type, "text");
			assert.strictEqual(node?.type === "text" ? node.value : "", "foo\nbar");
		});

		it("strips a single trailing space without making a break", () => {
			const node = onlyInline("foo \nbar\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "foo\nbar");
		});

		it("strips the spaces a hard break was made of", () => {
			const [text] = inlinesOf("foo   \nbar\n");
			assert.strictEqual(text?.type === "text" ? text.value : "", "foo");
		});

		it("drops leading whitespace on the line after a break", () => {
			const [, , text] = inlinesOf("foo  \n     bar\n");
			assert.strictEqual(text?.type === "text" ? text.value : "", "bar");
		});
	});

	describe("positions", () => {
		it("spans exactly the source each inline node was built from", () => {
			const source = "a `code` b\n";
			const children = inlinesOf(source);
			const [, code] = children;
			assert.strictEqual(code?.type, "inlineCode");
			assert.strictEqual(source.slice(code?.position.start.offset ?? 0, code?.position.end.offset ?? 0), "`code`");
		});

		it("positions an inline inside a container against the original source", () => {
			// The blockquote markers are stripped from the content the inline
			// pass sees, so a naive offset would land two characters early on
			// the second line.
			const source = "> a\n> `code`\n";
			const children = inlinesOf(source.replace(/^> /gm, ""));
			assert.isAtLeast(children.length, 1);

			const quote = parseBlocks(source).root.children[0];
			const paragraph = quote?.type === "blockquote" ? quote.children[0] : undefined;
			const code = paragraph?.type === "paragraph" ? paragraph.children[1] : undefined;
			assert.strictEqual(code?.type, "inlineCode");
			assert.strictEqual(source.slice(code?.position.start.offset ?? 0, code?.position.end.offset ?? 0), "`code`");
		});

		it("keeps every inline position inside the source and ordered", () => {
			const source = "a `b` <c/> &amp; <http://x.y> d  \ne\n";
			for (const node of inlinesOf(source)) {
				assert.isAtLeast(node.position.start.offset, 0);
				assert.isAtMost(node.position.start.offset, node.position.end.offset);
				assert.isAtMost(node.position.end.offset, source.length);
			}
		});
	});

	describe("text runs", () => {
		it("merges adjacent runs into one node", () => {
			// `*` has no construct until Task 9, so it becomes literal text and
			// must not split the run around it.
			const node = onlyInline("a*b\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "a*b");
		});

		it("does not skip the run before an unclaimed character", () => {
			// The regression the `m` flag caused: `^` matching at the NEXT line
			// start silently swallowed everything in between.
			const node = onlyInline("*foo\nbar\n");
			assert.strictEqual(node?.type === "text" ? node.value : "", "*foo\nbar");
		});

		it("parses heading content as inlines too", () => {
			const [heading] = parseBlocks("# a `b`\n").root.children;
			assert.strictEqual(heading?.type, "heading");
			assert.deepStrictEqual(
				(heading?.type === "heading" ? heading.children : []).map((child) => child.type),
				["text", "inlineCode"],
			);
		});
	});
});
