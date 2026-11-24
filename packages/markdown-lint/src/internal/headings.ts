// Headings as markdownlint reads them: their order (less any inside math),
// style, opening and closing runs and text, and the front matter title and
// top-level blocks the title rules read.

import type { Heading, MarkdownNode } from "@effected/markdown";
import { Option } from "effect";
import type { LintContext } from "../LintContext.js";
import { LINE_BREAK } from "./line-endings.js";
import { mathFlowLines } from "./math-flow.js";
import { perReading } from "./memo.js";
import { stringSetting } from "./settings.js";

/**
 * markdownlint's `frontMatterHasTitle`: whether a front matter line matches
 * `front_matter_title` (case-insensitive; default `^\s*"?title"?\s*[:=]`).
 * Any falsy value (`""`, `false`, `0`, `null`) turns front matter off, as in
 * markdownlint. A truthy pattern is read through `String`, as markdownlint
 * reads it; one that is not a valid regular expression, where markdownlint
 * throws, reads as the default.
 * @internal
 */
export const frontMatterHasTitle = (context: LintContext): boolean => {
	const fallback = '^\\s*"?title"?\\s*[:=]';
	// markdownlint turns front matter off for any falsy value (`""`, `false`, `0`, `null`), not only `""`.
	const raw = context.config.front_matter_title;
	if (raw !== undefined && !raw) return false;
	const pattern = stringSetting(context.config, "front_matter_title", fallback);
	let matcher: RegExp;
	try {
		matcher = new RegExp(pattern, "i");
	} catch {
		matcher = new RegExp(fallback, "i");
	}
	return Option.match(context.frontmatter, {
		onNone: () => false,
		onSome: (block) => block.lines.some((line) => matcher.test(line)),
	});
};

/** An ATX heading's source span, read as micromark tokenizes it. @internal */
export interface AtxParts {
	/** The opening `#` run. */
	readonly open: { readonly offset: number; readonly length: number };
	/** The closing `#` run, when the heading has one. */
	readonly closing: Option.Option<{ readonly offset: number; readonly length: number }>;
}

/**
 * Read an ATX heading's opening and closing sequences from its source span
 * (from its first `#` to its line's end). A closing run follows a space or
 * tab, or the opening run itself, and only spaces or tabs follow it.
 * @internal
 */
export const atxParts = (context: LintContext, heading: Heading): AtxParts => {
	const start = heading.position.start.offset;
	const text = context.source.slice(start, heading.position.end.offset);
	const open = (/^#+/.exec(text)?.[0] ?? "").length;
	const rest = text.slice(open);
	const match = /(^|[ \t])(#+)[ \t]*$/.exec(rest);
	return {
		open: { offset: start, length: open },
		closing:
			match === null
				? Option.none()
				: Option.some({
						offset: start + open + match.index + (match[1] as string).length,
						length: (match[2] as string).length,
					}),
	};
};

/** A heading's style as markdownlint's `getHeadingStyle` reads it. @internal */
export const headingStyle = (context: LintContext, heading: Heading): "atx" | "atx_closed" | "setext" =>
	heading.headingStyle === "setext"
		? "setext"
		: Option.isSome(atxParts(context, heading).closing)
			? "atx_closed"
			: "atx";

/**
 * The document's headings as markdownlint sees them: in document order,
 * less any the kit reads inside a math block, which micromark reads as math.
 * Computed once per reading and shared.
 * @internal
 */
export const headingNodes: (context: LintContext) => ReadonlyArray<Heading> = perReading((context) => {
	const math = mathFlowLines(context);
	// Inclusive: on a math opener line, this is the fence's meta (see `mathFlowLines`).
	return (context.document.findAll("heading") as ReadonlyArray<Heading>).filter(
		(heading) => !math.has(heading.position.start.line),
	);
});

/**
 * markdownlint's `getHeadingText`: the heading's content as written — each
 * direct child's source text, inline HTML left out — with line breaks read
 * as spaces, trimmed.
 * @internal
 */
export const headingText = (context: LintContext, heading: Heading): string =>
	(heading.children as ReadonlyArray<MarkdownNode>)
		.filter((child) => child.type !== "html")
		.map((child) => context.source.slice(child.position.start.offset, child.position.end.offset))
		.join("")
		.replace(LINE_BREAK, " ")
		.trim();

/** The document's top-level blocks after its front matter: micromark's top-level content tokens. @internal */
export const contentBlocks = (context: LintContext): ReadonlyArray<MarkdownNode> =>
	(context.document.root.children as ReadonlyArray<MarkdownNode>).filter((node) => node.type !== "frontmatter");
