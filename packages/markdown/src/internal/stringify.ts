// Canonical markdown serialization: an mdast-shaped tree in, markdown source
// out. Original code (nothing here is ported verbatim); commonmark.js's
// excluded render/commonmark.js and mdast-util-to-markdown informed the
// escaping approach as prior art, but the operational authority is the
// corpus-wide re-parse property in
// `__test__/e2e/stringify-roundtrip.e2e.test.ts`: emitted text must re-parse
// to a render-equivalent document.
//
// THE CANONICAL DEFAULTS TABLE — fidelity fields win when present; when
// absent these spellings apply:
//
//   heading         ATX (`#` × depth); setext only via fidelity, depth <= 2
//   emphasis        `*`     strong  `**`    (flipped to `_` at run junctions)
//   bullet list     `-`     ordered delimiter `.`   start `1`
//   list spread     absent reads as tight (the P1 writer ruling)
//   code            absent `fenceChar` reads as INDENTED (the node contract:
//                   absence is how fenced and indented are told apart), with
//                   a representability escape to a backtick fence when the
//                   value has a lang/meta, is empty, or has a blank first or
//                   last line
//   fence length    max(3, fidelity, longest interior run + 1)
//   thematic break  `***` (never `---`, which could read as setext under a
//                   lazy paragraph or as frontmatter at offset 0)
//   hard break      backslash
//   table align     `---` / `:--` / `--:` / `:-:`, `---` when unknown
//   frontmatter     `---` yaml, `+++` toml, `---json` json; closed by `---`
//                   (`+++` for toml)
//
// Escaping strategy: a conservative always-escape set for inline text
// (backslash, backtick, `*`, `_`, `[`, `]`, `<`, `>`, `&`, `~`, `|`) plus
// line-start escapes (`#`, `>`, `+`, `-`, `=`, and ordered-list-marker digit
// runs) applied at the start of the block and after every emitted newline.
// Autolink defense under gfm: a `.` right after a boundary-preceded `www` and
// a `:` right after a scheme word (http/https/ftp/mailto/xmpp) are escaped so
// raw-source literal scanners cannot fire; escapes decode away, so the text
// is unchanged. Email-shaped plain text is a RECORDED LIMITATION: the email
// matcher is a postprocess over decoded text (the P2 hook-placement ruling),
// so no escape spelling survives to defeat it.
//
// Unrepresentable shapes (documented, synthesized-tree-only — the parser
// never produces them): a tight list whose item holds multiple blocks, two
// adjacent `Delete` siblings, a `Break` inside a heading or table cell
// (serialized as a space), text lines starting with 4+ spaces, and a
// `Frontmatter` node anywhere but the head of `Root`.
//
// Depth guard: serialization recurses over the tree, so the shared
// `MAX_NESTING_DEPTH` cap applies (a decoded hostile tree must trip a typed
// guard, never a RangeError). Blocks and inlines share one counter.

import type {
	Code,
	Definition,
	FlowContent,
	FootnoteDefinition,
	Frontmatter,
	Heading,
	List,
	ListItem,
	Paragraph,
	PhrasingContent,
	Root,
	Table,
} from "../MarkdownNode.js";
import { GuardExceeded } from "./carriers.js";
import { MAX_NESTING_DEPTH } from "./limits.js";

/** How inline content is being assembled. */
interface InlineContext {
	/** No newlines representable (heading, table cell): breaks become spaces. */
	readonly singleLine: boolean;
	/** Inside a table cell: `|` must not survive unescaped. */
	readonly inTable: boolean;
	/** Inside a heading: a `#` could read as the closing sequence. */
	readonly inHeading: boolean;
}

const FLOW_CONTEXT: InlineContext = { singleLine: false, inTable: false, inHeading: false };
const HEADING_CONTEXT: InlineContext = { singleLine: true, inTable: false, inHeading: true };
const CELL_CONTEXT: InlineContext = { singleLine: true, inTable: true, inHeading: false };

/** Characters escaped wherever they appear in inline text. */
const ALWAYS_ESCAPE = new Set(["\\", "`", "*", "_", "[", "]", "<", ">", "&", "~", "|"]);

/** Line-start characters that could open a block construct. */
const LINE_START_ESCAPE = new Set(["#", ">", "+", "-", "=", "~", "`"]);

const SCHEME_WORDS = new Set(["http", "https", "ftp", "mailto", "xmpp"]);

const ORDERED_MARKER = /^\d{1,9}[.)]/;

/** The serializer's one piece of mutable state. */
interface StringifyState {
	depth: number;
}

const guard = (state: StringifyState, node: { position: { start: { offset: number } } }): void => {
	state.depth += 1;
	if (state.depth > MAX_NESTING_DEPTH) {
		throw new GuardExceeded("NestingDepthExceeded", MAX_NESTING_DEPTH, state.depth, node.position.start.offset);
	}
};

const unguard = (state: StringifyState): void => {
	state.depth -= 1;
};

// --- inline text escaping ---------------------------------------------------

/** Whether `value[index]` ends a `www` run preceded by a word boundary. */
const isWwwDot = (value: string, index: number): boolean => {
	if (value.slice(Math.max(0, index - 3), index).toLowerCase() !== "www") return false;
	if (index - 3 <= 0) return true;
	const before = value[index - 4];
	return before === undefined || !/[\p{L}\p{N}]/u.test(before);
};

/** Whether the run of letters ending at `value[index]` is a scheme word. */
const isSchemeColon = (value: string, index: number): boolean => {
	let start = index;
	while (start > 0 && /[a-zA-Z]/.test(value[start - 1] as string)) start -= 1;
	return SCHEME_WORDS.has(value.slice(start, index).toLowerCase());
};

/**
 * Escape one text value into `out`, tracking line starts. Returns whether the
 * emission ended at a line start.
 */
const escapeText = (
	value: string,
	context: InlineContext,
	atLineStart: boolean,
): { text: string; atLineStart: boolean } => {
	let out = "";
	let lineStart = atLineStart;
	for (let index = 0; index < value.length; index += 1) {
		const char = value[index] as string;
		if (char === "\n") {
			// A lone interior newline is a soft break and survives as one. A
			// newline adjacent to another, or at the value's boundary, has no
			// raw spelling (it would open a blank line or vanish into block
			// structure) — the numeric reference decodes back to the same
			// text. Single-line contexts have no newline spelling at all.
			const adjacent = value[index - 1] === "\n" || value[index + 1] === "\n";
			const atBoundary = index === 0 || index === value.length - 1;
			if (context.singleLine) {
				out += " ";
				lineStart = false;
			} else if (adjacent || atBoundary) {
				out += "&#10;";
				lineStart = false;
			} else {
				out += "\n";
				lineStart = true;
			}
			continue;
		}
		if (lineStart) {
			// Leading whitespace at a line start would read as indentation
			// (four columns make an indented code block); the numeric
			// reference is inert.
			if (char === "\t") {
				out += "&#9;";
				lineStart = false;
				continue;
			}
			if (char === " ") {
				out += "&#32;";
				lineStart = false;
				continue;
			}
			const lineEnd = value.indexOf("\n", index);
			const restOfLine = value.slice(index, lineEnd === -1 ? undefined : lineEnd);
			const ordered = ORDERED_MARKER.exec(restOfLine);
			if (ordered !== null) {
				const digits = ordered[0].slice(0, -1);
				const delimiter = ordered[0].slice(-1);
				out += `${digits}\\${delimiter}`;
				index += ordered[0].length - 1;
				lineStart = false;
				continue;
			}
			if (LINE_START_ESCAPE.has(char)) {
				out += `\\${char}`;
				lineStart = false;
				continue;
			}
		}
		lineStart = false;
		if (ALWAYS_ESCAPE.has(char)) {
			out += `\\${char}`;
			continue;
		}
		if (context.inHeading && char === "#") {
			out += "\\#";
			continue;
		}
		if (char === "." && isWwwDot(value, index)) {
			out += "\\.";
			continue;
		}
		if (char === ":" && isSchemeColon(value, index)) {
			out += "\\:";
			continue;
		}
		out += char;
	}
	return { text: out, atLineStart: lineStart };
};

// --- inline serialization ---------------------------------------------------

/** Pick the effective emphasis marker, flipping away from a forbidden char. */
const emphasisMarker = (fidelity: "*" | "_" | undefined, forbidden: string | undefined): "*" | "_" => {
	const chosen = fidelity ?? "*";
	return chosen === forbidden ? (chosen === "*" ? "_" : "*") : chosen;
};

/**
 * Emit a reference label for its bracket. Labels (and identifiers) in this
 * tree are SOURCE-FORM — the parser keeps character escapes unparsed, per
 * the mdast identifier contract — so the label already carries any escapes
 * its content needs and re-emitting it verbatim reproduces the original
 * bracket exactly. The only intervention is protecting a synthesized label's
 * UNESCAPED square brackets, which would otherwise break the bracket
 * structure. Definitions and references run through this same function, so
 * identifiers agree on both ends and resolution holds.
 */
const escapeLabel = (label: string): string => label.replace(/(?<!\\)([[\]])/g, "\\$1");

/** Whether a destination character forces the pointy-bracket form. */
const forcesPointy = (char: string): boolean => {
	const codePoint = char.codePointAt(0) as number;
	// Controls and space (a bare destination allows neither), plus the
	// bracket/backslash set whose bare spelling is ambiguous.
	return codePoint <= 0x20 || char === "<" || char === ">" || char === "[" || char === "]" || char === "\\";
};

/** Wrap a link/image destination, pointy-bracketed when it needs it. */
const destination = (url: string): string => {
	if (url === "" || Array.from(url).some(forcesPointy) || !balancedParens(url)) {
		return `<${url.replace(/[<>\\]/g, (char) => `\\${char}`)}>`;
	}
	return url;
};

const balancedParens = (url: string): boolean => {
	let open = 0;
	for (const char of url) {
		if (char === "(") open += 1;
		if (char === ")") {
			open -= 1;
			if (open < 0) return false;
		}
	}
	return open === 0;
};

const titleSuffix = (title: string | undefined): string =>
	title === undefined ? "" : ` "${title.replace(/[\\"]/g, (char) => `\\${char}`)}"`;

/** Serialize an inline-code span with a fence run longer than any interior run. */
const inlineCode = (value: string): string => {
	let longest = 0;
	for (const run of value.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
	const fence = "`".repeat(Math.max(1, longest + 1));
	// Padding restores what the spec's one-space stripping will remove: a
	// value touching a backtick at either end, or one that starts AND could
	// lose its real leading/trailing space. An all-space value is never
	// stripped, so it must NOT be padded.
	const allSpace = value !== "" && value.trim() === "";
	const needsPad =
		!allSpace && (value.startsWith("`") || value.endsWith("`") || value.startsWith(" ") || value.endsWith(" "));
	const padded = needsPad ? ` ${value} ` : value;
	return `${fence}${padded}${fence}`;
};

/**
 * The emphasis-family parent whose markers sit at this run's edges. An
 * edge child's marker choice follows the nesting algebra, fidelity second:
 *
 *   em{strong}     uniform marker  — `***x***` re-parses em{strong}
 *   em{em}         flip            — `**x**` would read as strong
 *   strong{em}     flip            — `***x***` would swap the nesting order
 *   strong{strong} uniform         — a fused 4+ run splits back into strongs
 *
 * Mid-run children only avoid an actually adjacent marker char. On top of
 * either rule, an `_` that would sit against an alphanumeric cannot flank
 * and is corrected to `*` (the intraword-underscore restriction).
 */
interface JunctionGuard {
	readonly parent: "emphasis" | "strong";
	readonly marker: "*" | "_";
}

const flipMarker = (marker: "*" | "_"): "*" | "_" => (marker === "*" ? "_" : "*");

/** The edge-marker choice for a nested emphasis-family child. */
const nestedMarker = (
	child: "emphasis" | "strong",
	fidelity: "*" | "_" | undefined,
	guard: JunctionGuard,
): "*" | "_" => {
	if (guard.parent === "emphasis") {
		return child === "strong" ? guard.marker : flipMarker(guard.marker);
	}
	return child === "emphasis" ? flipMarker(guard.marker) : (fidelity ?? guard.marker);
};

/**
 * Serialize a run of phrasing children. `junctionGuard` carries the marker
 * the PARENT emits at this run's edges, so a first or last emphasis-family
 * child flips away from it; mid-run children only flip away from an actual
 * adjacent marker char.
 */
const serializeInlines = (
	children: ReadonlyArray<PhrasingContent>,
	context: InlineContext,
	state: StringifyState,
	startsLine: boolean,
	junctionGuard?: JunctionGuard,
): string => {
	let out = "";
	let atLineStart = startsLine;
	let index = 0;
	for (const child of children) {
		guard(state, child);
		const lastChar = out === "" ? undefined : out[out.length - 1];
		const atEdge = out === "" || index === children.length - 1;
		const adjacentMarker = lastChar === "*" || lastChar === "_" ? lastChar : undefined;
		// A literal `!` right before a link's bracket would turn it into an
		// image; escape it at the junction.
		const bangGuard = (): void => {
			if (out.endsWith("!") && !out.endsWith("\\!")) {
				out = `${out.slice(0, -1)}\\!`;
			}
		};
		switch (child.type) {
			case "text": {
				const escaped = escapeText(child.value, context, atLineStart);
				out += escaped.text;
				atLineStart = escaped.atLineStart;
				break;
			}
			case "inlineCode":
				out += inlineCode(child.value);
				atLineStart = false;
				break;
			case "html":
				out += child.value;
				atLineStart = false;
				break;
			case "break":
				if (context.singleLine) {
					out += " ";
					atLineStart = false;
				} else {
					out += child.breakStyle === "spaces" ? "  \n" : "\\\n";
					atLineStart = true;
				}
				break;
			case "emphasis":
			case "strong": {
				const kind = child.type;
				let marker: "*" | "_";
				if (atEdge && junctionGuard !== undefined) {
					marker = nestedMarker(kind, child.markerChar, junctionGuard);
				} else {
					marker = emphasisMarker(child.markerChar, adjacentMarker);
				}
				// The intraword-underscore restriction: `_` against an
				// alphanumeric cannot open.
				if (marker === "_" && lastChar !== undefined && /[\p{L}\p{N}]/u.test(lastChar)) {
					marker = "*";
				}
				const run = kind === "strong" ? marker.repeat(2) : marker;
				const inner = serializeInlines(child.children, context, state, false, { parent: kind, marker });
				out += `${run}${inner}${run}`;
				atLineStart = false;
				break;
			}
			case "delete":
				out += `~~${serializeInlines(child.children, context, state, false)}~~`;
				atLineStart = false;
				break;
			case "link":
				bangGuard();
				out += `[${serializeInlines(child.children, context, state, false)}](${destination(child.url)}${titleSuffix(child.title)})`;
				atLineStart = false;
				break;
			case "image": {
				const alt = (child.alt ?? "").replace(/[\\[\]]/g, (char) => `\\${char}`);
				out += `![${alt}](${destination(child.url)}${titleSuffix(child.title)})`;
				atLineStart = false;
				break;
			}
			case "linkReference": {
				// The bracket of a shortcut or collapsed reference IS its
				// label; only a full reference carries free content. Labels go
				// through escapeLabel so definitions agree — see escapeLabel.
				bangGuard();
				const label = escapeLabel(child.label ?? child.identifier);
				if (child.referenceType === "full") {
					const content = serializeInlines(child.children, context, state, false);
					out += `[${content}][${label}]`;
				} else if (child.referenceType === "collapsed") {
					out += `[${label}][]`;
				} else {
					out += `[${label}]`;
				}
				atLineStart = false;
				break;
			}
			case "imageReference": {
				const label = escapeLabel(child.label ?? child.identifier);
				if (child.referenceType === "full") {
					const alt = (child.alt ?? "").replace(/[\\[\]]/g, (char) => `\\${char}`);
					out += `![${alt}][${label}]`;
				} else if (child.referenceType === "collapsed") {
					out += `![${label}][]`;
				} else {
					out += `![${label}]`;
				}
				atLineStart = false;
				break;
			}
			case "footnoteReference":
				out += `[^${escapeLabel(child.label ?? child.identifier)}]`;
				atLineStart = false;
				break;
		}
		index += 1;
		unguard(state);
	}
	return out;
};

// --- block serialization ----------------------------------------------------

/** Prefix every line of `content`; blank lines take the trimmed prefix. */
const prefixLines = (content: string, prefix: string, blankPrefix: string): string =>
	content
		.split("\n")
		.map((line) => (line === "" ? blankPrefix : `${prefix}${line}`))
		.join("\n");

/** First line gets `marker`, continuation lines get spaces of its width. */
const hangingIndent = (content: string, marker: string): string => {
	const lines = content.split("\n");
	const indent = " ".repeat(marker.length);
	return lines
		.map((line, index) => {
			if (index === 0) return `${marker}${line}`;
			return line === "" ? "" : `${indent}${line}`;
		})
		.join("\n");
};

const serializeCode = (node: Code, forceFence: boolean): string => {
	// The parser's code values end with the block's final line terminator;
	// it belongs to block structure, not content, on the way back out.
	const value = node.value.endsWith("\n") ? node.value.slice(0, -1) : node.value;
	const lines = value === "" ? [] : value.split("\n");
	const indentedRepresentable =
		!forceFence &&
		node.fenceChar === undefined &&
		node.lang === undefined &&
		node.meta === undefined &&
		lines.length > 0 &&
		lines[0] !== "" &&
		lines[lines.length - 1] !== "";
	if (indentedRepresentable) {
		return lines.map((line) => (line === "" ? "" : `    ${line}`)).join("\n");
	}
	const char = node.fenceChar ?? "`";
	let longest = 0;
	const runs = value.match(char === "`" ? /`+/g : /~+/g) ?? [];
	for (const run of runs) longest = Math.max(longest, run.length);
	const length = Math.max(3, node.fenceLength ?? 0, longest + 1);
	const fence = char.repeat(length);
	const info = `${node.lang ?? ""}${node.meta !== undefined ? ` ${node.meta}` : ""}`;
	const body = value === "" ? "" : `${value}\n`;
	return `${fence}${info}\n${body}${fence}`;
};

const setextUnderline = (heading: Heading, content: string): string => {
	const lastLine = content.split("\n").at(-1) ?? "";
	const char = heading.depth === 1 ? "=" : "-";
	return char.repeat(Math.max(1, lastLine.length));
};

const serializeHeading = (heading: Heading, state: StringifyState): string => {
	const content = serializeInlines(heading.children, HEADING_CONTEXT, state, false);
	if (heading.headingStyle === "setext" && heading.depth <= 2 && content !== "") {
		return `${content}\n${setextUnderline(heading, content)}`;
	}
	const hashes = "#".repeat(heading.depth);
	return content === "" ? hashes : `${hashes} ${content}`;
};

const serializeDefinition = (node: Definition): string =>
	`[${escapeLabel(node.label ?? node.identifier)}]: ${destination(node.url)}${titleSuffix(node.title)}`;

const serializeFootnoteDefinition = (node: FootnoteDefinition, state: StringifyState): string => {
	const content = serializeBlocks(node.children, state);
	const lines = content.split("\n");
	const marker = `[^${escapeLabel(node.label ?? node.identifier)}]:`;
	// Indented code cannot share the marker line — its leading spaces would
	// be stripped as marker padding and the line would re-parse as a
	// paragraph. The bare-marker form starts the content on its own line.
	const bareMarker = node.children[0]?.type === "code";
	if (bareMarker) {
		return [marker, ...lines.map((line) => (line === "" ? "" : `    ${line}`))].join("\n");
	}
	return lines
		.map((line, index) => {
			if (index === 0) return `${marker} ${line}`;
			return line === "" ? "" : `    ${line}`;
		})
		.join("\n");
};

const alignCell = (align: "left" | "right" | "center" | null | undefined): string => {
	switch (align) {
		case "left":
			return ":--";
		case "right":
			return "--:";
		case "center":
			return ":-:";
		default:
			return "---";
	}
};

const serializeTable = (table: Table, state: StringifyState): string => {
	const columnCount = Math.max(1, ...table.children.map((row) => row.children.length));
	const rows = table.children.map((row) => {
		guard(state, row);
		const cells = row.children.map((cell) => {
			guard(state, cell);
			// Text-level pipes are escaped by the cell context; anything a
			// nested emission smuggled through raw (a code span, raw HTML, a
			// destination) gets caught here — the cell splitter unescapes
			// `\|` everywhere in a cell, code spans included, so this is
			// lossless.
			const content = serializeInlines(cell.children, CELL_CONTEXT, state, false).replace(/(?<!\\)\|/g, "\\|");
			unguard(state);
			return content;
		});
		unguard(state);
		while (cells.length < columnCount) cells.push("");
		return `| ${cells.join(" | ")} |`;
	});
	const alignRow = `| ${Array.from({ length: columnCount }, (_, column) => alignCell(table.align?.[column])).join(" | ")} |`;
	const [header, ...body] = rows;
	return [header ?? `| ${Array.from({ length: columnCount }, () => "").join(" | ")} |`, alignRow, ...body].join("\n");
};

/** The marker actually used by a list, for adjacency comparison. */
const effectiveListMarker = (list: List, flipped: boolean): string => {
	if (list.ordered === true) {
		const delimiter = list.delimiter ?? ".";
		return flipped ? (delimiter === "." ? ")" : ".") : delimiter;
	}
	const bullet = list.bulletChar ?? "-";
	return flipped ? (bullet === "-" ? "*" : "-") : bullet;
};

const serializeListItem = (item: ListItem, marker: string, state: StringifyState, tight: boolean): string => {
	guard(state, item);
	// In a tight list a blank line anywhere inside an item would loosen the
	// whole list on re-parse, so same-item block pairs join with a bare
	// newline wherever the interruption rules allow it; pairs that genuinely
	// need the blank line are the documented tight-multi-block edge.
	const inner = serializeBlocks(item.children, state, tight);
	unguard(state);
	const checkbox = item.checked === undefined ? "" : item.checked ? "[x] " : "[ ] ";
	const content = `${checkbox}${inner}`;
	if (content === "") return marker.trimEnd();
	return hangingIndent(content, marker);
};

const serializeList = (list: List, state: StringifyState, flipped: boolean): string => {
	const tight = !(list.spread ?? false);
	const items = list.children.map((item, index) => {
		const marker =
			list.ordered === true
				? `${(list.start ?? 1) + index}${effectiveListMarker(list, flipped)} `
				: `${effectiveListMarker(list, flipped)} `;
		return serializeListItem(item, marker, state, tight);
	});
	return items.join(tight ? "\n" : "\n\n");
};

type Block = FlowContent | Frontmatter | Paragraph;

/** Whether `next` interrupts a paragraph without a blank line before it. */
const interruptsParagraph = (next: Block): boolean => {
	switch (next.type) {
		case "list":
			// Only a list starting at 1 (or a bullet list) interrupts.
			return next.ordered !== true || (next.start ?? 1) === 1;
		case "blockquote":
		case "thematicBreak":
			return true;
		case "heading":
			// A setext underline under a paragraph would ATTACH to it.
			return next.headingStyle !== "setext";
		case "code":
			// Only a fence interrupts; an indent reads as continuation.
			return next.fenceChar !== undefined || next.lang !== undefined;
		default:
			return false;
	}
};

/**
 * Whether `prev` and `next` may sit on adjacent lines with no blank line
 * between them without either absorbing the other on re-parse. Drives tight
 * list items; anything not provably safe takes the blank line.
 */
const canJoinWithoutBlank = (prev: Block, next: Block): boolean => {
	switch (prev.type) {
		case "heading":
			// ATX self-terminates; a setext underline consumed its paragraph.
			return true;
		case "thematicBreak":
			return true;
		case "code":
			// A closed fence self-terminates. Indented code ends at the first
			// insufficiently indented line — but another indented block would
			// merge into it.
			if (prev.fenceChar !== undefined || prev.lang !== undefined) return true;
			return !(next.type === "code" && next.fenceChar === undefined && next.lang === undefined);
		case "paragraph":
			return interruptsParagraph(next);
		case "blockquote":
			// The quote's paragraph continues lazily into plain text, and an
			// adjacent quote merges; interrupting constructs close it.
			return next.type !== "blockquote" && next.type !== "paragraph" && interruptsParagraph(next);
		default:
			// Lists, HTML, definitions, footnote definitions and tables keep
			// the blank line — their termination is either type-dependent or
			// continuation-hungry.
			return false;
	}
};

/**
 * Serialize a sequence of flow blocks, handling sibling adjacency. With
 * `tight`, safe pairs join with a bare newline (tight-list items).
 */
const serializeBlocks = (children: ReadonlyArray<Block>, state: StringifyState, tight = false): string => {
	const parts: string[] = [];
	const nodes: Block[] = [];
	let previous: Block | undefined;
	let previousListMarker: string | undefined;
	for (const child of children) {
		guard(state, child);
		switch (child.type) {
			case "paragraph":
				parts.push(serializeInlines(child.children, FLOW_CONTEXT, state, true));
				previousListMarker = undefined;
				break;
			case "heading":
				parts.push(serializeHeading(child, state));
				previousListMarker = undefined;
				break;
			case "thematicBreak":
				parts.push((child.markerChar ?? "*").repeat(3));
				previousListMarker = undefined;
				break;
			case "code":
				// An indented block right after a list would be absorbed into
				// its last item on re-parse; force a fence there.
				parts.push(serializeCode(child, previous?.type === "list"));
				previousListMarker = undefined;
				break;
			case "html":
				parts.push(child.value);
				previousListMarker = undefined;
				break;
			case "blockquote": {
				const inner = serializeBlocks(child.children, state);
				parts.push(prefixLines(inner, "> ", ">"));
				previousListMarker = undefined;
				break;
			}
			case "list": {
				const flipped = previousListMarker !== undefined && previousListMarker === effectiveListMarker(child, false);
				parts.push(serializeList(child, state, flipped));
				previousListMarker = effectiveListMarker(child, flipped);
				break;
			}
			case "definition":
				parts.push(serializeDefinition(child));
				previousListMarker = undefined;
				break;
			case "footnoteDefinition":
				parts.push(serializeFootnoteDefinition(child, state));
				previousListMarker = undefined;
				break;
			case "table":
				parts.push(serializeTable(child, state));
				previousListMarker = undefined;
				break;
			case "frontmatter": {
				const open = child.format === "toml" ? "+++" : child.format === "json" ? "---json" : "---";
				const close = child.format === "toml" ? "+++" : "---";
				parts.push(child.value === "" ? `${open}\n${close}` : `${open}\n${child.value}\n${close}`);
				previousListMarker = undefined;
				break;
			}
		}
		previous = child;
		nodes.push(child);
		unguard(state);
	}
	if (!tight) return parts.join("\n\n");
	let out = "";
	for (let index = 0; index < parts.length; index += 1) {
		if (index > 0) {
			const prev = nodes[index - 1] as Block;
			const next = nodes[index] as Block;
			out += canJoinWithoutBlank(prev, next) ? "\n" : "\n\n";
		}
		out += parts[index] as string;
	}
	return out;
};

/**
 * Serialize a document tree to canonical markdown source.
 *
 * Throws the raw `GuardExceeded` carrier when the tree nests past
 * `MAX_NESTING_DEPTH`; the facade materializes the typed error. Output is
 * empty for an empty root and ends with exactly one newline otherwise.
 */
export const stringifyTree = (root: Root): string => {
	const state: StringifyState = { depth: 0 };
	const body = serializeBlocks(root.children, state);
	return body === "" ? "" : `${body}\n`;
};
