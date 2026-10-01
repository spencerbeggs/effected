import type { Block, Document, Inline, LinkTarget } from "../Doc.js";
import { Doc } from "../Doc.js";
import { Fmt } from "../Fmt.js";
import type { RenderContext } from "../Render.js";
import type { Style, TokenName } from "../Token.js";
import type { Span } from "./layout.js";
import { sanitize, truncateSpans, widthOf, wrapSpans } from "./layout.js";

/** One output line as spans; each span keeps its token and link until the line is finished. */
export type Line = ReadonlyArray<Span>;

/**
 * What differs between the text renderers. The walk, the layout and every width rule are shared; a renderer only
 * decides how inline content becomes spans, and how a finished line becomes a string.
 *
 * @internal
 */
export interface Flavour {
	/** Inline nodes as spans: code markers, the link policy, and whether tokens are kept. */
	readonly inline: (inlines: ReadonlyArray<Inline>, ctx: RenderContext) => ReadonlyArray<Span>;
	/** A finished line as the string that is printed. */
	readonly finish: (line: Line, ctx: RenderContext) => string;
}

type Tone = TokenName | Style;

const span = (text: string, token?: Tone): Span => (token === undefined ? { text } : { text, token });

const textOf = (line: Line): string => line.map((s) => s.text).join("");

/** A link target as plain text: the URL, or `path:line:col` through `displayPath`; a column needs a line. */
export const targetText = (target: LinkTarget, ctx: RenderContext): string => {
	if ("url" in target) return sanitize(target.url);
	const path = sanitize(ctx.displayPath(target.file));
	if (target.line === undefined) return path;
	return target.col === undefined ? `${path}:${target.line}` : `${path}:${target.line}:${target.col}`;
};

/** Drop trailing spaces, and any span they empty, so a line never ends in padding. */
export const trimLine = (line: Line): Line => {
	const out = [...line];
	while (out.length > 0) {
		const last = out[out.length - 1] as Span;
		const trimmed = last.text.trimEnd();
		if (trimmed === "") {
			out.pop();
			continue;
		}
		if (trimmed !== last.text) out[out.length - 1] = { ...last, text: trimmed };
		break;
	}
	return out;
};

const oneLine = (spans: ReadonlyArray<Span>): ReadonlyArray<Span> =>
	spans.map((s) => ({ ...s, text: s.text.replace(/\r\n|\r|\n/g, " ") }));

/** Give every span without a token of its own this one. */
const toned = (spans: ReadonlyArray<Span>, token: Tone): ReadonlyArray<Span> =>
	spans.map((s) => (s.token === undefined ? { ...s, token } : s));

const sliceSpans = (spans: ReadonlyArray<Span>, end: number): ReadonlyArray<Span> => {
	const out: Array<Span> = [];
	let left = end;
	for (const s of spans) {
		if (left <= 0) break;
		out.push(s.text.length <= left ? s : { ...s, text: s.text.slice(0, left) });
		left -= s.text.length;
	}
	return out;
};

/** The lines of a raw text, sanitized, without the empty line a trailing break would add. */
export const textLines = (text: string): ReadonlyArray<string> => {
	const lines = sanitize(text).split(/\r\n|\r|\n/);
	return lines.length > 1 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
};

/** Join chunks with a separator, skipping empty ones. */
const joinChunks = (chunks: ReadonlyArray<ReadonlyArray<Span>>, separator: string): Line =>
	chunks
		.filter((chunk) => chunk.length > 0)
		.flatMap((chunk, index) => (index === 0 ? chunk : [span(separator), ...chunk]));

/** Join table cells with a separator, keeping an empty one: a column that is empty in every row still takes its place. */
const joinCells = (cells: ReadonlyArray<ReadonlyArray<Span>>, separator: string): Line =>
	cells.flatMap((cell, index) => (index === 0 ? cell : [span(separator), ...cell]));

const blank = (width: number): Span => span(" ".repeat(width));

const pad = (spans: ReadonlyArray<Span>, width: number, align: "left" | "right" | "center"): Line => {
	const gap = Math.max(0, width - widthOf(spans));
	const before = align === "right" ? gap : align === "center" ? Math.floor(gap / 2) : 0;
	const after = gap - before;
	return [...(before > 0 ? [blank(before)] : []), ...spans, ...(after > 0 ? [blank(after)] : [])];
};

/** Put `first` before the first line and `rest` before the others. */
const hang = (lines: ReadonlyArray<Line>, first: Line, rest: Line): ReadonlyArray<Line> =>
	lines.length === 0
		? [trimLine(first)]
		: lines.map((line, index) => trimLine([...(index === 0 ? first : rest), ...line]));

/** A cap as a whole number of at least zero, or `undefined` for none. */
export const capOf = (cap: number | undefined): number | undefined =>
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

const callouts = {
	note: "info",
	tip: "success",
	important: "accent",
	warning: "warning",
	caution: "error",
} as const satisfies Record<string, TokenName>;

interface Walk {
	readonly ctx: RenderContext;
	readonly flavour: Flavour;
}

const inline = ({ ctx, flavour }: Walk, inlines: ReadonlyArray<Inline>): ReadonlyArray<Span> =>
	flavour.inline(inlines, ctx);

const overflowLine = (
	walk: Walk,
	overflow: ((hidden: number) => ReadonlyArray<Inline>) | undefined,
	hidden: number,
): Line =>
	toned(
		overflow === undefined
			? [span(`${walk.ctx.glyphs.ellipsis} ${hidden} more`)]
			: oneLine(inline(walk, overflow(hidden))),
		"muted",
	);

/** A table cell is one line: a line break is width 0 to a measure but breaks the row, so a cell keeps its first line. */
const cellOf = (walk: Walk, inlines: ReadonlyArray<Inline> | undefined): Line => {
	if (inlines === undefined) return [];
	const spans = inline(walk, inlines);
	const joined = textOf(spans).replace(/(?:\r\n|\r|\n)+$/, "");
	const at = joined.search(/\r\n|\r|\n/);
	if (at < 0) return sliceSpans(spans, joined.length);
	return [...sliceSpans(spans, at), span(walk.ctx.glyphs.ellipsis, "muted")];
};

const tableLines = (
	walk: Walk,
	block: Extract<Block, { readonly _tag: "Table" }>,
	width: number,
): ReadonlyArray<Line> => {
	const columns = Math.max(block.columns.length, ...block.rows.map((row) => row.length));
	if (columns === 0) return [];
	const cap = capOf(block.cap);
	const shown = cap === undefined ? block.rows : block.rows.slice(0, cap);
	const header = Array.from({ length: columns }, (_, index) =>
		toned(cellOf(walk, block.columns[index]?.header), "emphasis"),
	);
	const body = shown.map((row) => Array.from({ length: columns }, (_, index) => cellOf(walk, row[index])));
	const showHeader = header.some((cell) => cell.length > 0);

	const widths = Array.from({ length: columns }, (_, index) =>
		Math.max(...[...(showHeader ? [header] : []), ...body].map((row) => widthOf(row[index] ?? []))),
	);
	shrink(widths, width);

	const render = (row: ReadonlyArray<Line>): Line =>
		trimLine(
			joinCells(
				row.map((cell, index) => {
					const columnWidth = widths[index] as number;
					const cut = widthOf(cell) > columnWidth ? truncateSpans(cell, columnWidth, walk.ctx.glyphs.ellipsis) : cell;
					return pad(cut, columnWidth, block.columns[index]?.align ?? "left");
				}),
				"  ",
			),
		);
	const rule: Line = joinCells(
		widths.map((w) => [span("-".repeat(w), "muted")]),
		"  ",
	);

	const lines = [...(showHeader ? [render(header), rule] : []), ...body.map(render)];
	const hidden = block.rows.length - shown.length;
	return hidden > 0 ? [...lines, overflowLine(walk, block.overflow, hidden)] : lines;
};

const treeLines = (walk: Walk, block: Extract<Block, { readonly _tag: "Tree" }>): ReadonlyArray<Line> => {
	const glyphs = walk.ctx.glyphs.tree;
	const lines: Array<Line> = [trimLine(oneLine(inline(walk, block.root.label)))];
	const visit = (children: typeof block.root.children, prefix: string): void => {
		children.forEach((child, index) => {
			const last = index === children.length - 1;
			lines.push(
				trimLine([span(prefix + (last ? glyphs.last : glyphs.branch), "muted"), ...oneLine(inline(walk, child.label))]),
			);
			visit(child.children, prefix + (last ? glyphs.blank : glyphs.pipe));
		});
	};
	visit(block.root.children, "");
	return lines;
};

const diffSide = (
	walk: Walk,
	marker: string,
	token: Tone,
	text: string,
	cap: number | undefined,
): ReadonlyArray<Line> => {
	const lines = textLines(text);
	const shown = cap === undefined ? lines : lines.slice(0, cap);
	const hidden = lines.length - shown.length;
	return [
		...shown.map((line) => trimLine([span(`${marker} ${line}`, token)])),
		...(hidden > 0 ? [[span(`  ${walk.ctx.glyphs.ellipsis} ${hidden} more lines`, "muted")]] : []),
	];
};

const countsLines = (walk: Walk, block: Extract<Block, { readonly _tag: "Counts" }>): ReadonlyArray<Line> => {
	const visible = Doc.visibleCounters(block);
	const total = Doc.total(block);
	const label = block.label === undefined ? [] : toned(oneLine(inline(walk, block.label)), "emphasis");
	const qualifier = block.qualifier === undefined ? [] : toned(oneLine(inline(walk, block.qualifier)), "muted");
	const duration = block.durationMs === undefined ? "" : Fmt.duration(block.durationMs);
	// A counter's label is one line, like the block's own label: a line break in it would start a line of its own.
	const nameOf = (counter: (typeof visible)[number]): string => sanitize(counter.label).replace(/\r\n|\r|\n/g, " ");
	// The first counter is the headline: it shows its share of the total.
	const counters = visible.map((counter, index): Line => {
		const name = nameOf(counter);
		return [span(index === 0 ? `${counter.n}/${total} ${name}` : `${counter.n} ${name}`, counter.status.def.token)];
	});

	if (block.layout === "row") {
		return [
			trimLine(joinChunks([label, ...counters, qualifier, duration === "" ? [] : [span(duration, "muted")]], "  ")),
		];
	}
	if (block.layout === "columns") {
		const labelWidth = Math.max(0, ...visible.map((counter) => widthOf([span(nameOf(counter))])));
		const numberWidth = Math.max(0, ...visible.map((counter) => String(counter.n).length));
		return [
			...(label.length === 0 ? [] : [label]),
			...visible.map((counter) =>
				trimLine([
					...pad([span(nameOf(counter), counter.status.def.token)], labelWidth, "left"),
					span("  "),
					...pad([span(String(counter.n), counter.status.def.token)], numberWidth, "right"),
				]),
			),
			...(qualifier.length === 0 ? [] : [qualifier]),
			...(duration === "" ? [] : [[span(duration, "muted")]]),
		];
	}
	const head = label.length === 0 ? [] : [...label, span(":")];
	const tally = joinChunks(counters, ", ");
	return [
		trimLine(
			joinChunks(
				[joinChunks([head, tally], " "), qualifier, duration === "" ? [] : [span(`(${duration})`, "muted")]],
				" ",
			),
		),
	];
};

const blockLines = (walk: Walk, block: Block, width: number): ReadonlyArray<Line> => {
	switch (block._tag) {
		case "Heading":
			return [trimLine(toned(oneLine(inline(walk, block.content)), "emphasis"))];
		case "Paragraph": {
			const spans = inline(walk, block.content);
			if (spans.length === 0) return [[]];
			return wrapSpans(spans, width, { hardBreak: false }).map(trimLine);
		}
		case "List": {
			const cap = capOf(block.cap);
			const shown = cap === undefined ? block.items : block.items.slice(0, cap);
			const lines = shown.flatMap((item) => hang(blockLines(walk, item, width - 2), [span("- ")], [span("  ")]));
			const hidden = block.items.length - shown.length;
			return hidden > 0 ? [...lines, overflowLine(walk, block.overflow, hidden)] : lines;
		}
		case "Table":
			return tableLines(walk, block, width);
		case "Tree":
			return treeLines(walk, block);
		case "Collapsible":
			return [
				trimLine(toned(oneLine(inline(walk, block.title)), "emphasis")),
				...block.body
					.flatMap((child) => blockLines(walk, child, width - 2))
					.map((line) => trimLine([span("  "), ...line])),
			];
		case "Callout": {
			const label = `${block.kind.toUpperCase()}:`;
			const hanging = label.length + 1;
			const body = block.body.flatMap((child) => blockLines(walk, child, width - hanging));
			const head = span(label, callouts[block.kind]);
			return body.length === 0 ? [[head]] : hang(body, [head, span(" ")], [blank(hanging)]);
		}
		case "CodeBlock":
			return textLines(block.text).map((line) => trimLine([span(`    ${line}`)]));
		case "Diff": {
			const cap = capOf(block.cap);
			return [
				...diffSide(walk, "-", "failure", block.expected, cap),
				...diffSide(walk, "+", "success", block.received, cap),
			];
		}
		case "Section": {
			const groups: Array<ReadonlyArray<Line>> = [
				...(block.title === undefined ? [] : [[trimLine(toned(oneLine(inline(walk, block.title)), "emphasis"))]]),
				...block.children.map((child) => blockLines(walk, child, width)),
			];
			return groups.flatMap((group, index) => (index === 0 ? group : [[], ...group]));
		}
		case "Counts":
			return countsLines(walk, block);
	}
};

/**
 * Render a document to lines of text in the given flavour.
 *
 * @internal
 */
export const renderDoc = (doc: Document, ctx: RenderContext, flavour: Flavour): string => {
	const width = Number.isNaN(ctx.width) ? 80 : Math.max(1, ctx.width);
	const walk: Walk = { ctx, flavour };
	return doc
		.flatMap((block) => blockLines(walk, block, width))
		.map((line) => flavour.finish(trimLine(line), ctx))
		.join("\n");
};
