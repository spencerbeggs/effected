// Test-only HTML writer. The product ships no HTML — this exists solely so
// the CommonMark spec corpus can be asserted by normalized-HTML equivalence,
// which is the same trick mdast-util-from-markdown uses to prove itself.
//
// Every rendering rule here is a direct port of commonmark.js@0.31.2
// `lib/render/html.js` and `lib/render/renderer.js`, including the escaping
// (`escapeXml` from `lib/common.js`) and the URL normalization (`normalizeURI`,
// which delegates to `mdurl@2.0.0`'s `encode`). Where this file departs from
// that source it says so and says why. Do not "clean up" a rule here without
// checking it against the upstream file — these rules decide all 652 corpus
// verdicts, and a tidier rule that disagrees with commonmark.js is a bug.
//
// commonmark.js is BSD-2-Clause, Copyright (c) 2014-2020 John MacFarlane.
// mdurl is MIT, Copyright (c) 2015 Vitaly Puzrin, Alex Kocharin.

import type {
	Blockquote,
	Code,
	Definition,
	FlowContent,
	Heading,
	ImageReference,
	LinkReference,
	List,
	ListItem,
	Paragraph,
	PhrasingContent,
	Root,
} from "../../../src/MarkdownNode.js";

// --- escaping ---------------------------------------------------------------

const reXmlSpecial = /[&<>"]/g;

const replaceUnsafeChar = (s: string): string => {
	switch (s) {
		case "&":
			return "&amp;";
		case "<":
			return "&lt;";
		case ">":
			return "&gt;";
		case '"':
			return "&quot;";
		default:
			return s;
	}
};

/**
 * commonmark.js `lib/common.js` `escapeXml`: the four XML specials, nothing
 * else. Notably it does NOT escape `'`.
 */
export const escapeXml = (s: string): string => s.replace(reXmlSpecial, replaceUnsafeChar);

// --- URL normalization ------------------------------------------------------

// mdurl@2.0.0 `encode`, inlined. commonmark.js applies this to link and image
// destinations, so a URL reaches its renderer already percent-encoded.
//
// THIS WRITER APPLIES IT AT RENDER TIME INSTEAD. mdast defines `url` as the
// decoded destination (which is what `mdast-util-to-hast` assumes, normalizing
// on the way out), and keeping the node faithful to mdast matters more than
// matching commonmark.js's internal staging. The parser must therefore store
// the UNESCAPED, UN-PERCENT-ENCODED destination; this is the only place the
// encoding happens.
const ENCODE_DEFAULT_CHARS = ";/?:@&=+$,-_.!~*'()#";

const encodeCache: ReadonlyArray<string> = (() => {
	const cache: string[] = [];
	for (let i = 0; i < 128; i += 1) {
		const ch = String.fromCharCode(i);
		cache.push(/^[0-9a-z]$/i.test(ch) ? ch : `%${`0${i.toString(16).toUpperCase()}`.slice(-2)}`);
	}
	for (const ch of ENCODE_DEFAULT_CHARS) {
		cache[ch.charCodeAt(0)] = ch;
	}
	return cache;
})();

/**
 * commonmark.js `normalizeURI` — `mdurl.encode` with its default character
 * set, falling back to the input if it throws.
 */
export const normalizeUri = (uri: string): string => {
	try {
		let result = "";
		for (let i = 0, l = uri.length; i < l; i += 1) {
			const code = uri.charCodeAt(i);

			// An already-valid percent escape is passed through untouched.
			if (code === 0x25 && i + 2 < l && /^[0-9a-f]{2}$/i.test(uri.slice(i + 1, i + 3))) {
				result += uri.slice(i, i + 3);
				i += 2;
				continue;
			}
			if (code < 128) {
				result += encodeCache[code];
				continue;
			}
			if (code >= 0xd800 && code <= 0xdfff) {
				if (code <= 0xdbff && i + 1 < l) {
					const nextCode = uri.charCodeAt(i + 1);
					if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
						result += encodeURIComponent(uri.slice(i, i + 2));
						i += 1;
						continue;
					}
				}
				// A lone surrogate encodes as U+FFFD, never as an exception.
				result += "%EF%BF%BD";
				continue;
			}
			result += encodeURIComponent(uri.charAt(i));
		}
		return result;
	} catch {
		return uri;
	}
};

// --- reference labels -------------------------------------------------------

/**
 * commonmark.js `lib/inlines.js` `normalizeReference`, minus the bracket slice
 * (an mdast `identifier` carries no brackets).
 *
 * The `toLowerCase().toUpperCase()` pair is not redundant: it is commonmark's
 * Unicode case-folding trick, and it is why `ẞ` and `ß` match. Applying it to
 * both sides of the lookup means a tree whose identifiers were normalized
 * lowercase (mdast's convention) and one normalized uppercase both resolve.
 */
export const normalizeLabel = (label: string): string =>
	label
		.trim()
		.replace(/[ \t\r\n]+/g, " ")
		.toLowerCase()
		.toUpperCase();

/**
 * Collects every {@link Definition} in the tree, keyed by normalized label.
 *
 * The parser deliberately leaves references unresolved and keeps definitions
 * in the tree, so resolution is the renderer's job. First definition wins,
 * matching CommonMark's rule that an earlier definition takes precedence.
 */
export const collectDefinitions = (root: Root): ReadonlyMap<string, Definition> => {
	// A real Map, not an object: link labels are attacker-controlled, and a
	// `__proto__` label must be a key, not a prototype write.
	const definitions = new Map<string, Definition>();

	const visitFlow = (nodes: ReadonlyArray<FlowContent>): void => {
		for (const node of nodes) {
			switch (node.type) {
				case "definition": {
					const key = normalizeLabel(node.identifier);
					if (!definitions.has(key)) {
						definitions.set(key, node);
					}
					break;
				}
				case "blockquote":
					visitFlow(node.children);
					break;
				case "list":
					for (const item of node.children) {
						visitFlow(item.children);
					}
					break;
				default:
					break;
			}
		}
	};

	visitFlow(root.children);
	return definitions;
};

// --- the writer -------------------------------------------------------------

type Attr = readonly [name: string, value: string];

class HtmlWriter {
	private buffer = "";
	// `lastOut` is the whole last string written, exactly as commonmark.js
	// tracks it, because `cr()` compares it against "\n" by identity.
	private lastOut = "\n";
	private disableTags = 0;
	private readonly definitions: ReadonlyMap<string, Definition>;

	constructor(definitions: ReadonlyMap<string, Definition>) {
		this.definitions = definitions;
	}

	private lit(s: string): void {
		this.buffer += s;
		this.lastOut = s;
	}

	private out(s: string): void {
		this.lit(escapeXml(s));
	}

	private cr(): void {
		if (this.lastOut !== "\n") {
			this.lit("\n");
		}
	}

	private tag(name: string, attrs: ReadonlyArray<Attr> = [], selfclosing = false): void {
		if (this.disableTags > 0) {
			return;
		}
		this.buffer += `<${name}`;
		for (const [attrName, attrValue] of attrs) {
			this.buffer += ` ${attrName}="${attrValue}"`;
		}
		if (selfclosing) {
			this.buffer += " /";
		}
		this.buffer += ">";
		this.lastOut = ">";
	}

	render(root: Root): string {
		this.renderFlow(root.children);
		return this.buffer;
	}

	private renderFlow(nodes: ReadonlyArray<FlowContent>): void {
		for (const node of nodes) {
			switch (node.type) {
				case "paragraph":
					this.paragraph(node, false);
					break;
				case "heading":
					this.heading(node);
					break;
				case "thematicBreak":
					this.cr();
					this.tag("hr", [], true);
					this.cr();
					break;
				case "blockquote":
					this.blockquote(node);
					break;
				case "list":
					this.list(node);
					break;
				case "code":
					this.codeBlock(node);
					break;
				case "html":
					// html_block: surrounded by newlines, emitted raw.
					this.cr();
					this.lit(node.value);
					this.cr();
					break;
				case "definition":
					// Definitions render to nothing. They stay in the tree
					// because this package edits markdown; HTML has no place
					// to put them.
					break;
			}
		}
	}

	private paragraph(node: Paragraph, tight: boolean): void {
		// commonmark.js suppresses <p> when the paragraph's grandparent is a
		// tight list. Tightness is passed down here instead of read from a
		// parent pointer, because mdast nodes carry no parent.
		if (tight) {
			this.renderPhrasing(node.children);
			return;
		}
		this.cr();
		this.tag("p");
		this.renderPhrasing(node.children);
		this.tag("/p");
		this.cr();
	}

	private heading(node: Heading): void {
		const tagname = `h${node.depth}`;
		this.cr();
		this.tag(tagname);
		this.renderPhrasing(node.children);
		this.tag(`/${tagname}`);
		this.cr();
	}

	private blockquote(node: Blockquote): void {
		this.cr();
		this.tag("blockquote");
		this.cr();
		this.renderFlow(node.children);
		this.cr();
		this.tag("/blockquote");
		this.cr();
	}

	private list(node: List): void {
		const tagname = node.ordered === true ? "ol" : "ul";
		const attrs: Attr[] = [];
		// commonmark.js: `start !== null && start !== 1`.
		if (node.start !== undefined && node.start !== 1) {
			attrs.push(["start", String(node.start)]);
		}
		// Absent `spread` means "unknown", which mdast and this writer both
		// read as tight — the same default commonmark.js's `listTight` carries.
		const tight = node.spread !== true;

		this.cr();
		this.tag(tagname, attrs);
		this.cr();
		for (const item of node.children) {
			this.listItem(item, tight);
		}
		this.cr();
		this.tag(`/${tagname}`);
		this.cr();
	}

	private listItem(node: ListItem, tight: boolean): void {
		this.tag("li");
		for (const child of node.children) {
			if (child.type === "paragraph") {
				this.paragraph(child, tight);
			} else {
				this.renderFlow([child]);
			}
		}
		this.tag("/li");
		this.cr();
	}

	private codeBlock(node: Code): void {
		const attrs: Attr[] = [];
		// commonmark.js takes the first whitespace-run-delimited word of the
		// info string; `lang` IS that word after the parser's split.
		if (node.lang !== undefined && node.lang.length > 0) {
			let cls = escapeXml(node.lang);
			if (!/^language-/.exec(cls)) {
				cls = `language-${cls}`;
			}
			attrs.push(["class", cls]);
		}
		this.cr();
		this.tag("pre");
		this.tag("code", attrs);
		this.out(node.value);
		this.tag("/code");
		this.tag("/pre");
		this.cr();
	}

	private renderPhrasing(nodes: ReadonlyArray<PhrasingContent>): void {
		for (const node of nodes) {
			switch (node.type) {
				case "text":
					// mdast has no softbreak node: a soft line break is a raw
					// newline inside a text value, which is exactly what
					// commonmark.js's default `softbreak: "\n"` emits.
					this.out(node.value);
					break;
				case "break":
					this.tag("br", [], true);
					this.cr();
					break;
				case "inlineCode":
					this.tag("code");
					this.out(node.value);
					this.tag("/code");
					break;
				case "html":
					// html_inline: raw, no surrounding newlines.
					this.lit(node.value);
					break;
				case "emphasis":
					this.tag("em");
					this.renderPhrasing(node.children);
					this.tag("/em");
					break;
				case "strong":
					this.tag("strong");
					this.renderPhrasing(node.children);
					this.tag("/strong");
					break;
				case "link":
					this.link(node.url, node.title, node.children);
					break;
				case "image":
					this.image(node.url, node.title, node.alt ?? "");
					break;
				case "linkReference":
					this.linkReference(node);
					break;
				case "imageReference":
					this.imageReference(node);
					break;
			}
		}
	}

	private link(url: string, title: string | undefined, children: ReadonlyArray<PhrasingContent>): void {
		const attrs: Attr[] = [["href", escapeXml(normalizeUri(url))]];
		if (title !== undefined && title !== "") {
			attrs.push(["title", escapeXml(title)]);
		}
		this.tag("a", attrs);
		this.renderPhrasing(children);
		this.tag("/a");
	}

	private image(url: string, title: string | undefined, alt: string): void {
		// commonmark.js builds alt by re-rendering the image's children with
		// tags disabled. mdast Images have no children — the parser must have
		// computed `alt` the same way (plain text of the bracket content).
		if (this.disableTags === 0) {
			this.lit(`<img src="${escapeXml(normalizeUri(url))}" alt="`);
		}
		this.disableTags += 1;
		this.lit(escapeXml(alt));
		this.disableTags -= 1;
		if (this.disableTags === 0) {
			if (title !== undefined && title !== "") {
				this.lit(`" title="${escapeXml(title)}`);
			}
			this.lit('" />');
		}
	}

	private linkReference(node: LinkReference): void {
		const definition = this.definitions.get(normalizeLabel(node.identifier));
		if (definition === undefined) {
			// No matching definition: CommonMark leaves the source text alone,
			// so the brackets come back as literal text with the bracket
			// content still rendered as inlines.
			this.out("[");
			this.renderPhrasing(node.children);
			this.out("]");
			this.out(this.referenceSuffix(node.referenceType, node.label ?? node.identifier));
			return;
		}
		this.link(definition.url, definition.title, node.children);
	}

	private imageReference(node: ImageReference): void {
		const definition = this.definitions.get(normalizeLabel(node.identifier));
		if (definition === undefined) {
			this.out(`![${node.alt ?? ""}]`);
			this.out(this.referenceSuffix(node.referenceType, node.label ?? node.identifier));
			return;
		}
		this.image(definition.url, definition.title, node.alt ?? "");
	}

	private referenceSuffix(referenceType: "shortcut" | "collapsed" | "full", label: string): string {
		switch (referenceType) {
			case "shortcut":
				return "";
			case "collapsed":
				return "[]";
			case "full":
				return `[${label}]`;
		}
	}
}

/**
 * Renders a document to spec-conventional HTML, the form the CommonMark
 * corpus expects. Compare results with {@link normalizeHtml}, never directly —
 * the corpus's expected output differs from this writer's in insignificant
 * whitespace.
 *
 * Reference nodes are resolved here, against the {@link Definition} nodes
 * found anywhere in the tree, because the parser emits them unresolved.
 */
export const renderHtml = (root: Root): string => new HtmlWriter(collectDefinitions(root)).render(root);
