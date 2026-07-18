// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// `parseOpenBracket`, `parseBang` and `parseCloseBracket`: links and images,
// inline and by reference.
//
// Port notes, three changes from upstream:
//
// 1. A reference that matches the refmap becomes a `linkReference` /
//    `imageReference` carrying the identifier, the raw label and the
//    reference type, instead of upstream's eagerly resolved link with the
//    destination copied in. This package edits markdown, so which definition
//    a reference points at has to survive the round trip. Formation is
//    unchanged: a label with NO matching definition does not form a link at
//    all and the brackets stay literal text, exactly as upstream has it and
//    as the spec requires.
// 2. Destinations and titles are stored DECODED — no percent-encoding — per
//    mdast (`references.ts` carries the same note).
// 3. An image's bracket content becomes its `alt` string rather than child
//    nodes, because mdast images have no children. Upstream computes the same
//    string at render time by re-rendering the children with tags disabled.

import type { InlineNode } from "../inlineNode.js";
import { appendChild, childrenOf, insertAfter, makeInlineNode, unlink } from "../inlineNode.js";
import type { InlineConstruct, InlineScanner } from "../inlineTypes.js";
import { ReferenceScanner, normalizeReference } from "../references.js";

const C_BANG = 0x21;
const C_OPEN_BRACKET = 0x5b;
const C_CLOSE_BRACKET = 0x5d;
const C_OPEN_PAREN = 0x28;
const C_CLOSE_PAREN = 0x29;

const reWhitespaceChar = /^[ \t\n\v\f\r]/;

/**
 * Run one of `references.ts`'s grammar functions over the subject at the
 * scanner's cursor, keeping the two cursors in step.
 *
 * The destination, title and label grammars are identical wherever they
 * appear, so a link reuses exactly what a definition parsed with.
 */
const withReferenceScanner = <A>(scanner: InlineScanner, run: (reference: ReferenceScanner) => A): A => {
	const reference = new ReferenceScanner(scanner.subject);
	reference.pos = scanner.pos;
	const result = run(reference);
	scanner.pos = reference.pos;
	return result;
};

/** The plain-text flattening of a node list — an image's `alt`. */
const plainTextOf = (nodes: ReadonlyArray<InlineNode>): string => {
	let text = "";
	for (const node of nodes) {
		if (node.type === "text" || node.type === "inlineCode") {
			text += node.value;
		} else if (node.type === "image" || node.type === "imageReference") {
			// A nested image contributes the alt text it already flattened.
			text += node.value;
		} else {
			text += plainTextOf(childrenOf(node));
		}
	}
	return text;
};

/** `[` — a potential link opener. */
export const linkOpenConstruct: InlineConstruct = {
	name: "linkOpen",
	triggers: [C_OPEN_BRACKET],
	parse: (scanner) => {
		const startpos = scanner.pos;
		scanner.pos += 1;
		const node = scanner.appendText("[", startpos, scanner.pos);
		// The index points AT the bracket, so a collapsed or shortcut
		// reference can slice its label straight back out of the subject.
		scanner.addBracket(node, startpos, false);
		return true;
	},
};

/** `!` — an image opener when a `[` follows, otherwise literal. */
export const imageOpenConstruct: InlineConstruct = {
	name: "imageOpen",
	triggers: [C_BANG],
	parse: (scanner) => {
		const startpos = scanner.pos;
		scanner.pos += 1;
		if (scanner.peek() === C_OPEN_BRACKET) {
			scanner.pos += 1;
			const node = scanner.appendText("![", startpos, scanner.pos);
			scanner.addBracket(node, startpos + 1, true);
			return true;
		}
		scanner.appendText("!", startpos, scanner.pos);
		return true;
	},
};

/** `]` — closes a link or image, or stays literal. */
export const linkCloseConstruct: InlineConstruct = {
	name: "linkClose",
	triggers: [C_CLOSE_BRACKET],
	parse: (scanner) => {
		const bracketPos = scanner.pos;
		scanner.pos += 1;
		const startpos = scanner.pos;

		const opener = scanner.brackets;
		if (opener === undefined) {
			scanner.appendText("]", bracketPos, scanner.pos);
			return true;
		}
		if (!opener.active) {
			scanner.appendText("]", bracketPos, scanner.pos);
			scanner.removeBracket();
			return true;
		}

		const isImage = opener.image;
		const savepos = scanner.pos;

		let url: string | undefined;
		let title: string | undefined;
		let matched = false;

		// An inline link: `](url "title")`.
		if (scanner.peek() === C_OPEN_PAREN) {
			scanner.pos += 1;
			const inline = withReferenceScanner(scanner, (reference) => {
				reference.spnl();
				const destination = reference.parseLinkDestination();
				if (destination === undefined) {
					return undefined;
				}
				reference.spnl();
				// A title must be preceded by whitespace.
				const parsedTitle = reWhitespaceChar.test(reference.subject.charAt(reference.pos - 1))
					? reference.parseLinkTitle()
					: undefined;
				reference.spnl();
				if (reference.peek() !== C_CLOSE_PAREN) {
					return undefined;
				}
				reference.pos += 1;
				return { destination, parsedTitle };
			});

			if (inline === undefined) {
				scanner.pos = savepos;
			} else {
				url = inline.destination;
				title = inline.parsedTitle;
				matched = true;
			}
		}

		let identifier: string | undefined;
		let rawLabel: string | undefined;
		let referenceType: "shortcut" | "collapsed" | "full" = "shortcut";

		if (!matched) {
			// A reference: `][label]`, `][]` or bare `]`.
			const beforeLabel = scanner.pos;
			const labelLength = withReferenceScanner(scanner, (reference) => reference.parseLinkLabel());

			if (labelLength > 2) {
				rawLabel = scanner.subject.slice(beforeLabel, beforeLabel + labelLength);
				referenceType = "full";
			} else if (opener.bracketAfter !== true) {
				// An empty or missing second label reuses the first, which must
				// itself hold no bracket. `opener.index` is at the `[`, so this
				// slice already carries its brackets.
				rawLabel = scanner.subject.slice(opener.index, startpos);
				referenceType = labelLength === 2 ? "collapsed" : "shortcut";
			}

			if (labelLength === 0) {
				// A shortcut reference: rewind over the spaces that were skipped.
				scanner.pos = savepos;
			}

			if (rawLabel !== undefined) {
				const key = normalizeReference(rawLabel);
				// THE formation rule: no definition, no link. The brackets stay
				// literal text — this is where upstream consults its refmap and
				// where this port consults the one the block pass built.
				if (scanner.refmap.has(key)) {
					identifier = key.toLowerCase();
					matched = true;
				}
			}
		}

		if (!matched) {
			scanner.removeBracket();
			scanner.pos = startpos;
			scanner.appendText("]", bracketPos, scanner.pos);
			return true;
		}

		// Build the node out of everything the brackets enclose.
		const type = identifier === undefined ? (isImage ? "image" : "link") : isImage ? "imageReference" : "linkReference";
		const node = makeInlineNode(type, opener.node.start, scanner.pos);

		let child = opener.node.next;
		while (child !== undefined) {
			const following = child.next;
			appendChild(node, child);
			child = following;
		}

		insertAfter(opener.node, node);

		if (identifier === undefined) {
			if (url !== undefined) {
				node.data.url = url;
			}
			if (title !== undefined) {
				node.data.title = title;
			}
		} else {
			node.data.identifier = identifier;
			node.data.label = rawLabel === undefined ? identifier : rawLabel.slice(1, -1);
			node.data.referenceType = referenceType;
		}

		// Emphasis inside the brackets is resolved before the node closes, so
		// the delimiters cannot pair with anything outside it.
		scanner.processEmphasis(opener.previousDelimiter);
		scanner.removeBracket();
		unlink(opener.node);

		if (isImage) {
			// mdast images carry alt text, not children.
			node.value = plainTextOf(childrenOf(node));
			for (const orphan of childrenOf(node)) {
				unlink(orphan);
			}
		} else {
			// Links do not nest: every earlier link opener is spent.
			for (let earlier = scanner.brackets; earlier !== undefined; earlier = earlier.previous) {
				if (!earlier.image) {
					earlier.active = false;
				}
			}
		}

		return true;
	},
};
