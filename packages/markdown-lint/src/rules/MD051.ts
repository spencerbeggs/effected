// MD051 `link-fragments`: a port of markdownlint's lib/md051.mjs over the kit
// tree. markdownlint collects the fragments a document defines — `#top`, each
// heading's as GitHub writes it (its data, escapes' values, code and math
// data, lowered, all but letters, marks, numbers, connector punctuation, `-`
// and spaces dropped, spaces turned to `-`, a repeat suffixed `-1`, `-2`), a
// heading's `{#anchor}`, and an HTML tag's `id` (or an `<a>`'s `name`) —
// then checks each link's destinations (its own and its images') and each
// definition's: a `#fragment` none defines is reported, unless it is a line
// fragment (`#L20`, `#L19C5-L21C11`) or `ignored_pattern` (run as written)
// matches it; one
// that differs from a defined fragment only in case is reported with that
// fragment as the fix, unless `ignore_case`.

import type { MarkdownNode } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { htmlTagInfo, htmlTextTokens } from "../internal/html-text.js";
import { characterReference, codeSpanParts, isReference } from "../internal/inline.js";
import { mathFlowLines } from "../internal/math-flow.js";
import { labelEnd, mathTextSpans } from "../internal/math-text.js";
import { rawDestination, referenceData, skipSpace } from "../internal/references.js";
import { flagSetting } from "../internal/settings.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

const idRe = /\sid\s*=\s*['"]?([^'"\s>]*)/iu;
const nameRe = /\sname\s*=\s*['"]?([^'"\s>]*)/iu;
const anchorRe = /\{(#[a-z\d]+(?:[-_]+[a-z\d]+)*)\}/gu;
const lineFragmentRe = /^#(?:L\d+(?:C\d+)?-L\d+(?:C\d+)?|L\d+)$/;

const childrenOf = (node: MarkdownNode): ReadonlyArray<MarkdownNode> =>
	(node as { readonly children?: ReadonlyArray<MarkdownNode> }).children ?? [];

/**
 * markdownlint's `new RegExp(ignored_pattern || "^$")`, run as written. Where it throws (a pattern that does not
 * compile), the kit reads the default, `^$`. A `RegExp` (from a JavaScript config) keeps its flags.
 */
const ignoredPattern = (value: unknown): RegExp => {
	const fallback = /^$/;
	const setting = value || "";
	if (setting instanceof RegExp) return new RegExp(setting);
	try {
		return new RegExp(String(setting || "^$"));
	} catch {
		return fallback;
	}
};

// markdownlint's `convertHeadingToHTMLFragment`.
const fragmentOf = (text: string): string =>
	`#${encodeURIComponent(
		text
			.toLowerCase()
			.replace(/[^\p{Letter}\p{Mark}\p{Number}\p{Connector_Punctuation}\- ]/gu, "")
			.replace(/ /gu, "-")
			.toWellFormed(),
	)}`;

// A heading's text as markdownlint reads it for its fragment: its data (no line endings, line prefixes or trailing
// whitespace), escapes' values, code and math data, links' labels; never an image, a reference, a resource, a
// character reference, an autolink, inline HTML or an emphasis sequence.
const headingText = (
	context: LintContext,
	heading: MarkdownNode,
	math: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): string => {
	const { source } = context;
	let text = "";
	let skipUntil = 0;
	// The math span holding `offset`: the spans are disjoint and in order, so one search finds the last one before it.
	const mathAt = (offset: number) => {
		let low = 0;
		let high = math.length - 1;
		let found: (typeof math)[number] | undefined;
		while (low <= high) {
			const middle = (low + high) >> 1;
			const span = math[middle] as (typeof math)[number];
			if (span.start <= offset) {
				found = span;
				low = middle + 1;
			} else high = middle - 1;
		}
		return found !== undefined && offset < found.end ? found : undefined;
	};
	// A math span's data: inside its `$` runs, a space either side dropped when both are and it is not all spaces.
	const mathData = (start: number, end: number): string => {
		let open = start;
		while (open < end && source.charAt(open) === "$") open++;
		let close = end;
		while (close > open && source.charAt(close - 1) === "$") close--;
		let inner = source.slice(open, close);
		if (/^[ \r\n]/.test(inner) && /[ \r\n]$/.test(inner) && /[^ \r\n]/.test(inner)) inner = inner.slice(1, -1);
		return inner.replace(/[ \t]*\r?\n[ \t>]*/g, "");
	};
	const scan = (from: number, to: number): void => {
		for (let at = Math.max(from, skipUntil); at < to; at++) {
			const span = mathAt(at);
			if (span !== undefined) {
				text += mathData(span.start, span.end);
				skipUntil = span.end;
				at = span.end - 1;
				continue;
			}
			const char = source.charAt(at);
			if (char === "\\" && /[!-/:-@[-`{-~]/.test(source.charAt(at + 1))) {
				text += source.charAt(at + 1);
				at++;
				continue;
			}
			if (char === "&") {
				const reference = characterReference.exec(source.slice(at, Math.min(to, at + 40)))?.[0];
				if (reference !== undefined && isReference(reference)) {
					at += reference.length - 1;
					continue;
				}
			}
			if (char === "\r" || char === "\n") {
				text = text.replace(/[ \t]+$/, "");
				if (char === "\r" && source.charAt(at + 1) === "\n") at++;
				while (at + 1 < to && /[ \t>]/.test(source.charAt(at + 1))) at++;
				continue;
			}
			text += char;
		}
	};
	const visit = (node: MarkdownNode): void => {
		const start = node.position.start.offset;
		const end = node.position.end.offset;
		if (end <= skipUntil) return;
		const children = childrenOf(node);
		switch (node.type) {
			case "text":
				scan(start, end);
				return;
			case "inlineCode":
				if (mathAt(start) !== undefined) scan(start, end);
				else for (const data of codeSpanParts(context, node).datas) text += source.slice(data.start, data.end);
				return;
			case "delete":
				// markdownlint reads no strikethrough: its delimiters are data.
				scan(start, (children[0] as MarkdownNode | undefined)?.position.start.offset ?? end);
				for (const child of children) visit(child);
				if (children.length > 0) scan((children[children.length - 1] as MarkdownNode).position.end.offset, end);
				return;
			case "link":
			case "linkReference":
				if (source.charAt(start) === "[") for (const child of children) visit(child);
				return;
			case "image":
			case "imageReference":
			case "html":
			case "footnoteReference":
			case "break":
				return;
			default:
				if (mathAt(start) !== undefined) scan(start, end);
				else for (const child of children) visit(child);
		}
	};
	for (const child of childrenOf(heading)) visit(child);
	return text;
};

// A heading's text as written, for its `{#anchor}`s: from its first inline node to its last.
const headingSource = (source: string, heading: MarkdownNode): string => {
	const children = childrenOf(heading);
	const first = children[0];
	const last = children[children.length - 1];
	return first === undefined || last === undefined
		? ""
		: source.slice(first.position.start.offset, last.position.end.offset);
};

// markdownlint's `unescapeStringTokenText`: a destination string's data and escapes' values, character references
// left out.
const unescaped = (text: string): string => {
	let out = "";
	for (let at = 0; at < text.length; at++) {
		const char = text.charAt(at);
		if (char === "\\" && /[!-/:-@[-`{-~]/.test(text.charAt(at + 1))) {
			out += text.charAt(at + 1);
			at++;
			continue;
		}
		if (char === "&") {
			const reference = characterReference.exec(text.slice(at, at + 40))?.[0];
			if (reference !== undefined && isReference(reference)) {
				at += reference.length - 1;
				continue;
			}
		}
		out += char;
	}
	return out;
};

/**
 * MD051 `link-fragments`: a link fragment names a heading or anchor the
 * document defines.
 *
 * @remarks
 * Settings: `ignore_case` (default `false`) accepts a fragment differing in
 * case, and `ignored_pattern` (default none) names fragments never reported.
 * The fix rewrites a fragment differing only in case to the defined one.
 *
 * @public
 */
export const MD051: Lint.LintRule = LintRule.make({
	names: ["MD051", "link-fragments"],
	description: "Link fragments should be valid",
	tags: ["links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md051.md",
	check: (context, report) => {
		const { source } = context;
		const ignoreCase = flagSetting(context.config, "ignore_case");
		const ignored = ignoredPattern(context.config.ignored_pattern);
		const flow = mathFlowLines(context);
		const math = [...mathTextSpans(context.document, source)].sort((a, b) => a.start - b.start);
		const fragments = new Map<string, number>([["#top", 0]]);

		const headings = (context.document.findAll("heading") as ReadonlyArray<MarkdownNode>).filter(
			(heading) => !flow.has(heading.position.start.line),
		);
		for (const heading of headings) {
			const fragment = fragmentOf(headingText(context, heading, math));
			if (fragment === "#") continue;
			const count = fragments.get(fragment) || 0;
			if (count) fragments.set(`${fragment}-${count}`, 0);
			fragments.set(fragment, count + 1);
			for (const match of headingSource(source, heading).matchAll(anchorRe)) {
				const anchor = match[1] as string;
				if (!fragments.has(anchor)) fragments.set(anchor, 1);
			}
		}
		for (const token of htmlTextTokens(context)) {
			const tag = htmlTagInfo(token.text);
			if (tag === undefined || tag.close) continue;
			const anchor = idRe.exec(token.text) ?? (tag.name.toLowerCase() === "a" ? nameRe.exec(token.text) : null);
			if (anchor !== null) fragments.set(`#${anchor[1]}`, 0);
		}

		// The first defined fragment by its lowercase, as markdownlint's search of the keys in order finds it, built once.
		const byLowercase = new Map<string, string>();
		for (const key of fragments.keys()) {
			const lower = key.toLowerCase();
			if (!byLowercase.has(lower)) byLowercase.set(lower, key);
		}

		const check = (container: { readonly start: number; readonly end: number }, from: number, to: number) => {
			const text = unescaped(source.slice(from, to));
			const fragment = text.slice(1);
			if (text.length <= 1 || !text.startsWith("#")) return;
			const encoded = `#${encodeURIComponent(fragment.toWellFormed())}`;
			if (fragments.has(encoded) || lineFragmentRe.test(encoded) || ignored.test(fragment)) return;
			const oneLine = context.mapping.lineNumber(container.start) === context.mapping.lineNumber(container.end);
			const shown = oneLine
				? {
						context: source.slice(container.start, container.end),
						range: { offset: container.start, length: container.end - container.start },
					}
				: {};
			const mixedCase = byLowercase.get(text.toLowerCase());
			if (mixedCase === undefined) {
				report(context.diagnostic({ at: { offset: container.start, length: 0 }, ...shown }));
				return;
			}
			if (ignoreCase || mixedCase === text) return;
			report(
				context.diagnostic({
					at: { offset: container.start, length: 0 },
					detail: `Expected: ${mixedCase}; Actual: ${text}`,
					...shown,
					...(oneLine ? { fix: { offset: from, length: to - from, content: mixedCase } } : {}),
				}),
			);
		};

		// Each link's destinations, its images' among them, in order: the media its span holds follow it. A docfx tab
		// heading's link (an ATX heading whose one inline node is a link with one destination, `#tab/...`) is left out.
		const { media } = referenceData(context);
		const onlyLinks = new Set<number>();
		for (const heading of headings) {
			const children = childrenOf(heading);
			const only = children[0];
			if (children.length === 1 && only?.type === "link" && source.charAt(heading.position.start.offset) === "#") {
				onlyLinks.add(only.position.start.offset);
			}
		}
		for (let index = 0; index < media.length; index++) {
			const link = media[index] as (typeof media)[number];
			if (link.image || link.kind === "autolink") continue;
			const inside: Array<{ readonly start: number; readonly end: number; readonly text: string }> = [];
			for (let next = index; next < media.length; next++) {
				const medium = media[next] as (typeof media)[number];
				// Every destination its span holds is the link's too: markdownlint reads them all under it.
				if (next > index && medium.start >= link.end) break;
				if (medium.destinationStart !== undefined && medium.destinationEnd !== undefined) {
					inside.push({ start: medium.destinationStart, end: medium.destinationEnd, text: medium.destination ?? "" });
				}
			}
			if (onlyLinks.has(link.start) && inside.length === 1 && /^#tab\//.test(inside[0]?.text ?? "")) continue;
			for (const destination of inside.sort((a, b) => a.start - b.start)) {
				check(link, destination.start, destination.end);
			}
		}

		for (const node of context.document.findAll("definition") as ReadonlyArray<MarkdownNode>) {
			if (flow.has(node.position.start.line)) continue;
			const start = node.position.start.offset;
			const end = node.position.end.offset;
			const at = skipSpace(source, labelEnd(source, start, end) + 2, end);
			if (source.charAt(at) === "<") {
				let stop = at + 1;
				while (stop < end && source.charAt(stop) !== ">") stop += source.charAt(stop) === "\\" ? 2 : 1;
				if (stop > at + 1) check({ start, end }, at + 1, stop);
			} else {
				const destination = rawDestination(source, at, end);
				if (destination !== "") check({ start, end }, at, at + destination.length);
			}
		}
	},
});
