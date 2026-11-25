// MD042 `no-empty-links`: a port of markdownlint's lib/md042.mjs over the
// kit tree. markdownlint reads each `link` token's label, reference and
// resource: a resource's destination string as written (`(<#>)` is `#`,
// `(<>)` is none), a reference's label looked up among the definitions by
// markdownlint's label normalization (the first definition wins, and only a
// destination written without angle brackets counts). The kit reads the same
// parts from each link's source, links of image descriptions included (see
// `imageLabelNodes`). Links micromark reads as math, or inside an HTML block,
// are none.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { imageLabelNodes, inlineNodes } from "../internal/inline.js";
import { errorContext } from "../internal/lines.js";
import { labelEnd } from "../internal/math-text.js";
import { normalizeLabel, rawDestination, referenceData, skipSpace } from "../internal/references.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `definitions` (see `referenceData`): each definition's normalized label to its destination as
// written, the first one winning; a destination in angle brackets reads as none.
const definitionsOf = (context: LintContext): ReadonlyMap<string, string> =>
	new Map([...referenceData(context).definitions].map(([label, definition]) => [label, definition.destination]));

// Whether the link at `[start, end)` is empty, as markdownlint reads its parts.
const isEmpty = (source: string, start: number, end: number, definitions: ReadonlyMap<string, string>): boolean => {
	const close = labelEnd(source, start, end);
	const labelText = source.slice(start + 1, close);
	const hash = (label: string) => definitions.get(normalizeLabel(label)) === "#";
	const next = source.charAt(close + 1);
	if (next === "(") {
		const at = skipSpace(source, close + 2, end);
		if (source.charAt(at) === "<") {
			const closing = source.indexOf(">", at);
			const destination = source.slice(at + 1, closing === -1 ? at + 1 : closing);
			return destination.length === 0 || destination.trim() === "#";
		}
		const destination = rawDestination(source, at, end);
		return destination.length === 0 || destination.trim() === "#";
	}
	if (next === "[") {
		const referenceClose = labelEnd(source, close + 1, end);
		const reference = source.slice(close + 2, referenceClose);
		// A collapsed reference resolves by its label.
		if (reference.length === 0) return labelText.length > 0 && hash(labelText);
		return hash(reference);
	}
	return labelText.length > 0 && hash(labelText);
};

/**
 * MD042 `no-empty-links`: a link goes somewhere.
 *
 * @remarks
 * No settings. A link with no destination, or the destination `#`, or a
 * reference to a definition whose destination is `#`, is reported.
 *
 * @public
 */
export const MD042: Lint.LintRule = LintRule.make({
	names: ["MD042", "no-empty-links"],
	description: "No empty links",
	tags: ["links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md042.md",
	check: (context, report) => {
		const { source } = context;
		const definitions = definitionsOf(context);
		const links: Array<readonly [number, number]> = [];
		for (const type of ["link", "linkReference"]) {
			for (const node of inlineNodes(context, type)) {
				// An autolink is no link to markdownlint's MD042: it has no label.
				if (source.charAt(node.position.start.offset) === "[") {
					links.push([node.position.start.offset, node.position.end.offset]);
				}
			}
		}
		for (const span of imageLabelNodes(context)) if (span.type === "link") links.push([span.start, span.end]);
		links.sort((a, b) => a[0] - b[0]);
		for (const [start, end] of links) {
			if (!isEmpty(source, start, end, definitions)) continue;
			// markdownlint's range is the link's end column less its start column, whatever lines they are on.
			const startLine = context.mapping.lineNumber(start);
			const endLine = context.mapping.lineNumber(end);
			const length = end - context.mapping.lineStart(endLine) - (start - context.mapping.lineStart(startLine));
			report(
				context.diagnostic({
					at: { offset: start, length: 0 },
					context: errorContext(source.slice(start, end)),
					...(length > 0 ? { range: { offset: start, length } } : {}),
				}),
			);
		}
	},
});
