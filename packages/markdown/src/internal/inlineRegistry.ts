// Ported from commonmark.js@0.31.2 (https://github.com/commonmark/commonmark.js)
// Copyright (c) 2014-2023 John MacFarlane
// License: BSD-2-Clause
//
// Upstream's `parseInline` switch, as a per-dialect trigger table. The switch
// order is preserved where a character has more than one construct: `<` tries
// an autolink before raw HTML, exactly as
// `this.parseAutolink(block) || this.parseHtmlTag(block)` does.
//
// Task 9 registers emphasis on `*`/`_` and links on `[`, `]` and `!`. Until
// then those characters have no construct, fall through to the text
// fallback — whose pattern excludes them — and end up as literal single
// characters, which is the correct intermediate behavior rather than a
// special case.

import { autolinkConstruct } from "./inlines/autolink.js";
import { codeSpanConstruct } from "./inlines/codeSpan.js";
import { entityConstruct } from "./inlines/entity.js";
import { escapeConstruct } from "./inlines/escape.js";
import { lineBreakConstruct } from "./inlines/lineBreak.js";
import { rawHtmlConstruct } from "./inlines/rawHtml.js";
import { textConstruct } from "./inlines/text.js";
import type { InlineConstruct, InlineDialect } from "./inlineTypes.js";

/** The dialects the inline pass can be keyed by. P2 widens this union. */
export type InlineDialectName = "commonmark";

const triggerTable = (
	constructs: ReadonlyArray<InlineConstruct>,
): ReadonlyMap<number, ReadonlyArray<InlineConstruct>> => {
	// A real Map keyed by char code — the house rule for every lookup table.
	const table = new Map<number, InlineConstruct[]>();
	for (const construct of constructs) {
		for (const trigger of construct.triggers) {
			const bucket = table.get(trigger);
			if (bucket === undefined) {
				table.set(trigger, [construct]);
			} else {
				bucket.push(construct);
			}
		}
	}
	return table;
};

const commonmarkDialect: InlineDialect = {
	byTrigger: triggerTable([
		lineBreakConstruct,
		escapeConstruct,
		codeSpanConstruct,
		// emphasis — Task 9 (`*`, `_`)
		// link, image — Task 9 (`[`, `]`, `!`)
		autolinkConstruct,
		rawHtmlConstruct,
		entityConstruct,
	]),
	text: textConstruct,
};

const dialects: ReadonlyMap<InlineDialectName, InlineDialect> = new Map([["commonmark", commonmarkDialect]]);

/**
 * The inline tables for `dialect`.
 *
 * An unknown dialect cannot arrive through the schema-typed public surface,
 * so it is programmer error and dies as a defect.
 */
export const inlineDialect = (dialect: InlineDialectName): InlineDialect => {
	const found = dialects.get(dialect);
	if (found === undefined) {
		throw new TypeError(`unknown markdown dialect: ${String(dialect)}`);
	}
	return found;
};
