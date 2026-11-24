// Inline content as markdownlint's micromark reads it: the kit's inline
// nodes, less any micromark reads as math. A math block's lines are
// `mathFlow`, and a `$` run that opens before a node makes the node part of
// its `mathText`, so neither carries the inline tokens an inline rule walks.
// Every rule that reads inline nodes enumerates them here.

import type { MarkdownNode } from "@effected/markdown";
import type { LintContext } from "../LintContext.js";
import { mathFlowLines } from "./math-flow.js";
import type { Span } from "./math-text.js";
import { mathTextSpans } from "./math-text.js";
import { perReading } from "./memo.js";

// Whether `offset` lies in one of `spans`, which are sorted by start and do not overlap: a binary search.
const inSortedSpans = (spans: ReadonlyArray<Span>, offset: number): boolean => {
	let low = 0;
	let high = spans.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const span = spans[middle] as Span;
		if (offset < span.start) high = middle - 1;
		else if (offset >= span.end) low = middle + 1;
		else return true;
	}
	return false;
};

/**
 * Whether micromark reads the inline content at `node`'s start as inline
 * content, not math: its line is in no math block (inclusive: on a math
 * opener line it is the fence's meta, see `mathFlowLines`) and its start in
 * no inline math span. Built once per reading.
 * @internal
 */
export const outsideMath: (context: LintContext) => (node: MarkdownNode) => boolean = perReading((context) => {
	const flow = mathFlowLines(context);
	const spans = [...mathTextSpans(context.document, context.source)].sort((a, b) => a.start - b.start);
	return (node) => !flow.has(node.position.start.line) && !inSortedSpans(spans, node.position.start.offset);
});

/**
 * Every inline node of `type`, in document order, less any micromark reads
 * as math (see {@link outsideMath}).
 * @internal
 */
export const inlineNodes = (context: LintContext, type: string): ReadonlyArray<MarkdownNode> => {
	const keep = outsideMath(context);
	return (context.document.findAll((node) => node.type === type) as ReadonlyArray<MarkdownNode>).filter(keep);
};
