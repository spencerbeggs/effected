import { assert, describe, it } from "@effect/vitest";
import {
	Blockquote,
	Break,
	Code,
	Definition,
	Emphasis,
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
	Root,
	Strong,
	Text,
	ThematicBreak,
} from "../../../src/MarkdownNode.js";
import { escapeXml, normalizeLabel, normalizeUri, renderHtml } from "./htmlWriter.js";
import { normalizeHtml } from "./normalizeHtml.js";
import { span } from "./span.js";

const p = span(0, 0);

/** A document wrapping the given flow children. */
const doc = (...children: ReadonlyArray<Parameters<typeof Root.make>[0]["children"][number]>): Root =>
	Root.make({ children, position: p });

/** A paragraph of plain text. */
const para = (value: string): Paragraph =>
	Paragraph.make({ children: [Text.make({ value, position: p })], position: p });

describe("renderHtml", () => {
	describe("leaf blocks", () => {
		it("renders a paragraph", () => {
			assert.strictEqual(renderHtml(doc(para("hello"))), "<p>hello</p>\n");
		});

		it("renders headings at every depth", () => {
			const headings = ([1, 2, 3, 4, 5, 6] as const).map((depth) =>
				Heading.make({ depth, children: [Text.make({ value: "t", position: p })], position: p }),
			);
			assert.strictEqual(
				renderHtml(doc(...headings)),
				"<h1>t</h1>\n<h2>t</h2>\n<h3>t</h3>\n<h4>t</h4>\n<h5>t</h5>\n<h6>t</h6>\n",
			);
		});

		it("renders a thematic break as a self-closing hr", () => {
			assert.strictEqual(renderHtml(doc(ThematicBreak.make({ position: p }))), "<hr />\n");
		});

		it("renders an indented code block without a language class", () => {
			assert.strictEqual(renderHtml(doc(Code.make({ value: "a\n", position: p }))), "<pre><code>a\n</code></pre>\n");
		});

		it("prefixes a fenced code block's info word with language-", () => {
			assert.strictEqual(
				renderHtml(doc(Code.make({ value: "a\n", lang: "ts", position: p }))),
				'<pre><code class="language-ts">a\n</code></pre>\n',
			);
		});

		it("leaves an info word that already starts with language- alone", () => {
			assert.strictEqual(
				renderHtml(doc(Code.make({ value: "", lang: "language-ts", position: p }))),
				'<pre><code class="language-ts"></code></pre>\n',
			);
		});

		it("ignores a code block's meta when building the class", () => {
			assert.strictEqual(
				renderHtml(doc(Code.make({ value: "", lang: "ts", meta: "twoslash title=x", position: p }))),
				'<pre><code class="language-ts"></code></pre>\n',
			);
		});

		it("passes an html block through raw", () => {
			assert.strictEqual(
				renderHtml(doc(Html.make({ value: "<div>\n<i>x</i>\n</div>", position: p }))),
				"<div>\n<i>x</i>\n</div>\n",
			);
		});
	});

	describe("definitions", () => {
		it("renders a definition to nothing at all", () => {
			assert.strictEqual(
				renderHtml(doc(Definition.make({ identifier: "ref", url: "/u", position: p }), para("after"))),
				"<p>after</p>\n",
			);
		});
	});

	describe("containers", () => {
		it("renders a blockquote", () => {
			assert.strictEqual(
				renderHtml(doc(Blockquote.make({ children: [para("q")], position: p }))),
				"<blockquote>\n<p>q</p>\n</blockquote>\n",
			);
		});

		it("omits paragraph tags inside a tight list", () => {
			const list = List.make({
				spread: false,
				children: [
					ListItem.make({ children: [para("a")], position: p }),
					ListItem.make({ children: [para("b")], position: p }),
				],
				position: p,
			});
			assert.strictEqual(renderHtml(doc(list)), "<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n");
		});

		it("treats an absent spread as tight", () => {
			const list = List.make({
				children: [ListItem.make({ children: [para("a")], position: p })],
				position: p,
			});
			assert.strictEqual(renderHtml(doc(list)), "<ul>\n<li>a</li>\n</ul>\n");
		});

		it("keeps paragraph tags inside a loose list", () => {
			const list = List.make({
				spread: true,
				children: [ListItem.make({ children: [para("a")], position: p })],
				position: p,
			});
			assert.strictEqual(renderHtml(doc(list)), "<ul>\n<li>\n<p>a</p>\n</li>\n</ul>\n");
		});

		it("renders an ordered list, emitting start only when it is not 1", () => {
			const ordered = (start: number): Root =>
				doc(
					List.make({
						ordered: true,
						start,
						spread: false,
						children: [ListItem.make({ children: [para("a")], position: p })],
						position: p,
					}),
				);
			assert.strictEqual(renderHtml(ordered(1)), "<ol>\n<li>a</li>\n</ol>\n");
			assert.strictEqual(renderHtml(ordered(3)), '<ol start="3">\n<li>a</li>\n</ol>\n');
		});

		it("renders a non-paragraph child of a tight list item normally", () => {
			const list = List.make({
				spread: false,
				children: [
					ListItem.make({
						children: [para("a"), Code.make({ value: "x\n", position: p })],
						position: p,
					}),
				],
				position: p,
			});
			assert.strictEqual(renderHtml(doc(list)), "<ul>\n<li>a\n<pre><code>x\n</code></pre>\n</li>\n</ul>\n");
		});
	});

	describe("phrasing", () => {
		const inline = (...children: ReadonlyArray<Parameters<typeof Paragraph.make>[0]["children"][number]>): string =>
			renderHtml(doc(Paragraph.make({ children, position: p })));

		it("renders emphasis and strong", () => {
			assert.strictEqual(
				inline(
					Emphasis.make({ children: [Text.make({ value: "e", position: p })], position: p }),
					Strong.make({ children: [Text.make({ value: "s", position: p })], position: p }),
				),
				"<p><em>e</em><strong>s</strong></p>\n",
			);
		});

		it("renders inline code, escaping its content", () => {
			assert.strictEqual(
				inline(InlineCode.make({ value: "a < b & c", position: p })),
				"<p><code>a &lt; b &amp; c</code></p>\n",
			);
		});

		it("renders a hard break as br followed by a newline", () => {
			assert.strictEqual(
				inline(
					Text.make({ value: "a", position: p }),
					Break.make({ position: p }),
					Text.make({ value: "b", position: p }),
				),
				"<p>a<br />\nb</p>\n",
			);
		});

		it("emits a soft break as the newline already inside the text value", () => {
			assert.strictEqual(inline(Text.make({ value: "a\nb", position: p })), "<p>a\nb</p>\n");
		});

		it("passes inline html through raw, with no surrounding newlines", () => {
			assert.strictEqual(
				inline(Text.make({ value: "a", position: p }), Html.make({ value: "<b>", position: p })),
				"<p>a<b></p>\n",
			);
		});

		it("renders a link, with and without a title", () => {
			assert.strictEqual(
				inline(Link.make({ url: "/u", children: [Text.make({ value: "t", position: p })], position: p })),
				'<p><a href="/u">t</a></p>\n',
			);
			assert.strictEqual(
				inline(Link.make({ url: "/u", title: "T", children: [Text.make({ value: "t", position: p })], position: p })),
				'<p><a href="/u" title="T">t</a></p>\n',
			);
		});

		it("renders an image from its alt text, with and without a title", () => {
			assert.strictEqual(inline(Image.make({ url: "/u", alt: "a", position: p })), '<p><img src="/u" alt="a" /></p>\n');
			assert.strictEqual(
				inline(Image.make({ url: "/u", title: "T", alt: "a", position: p })),
				'<p><img src="/u" alt="a" title="T" /></p>\n',
			);
		});

		it("escapes text content", () => {
			assert.strictEqual(
				inline(Text.make({ value: '<a> & "b"', position: p })),
				"<p>&lt;a&gt; &amp; &quot;b&quot;</p>\n",
			);
		});
	});

	describe("references", () => {
		const definition = Definition.make({ identifier: "ref", url: "/u", title: "T", position: p });
		const refText = [Text.make({ value: "text", position: p })];

		it("renders a shortcut reference as a link when a definition matches", () => {
			const tree = doc(
				definition,
				Paragraph.make({
					children: [
						LinkReference.make({ identifier: "ref", referenceType: "shortcut", children: refText, position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), '<p><a href="/u" title="T">text</a></p>\n');
		});

		it("renders an unmatched shortcut reference as literal bracket text", () => {
			const tree = doc(
				Paragraph.make({
					children: [
						LinkReference.make({ identifier: "missing", referenceType: "shortcut", children: refText, position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), "<p>[text]</p>\n");
		});

		it("reconstructs the collapsed and full suffixes of an unmatched reference", () => {
			const reference = (referenceType: "collapsed" | "full"): string =>
				renderHtml(
					doc(
						Paragraph.make({
							children: [
								LinkReference.make({
									identifier: "missing",
									label: "Missing",
									referenceType,
									children: refText,
									position: p,
								}),
							],
							position: p,
						}),
					),
				);
			assert.strictEqual(reference("collapsed"), "<p>[text][]</p>\n");
			assert.strictEqual(reference("full"), "<p>[text][Missing]</p>\n");
		});

		it("renders inline markup inside an unmatched reference's brackets", () => {
			const tree = doc(
				Paragraph.make({
					children: [
						LinkReference.make({
							identifier: "missing",
							referenceType: "shortcut",
							children: [Emphasis.make({ children: [Text.make({ value: "x", position: p })], position: p })],
							position: p,
						}),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), "<p>[<em>x</em>]</p>\n");
		});

		it("resolves an image reference against a definition", () => {
			const tree = doc(
				definition,
				Paragraph.make({
					children: [
						ImageReference.make({ identifier: "ref", referenceType: "full", label: "Ref", alt: "a", position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), '<p><img src="/u" alt="a" title="T" /></p>\n');
		});

		it("renders an unmatched image reference as literal text", () => {
			const tree = doc(
				Paragraph.make({
					children: [ImageReference.make({ identifier: "missing", referenceType: "shortcut", alt: "a", position: p })],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), "<p>![a]</p>\n");
		});

		it("matches labels case-insensitively and across whitespace runs", () => {
			const tree = doc(
				Definition.make({ identifier: "Foo Bar", url: "/u", position: p }),
				Paragraph.make({
					children: [
						LinkReference.make({ identifier: "foo   bar", referenceType: "shortcut", children: refText, position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), '<p><a href="/u">text</a></p>\n');
		});

		it("finds definitions nested inside containers", () => {
			const tree = doc(
				Blockquote.make({
					children: [Definition.make({ identifier: "ref", url: "/nested", position: p })],
					position: p,
				}),
				Paragraph.make({
					children: [
						LinkReference.make({ identifier: "ref", referenceType: "shortcut", children: refText, position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), '<blockquote>\n</blockquote>\n<p><a href="/nested">text</a></p>\n');
		});

		it("lets the first of two competing definitions win", () => {
			const tree = doc(
				Definition.make({ identifier: "ref", url: "/first", position: p }),
				Definition.make({ identifier: "ref", url: "/second", position: p }),
				Paragraph.make({
					children: [
						LinkReference.make({ identifier: "ref", referenceType: "shortcut", children: refText, position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), '<p><a href="/first">text</a></p>\n');
		});

		it("treats a __proto__ label as data, never as a prototype write", () => {
			const tree = doc(
				Definition.make({ identifier: "__proto__", url: "/x", position: p }),
				Paragraph.make({
					children: [
						LinkReference.make({ identifier: "__proto__", referenceType: "shortcut", children: refText, position: p }),
					],
					position: p,
				}),
			);
			assert.strictEqual(renderHtml(tree), '<p><a href="/x">text</a></p>\n');
			assert.isFalse(Object.hasOwn(Object.prototype, "url"));
		});
	});

	describe("url normalization", () => {
		it("percent-encodes unsafe characters", () => {
			assert.strictEqual(normalizeUri("/url with space"), "/url%20with%20space");
		});

		it("preserves an existing percent escape", () => {
			assert.strictEqual(normalizeUri("/a%20b"), "/a%20b");
		});

		it("encodes a lone percent that is not an escape", () => {
			assert.strictEqual(normalizeUri("/100%"), "/100%25");
		});

		it("leaves the reserved character set unencoded", () => {
			assert.strictEqual(normalizeUri("http://a.com/b?c=d&e=f#g"), "http://a.com/b?c=d&e=f#g");
		});

		it("utf-8 percent-encodes non-ascii", () => {
			assert.strictEqual(normalizeUri("/föö"), "/f%C3%B6%C3%B6");
		});

		it("replaces a lone surrogate rather than throwing", () => {
			assert.strictEqual(normalizeUri("/\ud800"), "/%EF%BF%BD");
		});

		it("escapes the url after encoding it", () => {
			assert.strictEqual(
				renderHtml(
					doc(
						Paragraph.make({
							children: [Link.make({ url: "/a&b", children: [Text.make({ value: "t", position: p })], position: p })],
							position: p,
						}),
					),
				),
				'<p><a href="/a&amp;b">t</a></p>\n',
			);
		});
	});

	describe("escapeXml", () => {
		it("escapes the four xml specials and leaves the apostrophe alone", () => {
			assert.strictEqual(escapeXml("&<>\"'"), "&amp;&lt;&gt;&quot;'");
		});
	});

	describe("normalizeLabel", () => {
		it("case-folds, trims and collapses internal whitespace", () => {
			assert.strictEqual(normalizeLabel("  Foo\t\nBar  "), "FOO BAR");
		});

		it("folds the sharp s the way commonmark's double-case trick does", () => {
			assert.strictEqual(normalizeLabel("ß"), normalizeLabel("SS"));
		});
	});
});

describe("normalizeHtml", () => {
	it("collapses inner whitespace runs", () => {
		assert.strictEqual(normalizeHtml("<p>a  \t b</p>"), "<p>a b</p>");
		assert.strictEqual(normalizeHtml("<p>a  \t\nb</p>"), "<p>a b</p>");
	});

	it("strips whitespace surrounding block tags", () => {
		assert.strictEqual(normalizeHtml(" <p>a  b</p>"), "<p>a b</p>");
		assert.strictEqual(normalizeHtml("<p>a  b</p> "), "<p>a b</p>");
		assert.strictEqual(normalizeHtml("\n\t<p>\n\t\ta  b\t\t</p>\n\t"), "<p>a b</p>");
	});

	it("leaves whitespace around inline tags alone", () => {
		assert.strictEqual(normalizeHtml("<i>a  b</i> "), "<i>a b</i> ");
	});

	it("converts self-closing tags to open tags", () => {
		assert.strictEqual(normalizeHtml("<br />"), "<br>");
		assert.strictEqual(normalizeHtml("<hr />"), "<hr>");
	});

	it("sorts and lowercases attributes", () => {
		assert.strictEqual(normalizeHtml('<a title="bar" HREF="foo">x</a>'), '<a href="foo" title="bar">x</a>');
	});

	it("decodes references to unicode, keeping the four specials as entities", () => {
		assert.strictEqual(normalizeHtml("&forall;&amp;&gt;&lt;&quot;"), "∀&amp;&gt;&lt;&quot;");
	});

	it("decodes numeric references, decimal and hexadecimal", () => {
		assert.strictEqual(normalizeHtml("&#65;&#x42;"), "AB");
	});

	it("leaves an unknown entity name as literal text", () => {
		assert.strictEqual(normalizeHtml("&nosuchentity;"), "&nosuchentity;");
	});

	it("preserves whitespace inside pre", () => {
		assert.strictEqual(normalizeHtml("<pre><code>a  b\n\nc</code></pre>"), "<pre><code>a  b\n\nc</code></pre>");
	});

	it("strips a newline directly after a br", () => {
		assert.strictEqual(normalizeHtml("<p>a<br />\nb</p>"), "<p>a<br>b</p>");
	});

	it("passes comments and declarations through", () => {
		assert.strictEqual(normalizeHtml("<!-- c -->"), "<!-- c -->");
		assert.strictEqual(normalizeHtml("<!DOCTYPE html>"), "<!DOCTYPE html>");
	});

	// Every expectation below was captured by running the real
	// `.repos/commonmark-spec/test/normalize.py` on the same input. These are
	// the forms where Python's HTMLParser does something non-obvious, and they
	// are the cases this port got wrong first time — keep them pinned.
	describe("declaration forms, pinned against normalize.py", () => {
		const cases: ReadonlyArray<readonly [input: string, expected: string]> = [
			["<!-- x -->", "<!-- x -->"],
			["<!---->", "<!---->"],
			// HTML5 abrupt-closing comments.
			["<!-->", "<!---->"],
			["<!--->", "<!---->"],
			["<!----->", "<!----->"],
			["<!>", "<!---->"],
			// A bogus comment: anything `<!...>` that is not a doctype, a
			// comment or CDATA comes back as a comment carrying the raw text.
			["<!X>", "<!--X-->"],
			["<!ELEMENT br EMPTY>", "<!--ELEMENT br EMPTY-->"],
			["<![if x]>", "<!--[if x]-->"],
			// Doctypes stay declarations, in whatever case they were written.
			["<!DOCTYPE html>", "<!DOCTYPE html>"],
			["<!doctype html>", "<!doctype html>"],
			// CDATA survives verbatim; whitespace inside is NOT collapsed.
			["<![CDATA[x]]>", "<![CDATA[x]]>"],
			// A comment may contain `>`, so the terminator cannot be found by
			// splitting on `>`.
			["<!-- a > b -->", "<!-- a > b -->"],
			["<p>x</p><!-- a > b --><p>y</p>", "<p>x</p><!-- a > b --><p>y</p>"],
			["<!-- a --   >", "<!-- a --   >-->"],
			// An unterminated comment loses its `<` to the chunker.
			["<!--", "!--"],
			["<!--a", "!--a"],
			// Processing instructions pass through.
			["<?php echo 1; ?>", "<?php echo 1; ?>"],
			["<?x>", "<?x>"],
		];

		for (const [input, expected] of cases) {
			it(`normalizes ${JSON.stringify(input)}`, () => {
				assert.strictEqual(normalizeHtml(input), expected);
			});
		}
	});

	it("passes CDATA through verbatim", () => {
		assert.strictEqual(normalizeHtml("<![CDATA[a  b]]>"), "<![CDATA[a  b]]>");
	});

	it("keeps a valueless attribute bare", () => {
		assert.strictEqual(normalizeHtml("<input disabled>"), "<input disabled>");
	});

	it("re-escapes an attribute value after decoding it", () => {
		assert.strictEqual(normalizeHtml('<a href="a&amp;b">x</a>'), '<a href="a&amp;b">x</a>');
	});

	it("is idempotent on its own output", () => {
		const inputs = [
			"<p>a  b</p>\n",
			"<ul>\n<li>a</li>\n</ul>\n",
			"<pre><code>x\n</code></pre>\n",
			'<a href="/u" title="T">t</a>',
			"&forall;&amp;",
		];
		for (const input of inputs) {
			const once = normalizeHtml(input);
			assert.strictEqual(normalizeHtml(once), once, input);
		}
	});
});

describe("renderHtml and normalizeHtml together", () => {
	it("agrees with spec-shaped expected html for a small document", () => {
		const tree = doc(
			Heading.make({ depth: 1, children: [Text.make({ value: "Title", position: p })], position: p }),
			para("Some text."),
			List.make({
				spread: false,
				children: [
					ListItem.make({ children: [para("one")], position: p }),
					ListItem.make({ children: [para("two")], position: p }),
				],
				position: p,
			}),
			Blockquote.make({ children: [para("quoted")], position: p }),
		);

		const expected = `<h1>Title</h1>
<p>Some text.</p>
<ul>
<li>one</li>
<li>two</li>
</ul>
<blockquote>
<p>quoted</p>
</blockquote>
`;

		assert.strictEqual(normalizeHtml(renderHtml(tree)), normalizeHtml(expected));
	});
});
