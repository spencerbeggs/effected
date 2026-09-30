import type { Block, Document, Inline, LinkTarget } from "../Doc.js";
import { Doc } from "../Doc.js";
import { Fmt } from "../Fmt.js";
import type { RenderContext } from "../Render.js";
import { displayWidth } from "./displayWidth.js";
import type { Span } from "./layout.js";
import { flatten, sanitize, wrapSpans } from "./layout.js";

const oneLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

const textLines = (text: string): ReadonlyArray<string> => {
	const lines = sanitize(text).split(/\r\n|\r|\n/);
	return lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
};

const pad = (text: string, width: number, align: "left" | "right" | "center"): string => {
	const gap = Math.max(0, width - displayWidth(text));
	if (align === "right") return " ".repeat(gap) + text;
	if (align === "center") return " ".repeat(Math.floor(gap / 2)) + text + " ".repeat(Math.ceil(gap / 2));
	return text + " ".repeat(gap);
};

/** A link target as plain text: the URL, or `path:line:col` through `displayPath`; a column needs a line. */
const targetText = (target: LinkTarget, ctx: RenderContext): string => {
	if ("url" in target) return sanitize(target.url);
	const path = sanitize(ctx.displayPath(target.file));
	if (target.line === undefined) return path;
	return target.col === undefined ? `${path}:${target.line}` : `${path}:${target.line}:${target.col}`;
};

/**
 * Inline content as spans of plain text: code in backticks, and a link as its label followed by its target in
 * parentheses unless the label already is the target. Styles and links are dropped, as plain text has neither.
 */
const inlineSpans = (inlines: ReadonlyArray<Inline>, ctx: RenderContext): ReadonlyArray<Span> => {
	const flat = flatten(inlines, ctx);
	const out: Array<Span> = [];
	let i = 0;
	while (i < flat.length) {
		const link = (flat[i] as Span).link;
		let label = "";
		do {
			const span = flat[i] as Span;
			label += span.text;
			out.push({ text: span.code === true ? `\`${span.text}\`` : span.text });
			i++;
		} while (link !== undefined && i < flat.length && (flat[i] as Span).link === link);
		if (link !== undefined) {
			const target = targetText(link, ctx);
			if (label !== target) out.push({ text: ` (${target})` });
		}
	}
	return out;
};

const inlineText = (inlines: ReadonlyArray<Inline>, ctx: RenderContext): string =>
	oneLine(
		inlineSpans(inlines, ctx)
			.map((span) => span.text)
			.join(""),
	);

const wrapped = (inlines: ReadonlyArray<Inline>, ctx: RenderContext, width: number): ReadonlyArray<string> => {
	const spans = inlineSpans(inlines, ctx);
	if (spans.length === 0) return [""];
	return wrapSpans(spans, width, { hardBreak: false }).map((line) =>
		line
			.map((span) => span.text)
			.join("")
			.trimEnd(),
	);
};

/** Put `first` before the first line and `rest` before the others; trailing spaces never survive. */
const hang = (lines: ReadonlyArray<string>, first: string, rest: string): ReadonlyArray<string> =>
	lines.length === 0 ? [first.trimEnd()] : lines.map((line, index) => `${index === 0 ? first : rest}${line}`.trimEnd());

const overflowLine = (
	overflow: ((hidden: number) => ReadonlyArray<Inline>) | undefined,
	hidden: number,
	ctx: RenderContext,
): string => (overflow === undefined ? `${ctx.glyphs.ellipsis} ${hidden} more` : inlineText(overflow(hidden), ctx));

const capOf = (cap: number | undefined): number | undefined =>
	cap === undefined || Number.isNaN(cap) ? undefined : Math.max(0, Math.floor(cap));

const shrink = (widths: Array<number>, limit: number): void => {
	const gaps = 2 * Math.max(0, widths.length - 1);
	const total = (): number => widths.reduce((sum, w) => sum + w, 0) + gaps;
	while (total() > limit) {
		let widest = 0;
		for (let i = 1; i < widths.length; i++) if ((widths[i] as number) > (widths[widest] as number)) widest = i;
		if ((widths[widest] ?? 0) <= 1) return;
		widths[widest] = (widths[widest] as number) - 1;
	}
};

const tableLines = (
	block: Extract<Block, { readonly _tag: "Table" }>,
	ctx: RenderContext,
	width: number,
): ReadonlyArray<string> => {
	const columns = Math.max(block.columns.length, ...block.rows.map((row) => row.length));
	if (columns === 0) return [];
	const cap = capOf(block.cap);
	const shown = cap === undefined ? block.rows : block.rows.slice(0, cap);
	// A cell is one line: a line break is width 0 to a measure but breaks the row, so take the first line, with an
	// ellipsis to say there was more, before anything measures or cuts it.
	const cell = (inlines: ReadonlyArray<Inline> | undefined): string => {
		if (inlines === undefined) return "";
		const raw = inlineSpans(inlines, ctx)
			.map((span) => span.text)
			.join("")
			.replace(/(?:\r\n|\r|\n)+$/, "");
		const lines = raw.split(/\r\n|\r|\n/);
		return lines.length > 1 ? `${lines[0]}${ctx.glyphs.ellipsis}` : raw;
	};
	const cells = (row: ReadonlyArray<ReadonlyArray<Inline>>): Array<string> =>
		Array.from({ length: columns }, (_, index) => cell(row[index]));
	const header = Array.from({ length: columns }, (_, index) => cell(block.columns[index]?.header));
	const body = shown.map(cells);
	const showHeader = header.some((text) => text !== "");

	const widths = Array.from({ length: columns }, (_, index) =>
		Math.max(...[...(showHeader ? [header] : []), ...body].map((row) => displayWidth(row[index] ?? ""))),
	);
	shrink(widths, width);

	const render = (row: ReadonlyArray<string>): string =>
		row
			.map((text, index) => {
				const columnWidth = widths[index] as number;
				const cut =
					displayWidth(text) > columnWidth ? Fmt.truncate(text, columnWidth, { ellipsis: ctx.glyphs.ellipsis }) : text;
				return pad(cut, columnWidth, block.columns[index]?.align ?? "left");
			})
			.join("  ")
			.trimEnd();

	const lines = [
		...(showHeader ? [render(header), widths.map((w) => "-".repeat(w)).join("  ")] : []),
		...body.map(render),
	];
	const hidden = block.rows.length - shown.length;
	return hidden > 0 ? [...lines, overflowLine(block.overflow, hidden, ctx)] : lines;
};

const treeLines = (block: Extract<Block, { readonly _tag: "Tree" }>, ctx: RenderContext): ReadonlyArray<string> => {
	const glyphs = ctx.glyphs.tree;
	const lines = [inlineText(block.root.label, ctx)];
	const walk = (children: typeof block.root.children, prefix: string): void => {
		children.forEach((child, index) => {
			const last = index === children.length - 1;
			lines.push(`${prefix}${last ? glyphs.last : glyphs.branch}${inlineText(child.label, ctx)}`.trimEnd());
			walk(child.children, prefix + (last ? glyphs.blank : glyphs.pipe));
		});
	};
	walk(block.root.children, "");
	return lines;
};

const diffSide = (marker: string, text: string, cap: number | undefined, ctx: RenderContext): ReadonlyArray<string> => {
	const lines = textLines(text);
	const shown = cap === undefined ? lines : lines.slice(0, cap);
	const hidden = lines.length - shown.length;
	return [
		...shown.map((line) => `${marker} ${line}`.trimEnd()),
		...(hidden > 0 ? [`  ${ctx.glyphs.ellipsis} ${hidden} more lines`] : []),
	];
};

const countsLines = (block: Extract<Block, { readonly _tag: "Counts" }>, ctx: RenderContext): ReadonlyArray<string> => {
	const visible = Doc.visibleCounters(block);
	const total = Doc.total(block);
	const label = block.label === undefined ? "" : inlineText(block.label, ctx);
	const qualifier = block.qualifier === undefined ? "" : inlineText(block.qualifier, ctx);
	const duration = block.durationMs === undefined ? "" : Fmt.duration(block.durationMs);
	// The first counter is the headline: it shows its share of the total.
	const texts = visible.map((counter, index) =>
		index === 0 ? `${counter.n}/${total} ${sanitize(counter.label)}` : `${counter.n} ${sanitize(counter.label)}`,
	);

	if (block.layout === "row") {
		return [[label, ...texts, qualifier, duration].filter((part) => part !== "").join("  ")];
	}
	if (block.layout === "columns") {
		const labelWidth = Math.max(0, ...visible.map((counter) => displayWidth(sanitize(counter.label))));
		const numberWidth = Math.max(0, ...visible.map((counter) => String(counter.n).length));
		return [
			...(label === "" ? [] : [label]),
			...visible.map((counter) =>
				`${pad(sanitize(counter.label), labelWidth, "left")}  ${pad(String(counter.n), numberWidth, "right")}`.trimEnd(),
			),
			...(qualifier === "" ? [] : [qualifier]),
			...(duration === "" ? [] : [duration]),
		];
	}
	const head = [label === "" ? "" : `${label}:`, texts.join(", ")].filter((part) => part !== "").join(" ");
	const parts = [head, qualifier, duration === "" ? "" : `(${duration})`].filter((part) => part !== "");
	return [parts.join(" ")];
};

const blockLines = (block: Block, ctx: RenderContext, width: number): ReadonlyArray<string> => {
	switch (block._tag) {
		case "Heading":
			return [inlineText(block.content, ctx)];
		case "Paragraph":
			return wrapped(block.content, ctx, width);
		case "List": {
			const cap = capOf(block.cap);
			const shown = cap === undefined ? block.items : block.items.slice(0, cap);
			const lines = shown.flatMap((item) => hang(blockLines(item, ctx, width - 2), "- ", "  "));
			const hidden = block.items.length - shown.length;
			return hidden > 0 ? [...lines, overflowLine(block.overflow, hidden, ctx)] : lines;
		}
		case "Table":
			return tableLines(block, ctx, width);
		case "Tree":
			return treeLines(block, ctx);
		case "Collapsible":
			return [
				inlineText(block.title, ctx),
				...block.body.flatMap((child) => blockLines(child, ctx, width - 2)).map((line) => `  ${line}`.trimEnd()),
			];
		case "Callout": {
			const label = `${block.kind.toUpperCase()}:`;
			const hanging = label.length + 1;
			const body = block.body.flatMap((child) => blockLines(child, ctx, width - hanging));
			return body.length === 0 ? [label] : hang(body, `${label} `, " ".repeat(hanging));
		}
		case "CodeBlock":
			return textLines(block.text).map((line) => `    ${line}`.trimEnd());
		case "Diff": {
			const cap = capOf(block.cap);
			return [...diffSide("-", block.expected, cap, ctx), ...diffSide("+", block.received, cap, ctx)];
		}
		case "Section": {
			const groups = [
				...(block.title === undefined ? [] : [[inlineText(block.title, ctx)]]),
				...block.children.map((child) => blockLines(child, ctx, width)),
			];
			return groups.flatMap((group, index) => (index === 0 ? group : ["", ...group]));
		}
		case "Counts":
			return countsLines(block, ctx);
	}
};

/**
 * Render a document as plain text for an agent: no escape sequences, no decoration.
 *
 * @internal
 */
export const renderPlain = (doc: Document, ctx: RenderContext): string => {
	// Plain text is for agents whatever the context says, so the path separator is always the agent one.
	const agent: RenderContext = { ...ctx, audience: "agent" };
	const width = Number.isNaN(agent.width) ? 80 : Math.max(1, agent.width);
	return doc.flatMap((block) => blockLines(block, agent, width)).join("\n");
};
