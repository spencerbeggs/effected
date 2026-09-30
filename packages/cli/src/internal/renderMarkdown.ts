import type { Block, Document, Inline, LinkTarget } from "../Doc.js";
import { Doc } from "../Doc.js";
import { Fmt } from "../Fmt.js";
import type { RenderContext } from "../Render.js";
import type { Span } from "./layout.js";
import { flatten, sanitize } from "./layout.js";
import { capOf, targetText, textLines } from "./renderDoc.js";

type Lines = ReadonlyArray<string>;

/** How a line break inside text is written: a hard break in flowing text, `<br>` in a table cell, a space in a line. */
type Mode = "flow" | "cell" | "line";

/** Marks a line break inside flowing text until the paragraph is split into lines. Sanitized text never holds NUL. */
const BREAK = "\u0000";

const SAFE_SCHEMES = new Set(["http", "https", "mailto", "file", "vscode", "vscode-insiders"]);

/**
 * Escape what markdown would read as syntax: backslash, backtick, `*`, `_`, brackets, angle brackets, `&`, `~` and
 * `|` (so text can never form a table), and the start of an autolink literal (any scheme before `://`, or `www.`), which a GFM
 * reader would otherwise turn into a link. An email address is left alone: the `mailto:` link a reader makes of it
 * is harmless, and escaping its `@` does not stop every reader.
 */
const escapeText = (text: string): string =>
	text
		.replace(/[\\`*_[\]<>&~|]/g, "\\$&")
		.replace(/(?<=[a-z0-9+.-]):(?=\/\/)/gi, "\\:")
		.replace(/\b(www)\./gi, "$1\\.");

/**
 * Escape a block marker at the start of a line: a heading or an ordered item, and always a leading `-`, `+` or `=`,
 * which would make a bullet, a setext underline or (with spaces between dashes) a thematic break.
 */
const escapeLineStart = (line: string): string => {
	if (/^[-+=]/.test(line)) return `\\${line}`;
	if (/^#{1,6}(?:\s|$)/.test(line)) return `\\${line}`;
	const ordered = /^(\d{1,9})([.)])(?:\s|$)/.exec(line);
	if (ordered !== null) return `${ordered[1]}\\${line.slice((ordered[1] as string).length)}`;
	return line;
};

const htmlEscape = (text: string): string =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Inline code: a backtick fence longer than any run inside, padded where a reader would strip or merge a space. */
const codeSpan = (text: string, mode: Mode): string => {
	const flat = text.replace(/\r\n|\r|\n/g, " ");
	const longest = Math.max(0, ...[...flat.matchAll(/`+/g)].map((run) => run[0].length));
	const fence = "`".repeat(longest + 1);
	const padded = /^`|`$/.test(flat) || (/^ .* $/.test(flat) && flat.trim() !== "") || flat === "";
	const body = mode === "cell" ? flat.replace(/\|/g, "\\|") : flat;
	const pad = padded ? " " : "";
	return `${fence}${pad}${body === "" ? " " : body}${pad}${fence}`;
};

const textPiece = (text: string, mode: Mode): string =>
	text
		.split(/\r\n|\r|\n/)
		.map(escapeText)
		.join(mode === "cell" ? "<br>" : mode === "line" ? " " : BREAK);

/**
 * A link's URL when it has a form a reader can follow: an allowed scheme, a relative URL, or an absolute file path.
 *
 * The scheme is read from a normalised copy, with whitespace and control characters removed and the case folded,
 * because a browser ignores them inside a scheme (`java<tab>script:`). An entity cannot hide one either: the
 * destination escapes `&`, so what a reader decodes is the text that was checked here.
 */
const linkUrl = (target: LinkTarget): string | undefined => {
	if ("url" in target) {
		const url = target.url.trim();
		const scheme = /^([a-z][a-z0-9+.-]*):/.exec(sanitize(url).replace(/\s/g, "").toLowerCase());
		return scheme === null || SAFE_SCHEMES.has(scheme[1] as string) ? url : undefined;
	}
	if (!target.file.startsWith("/")) return undefined;
	return `file://${encodeURI(target.file).replace(/#/g, "%23").replace(/\?/g, "%3F")}`;
};

/** A link destination. `&` is escaped so a reader does not decode an entity into something other than what was written. */
const destination = (raw: string): string => {
	const url = raw.replace(/&/g, "&amp;");
	return /^[^\s()<>\\]*$/.test(url)
		? url
		: `<${url
				.replace(/[\r\n]/g, "")
				.replace(/\\/g, "\\\\")
				.replace(/</g, "%3C")
				.replace(/>/g, "%3E")}>`;
};

/** Inline nodes as markdown: text escaped, code fenced, a link as `[label](url)` or, with no URL form, label and path. */
const inlineMd = (inlines: ReadonlyArray<Inline>, ctx: RenderContext, mode: Mode): string => {
	const flat = flatten(inlines, ctx);
	let out = "";
	let i = 0;
	while (i < flat.length) {
		const link = (flat[i] as Span).link;
		let label = "";
		let raw = "";
		do {
			const span = flat[i] as Span;
			label += span.code === true ? codeSpan(span.text, mode) : textPiece(span.text, mode);
			raw += span.text;
			i++;
		} while (link !== undefined && i < flat.length && (flat[i] as Span).link === link);
		if (link === undefined) {
			out += label;
			continue;
		}
		const url = linkUrl(link);
		const target = targetText(link, ctx);
		if (url !== undefined) out += `[${label}](${destination(url)})`;
		else out += raw === target ? label : `${label} (${codeSpan(target, mode)})`;
	}
	return out;
};

/** Flowing text as lines: blank lines dropped, each line cleared of indentation and of block markers, hard breaks between. */
const flowLines = (markdown: string): Lines => {
	const lines = markdown
		.split(BREAK)
		.map((line) => line.trimStart())
		.filter((line) => line.trim() !== "")
		.map(escapeLineStart);
	return lines.map((line, index) => (index < lines.length - 1 ? `${line}\\` : line.trimEnd()));
};

const joinBlocks = (blocks: ReadonlyArray<Lines>): Lines =>
	blocks.filter((block) => block.length > 0).flatMap((block, index) => (index === 0 ? block : ["", ...block]));

const hang = (lines: Lines, first: string, rest: string): Lines =>
	lines.length === 0 ? [first.trimEnd()] : lines.map((line, index) => `${index === 0 ? first : rest}${line}`.trimEnd());

const overflowMd = (
	overflow: ((hidden: number) => ReadonlyArray<Inline>) | undefined,
	hidden: number,
	ctx: RenderContext,
): Lines =>
	flowLines(
		overflow === undefined
			? escapeText(`${ctx.glyphs.ellipsis} ${hidden} more`)
			: inlineMd(overflow(hidden), ctx, "flow"),
	);

const fenced = (lines: Lines, info: string): Lines => {
	const longest = Math.max(0, ...lines.flatMap((line) => [...line.matchAll(/`+/g)].map((run) => run[0].length)));
	const fence = "`".repeat(Math.max(3, longest + 1));
	return [`${fence}${info}`, ...lines, fence];
};

const align = { left: ":--", right: "--:", center: ":-:" } as const;

const tableMd = (
	header: ReadonlyArray<string>,
	aligns: ReadonlyArray<"left" | "right" | "center" | undefined>,
	rows: ReadonlyArray<ReadonlyArray<string>>,
): Lines => {
	const row = (cells: ReadonlyArray<string>): string => `| ${cells.join(" | ")} |`.replace(/ {2}\|/g, " |");
	return [row(header), row(aligns.map((a) => (a === undefined ? "---" : align[a]))), ...rows.map(row)];
};

interface Walk {
	readonly ctx: RenderContext;
}

const countsMd = (walk: Walk, block: Extract<Block, { readonly _tag: "Counts" }>): ReadonlyArray<Lines> => {
	const { ctx } = walk;
	const visible = Doc.visibleCounters(block);
	const total = Doc.total(block);
	const label = block.label === undefined ? "" : inlineMd(block.label, ctx, "line").trim();
	const qualifier = block.qualifier === undefined ? "" : inlineMd(block.qualifier, ctx, "line").trim();
	const duration = block.durationMs === undefined ? "" : Fmt.duration(block.durationMs);
	const name = (counter: (typeof visible)[number]): string => escapeText(sanitize(counter.label));

	if (block.layout === "row") {
		const header = [
			...(label === "" ? [] : [""]),
			...visible.map(name),
			...(qualifier === "" ? [] : [""]),
			...(duration === "" ? [] : [""]),
		];
		const cells = [
			...(label === "" ? [] : [label]),
			...visible.map((counter, index) => (index === 0 ? `${counter.n}/${total}` : String(counter.n))),
			...(qualifier === "" ? [] : [qualifier]),
			...(duration === "" ? [] : [duration]),
		];
		return header.length === 0
			? []
			: [
					tableMd(
						header,
						header.map(() => undefined),
						[cells],
					),
				];
	}
	if (block.layout === "columns") {
		return [
			...(label === "" ? [] : [flowLines(label)]),
			...(visible.length === 0
				? []
				: [visible.flatMap((counter) => hang([`${name(counter)}: ${counter.n}`], "- ", "  "))]),
			...(qualifier === "" ? [] : [flowLines(qualifier)]),
			...(duration === "" ? [] : [[duration]]),
		];
	}
	const tally = visible
		.map((counter, index) => (index === 0 ? `${counter.n}/${total} ${name(counter)}` : `${counter.n} ${name(counter)}`))
		.join(", ");
	const head = [label === "" ? "" : `${label}:`, tally].filter((part) => part !== "").join(" ");
	const line = [head, qualifier, duration === "" ? "" : `(${duration})`].filter((part) => part !== "").join(" ");
	return line === "" ? [] : [flowLines(line)];
};

const blockMd = (walk: Walk, block: Block, depth: number): Lines => {
	const { ctx } = walk;
	switch (block._tag) {
		case "Heading": {
			const content = inlineMd(block.content, ctx, "line")
				.trim()
				.replace(/#+$/, (hashes) => hashes.replace(/#/g, "\\#"));
			return [`${"#".repeat(block.level)} ${content}`.trimEnd()];
		}
		case "Paragraph":
			return flowLines(inlineMd(block.content, ctx, "flow"));
		case "List": {
			const cap = capOf(block.cap);
			const shown = cap === undefined ? block.items : block.items.slice(0, cap);
			const items = shown.flatMap((item) => hang(blockMd(walk, item, depth), "- ", "  "));
			const hidden = block.items.length - shown.length;
			return joinBlocks([items, hidden > 0 ? overflowMd(block.overflow, hidden, ctx) : []]);
		}
		case "Table": {
			const columns = Math.max(block.columns.length, ...block.rows.map((row) => row.length));
			if (columns === 0) return [];
			const cap = capOf(block.cap);
			const shown = cap === undefined ? block.rows : block.rows.slice(0, cap);
			// A line break at the edge of a cell is not content: the cell is its trimmed text.
			const cell = (inlines: ReadonlyArray<Inline> | undefined): string =>
				inlines === undefined ? "" : inlineMd(inlines, ctx, "cell").replace(/^(?:\s|<br>)+|(?:\s|<br>)+$/g, "");
			const header = Array.from({ length: columns }, (_, index) => cell(block.columns[index]?.header));
			const aligns = Array.from({ length: columns }, (_, index) => block.columns[index]?.align);
			const rows = shown.map((row) => Array.from({ length: columns }, (_, index) => cell(row[index])));
			const hidden = block.rows.length - shown.length;
			return joinBlocks([tableMd(header, aligns, rows), hidden > 0 ? overflowMd(block.overflow, hidden, ctx) : []]);
		}
		case "Tree": {
			const lines: Array<string> = [];
			const visit = (children: typeof block.root.children, indent: number): void => {
				for (const child of children) {
					const label = flowLines(inlineMd(child.label, ctx, "line"))[0] ?? "";
					lines.push(`${" ".repeat(indent)}- ${label}`.trimEnd());
					visit(child.children, indent + 2);
				}
			};
			visit(block.root.children, 0);
			return joinBlocks([flowLines(inlineMd(block.root.label, ctx, "line")), lines]);
		}
		case "Collapsible": {
			const title = htmlEscape(
				flatten(block.title, ctx)
					.map((span) => span.text)
					.join("")
					.replace(/\r\n|\r|\n/g, " "),
			);
			const open = block.open === true ? " open" : "";
			// The HTML block ends at a blank line, so the body needs one before it and the close one after it.
			const body = joinBlocks(block.body.map((child) => blockMd(walk, child, depth)));
			return [
				`<details${open}><summary>${title}</summary>`,
				"",
				...(body.length === 0 ? [] : [...body, ""]),
				"</details>",
			];
		}
		case "Callout": {
			const body = joinBlocks(block.body.map((child) => blockMd(walk, child, depth)));
			const first = block.body[0];
			const separate = first !== undefined && first._tag !== "Paragraph";
			const quoted = [`[!${block.kind.toUpperCase()}]`, ...(separate ? [""] : []), ...body];
			return quoted.map((line) => (line === "" ? ">" : `> ${line}`));
		}
		case "CodeBlock": {
			const info =
				sanitize(block.lang ?? "")
					.trim()
					.split(/\s+/)[0]
					?.replace(/`/g, "") ?? "";
			return fenced(block.text === "" ? [] : textLines(block.text), info);
		}
		case "Diff": {
			const cap = capOf(block.cap);
			const side = (marker: string, text: string): Lines => {
				const lines = textLines(text);
				const shown = cap === undefined ? lines : lines.slice(0, cap);
				const hidden = lines.length - shown.length;
				return [
					...shown.map((line) => `${marker} ${line}`.trimEnd()),
					...(hidden > 0 ? [`  ${ctx.glyphs.ellipsis} ${hidden} more lines`] : []),
				];
			};
			return fenced([...side("-", block.expected), ...side("+", block.received)], "diff");
		}
		case "Section": {
			const level = Math.min(2 + depth, 6);
			const title =
				block.title === undefined
					? []
					: [
							`${"#".repeat(level)} ${inlineMd(block.title, ctx, "line")
								.trim()
								.replace(/#+$/, (h) => h.replace(/#/g, "\\#"))}`.trimEnd(),
						];
			return joinBlocks([title, ...block.children.map((child) => blockMd(walk, child, depth + 1))]);
		}
		case "Counts":
			return joinBlocks(countsMd(walk, block));
	}
};

/**
 * Render a document as GitHub-flavoured markdown.
 *
 * @internal
 */
export const renderMarkdown = (doc: Document, ctx: RenderContext): string =>
	joinBlocks(doc.map((block) => blockMd({ ctx }, block, 0))).join("\n");
