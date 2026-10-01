import type { Cause as CauseType } from "effect";
import { Cause, Context, SchemaIssue } from "effect";
import { Cancelled } from "./Cancelled.js";
import type { Block, Document, InlineOf, TreeInput } from "./Doc.js";
import { Doc } from "./Doc.js";
import { Fmt } from "./Fmt.js";
import { issueEntries, issueTreeChildren } from "./internal/format.js";
import { NotInteractive } from "./NotInteractive.js";
import { Status } from "./Status.js";

/**
 * The protocol an error class implements to say how a failure is shown: a method under this key that returns the
 * document.
 *
 * @remarks
 * `CliFailure.toDoc` calls it for a typed failure that has one, so an application error draws itself (a heading, a
 * table of what went wrong) and the default report uses it with no registration. A `Symbol.for` key, so two copies
 * of this package agree on it.
 *
 * @public
 */
export const CliDoc: unique symbol = Symbol.for("@effected/cli/CliDoc");

/**
 * An error that draws itself: see {@link CliDoc}.
 *
 * @public
 */
export interface CliDocSource {
	readonly [CliDoc]: () => Document;
}

/**
 * Options for {@link CliFailure.toDoc}.
 *
 * @public
 */
export interface CliFailureOptions {
	/**
	 * A document per error `_tag`, for errors that do not implement {@link CliDoc}. A tag with no entry is shown by
	 * the default rules.
	 */
	readonly render?: Readonly<Record<string, (error: unknown) => Document>> | undefined;
	/** Turns an absolute path into its display form, for the stack frames; the identity by default. */
	readonly displayPath?: ((absolute: string) => string) | undefined;
}

/** The deepest an `Error.cause` chain, or a stack, is followed. */
const MAX_DEPTH = 8;
const MAX_SPANS = 32;

const hasCliDoc = (value: unknown): value is CliDocSource =>
	typeof value === "object" && value !== null && typeof (value as Partial<CliDocSource>)[CliDoc] === "function";

// String(value) can throw for an object with no prototype or a hostile toString, and says only "[object Object]" for
// a plain failure value: such a value with a string message is that message.
const describe = (value: unknown): string => {
	try {
		const text = String(value);
		if (text !== "[object Object]") return text;
		const message = (value as { readonly message?: unknown } | null)?.message;
		return typeof message === "string" ? message : text;
	} catch {
		return "[unprintable value]";
	}
};

const firstLine = (text: string): string => text.split(/\r\n|\r|\n/, 1)[0] ?? "";

const tagOf = (value: unknown): string | undefined => {
	if (typeof value !== "object" || value === null) return undefined;
	const tag = (value as { readonly _tag?: unknown })._tag;
	return typeof tag === "string" ? tag : undefined;
};

/** The failure status and the text of a message: one block per line, the status on the first. */
const failureBlocks = (message: string): ReadonlyArray<Block> => {
	const [first = "", ...rest] = message.split(/\r\n|\r|\n/);
	return [Doc.paragraph(Doc.status(Status.core, "failure"), " ", first), ...rest.map((line) => Doc.paragraph(line))];
};

/** The issue of a schema failure: the value itself, or the `issue` an error carries. */
const issueOf = (error: unknown): unknown => {
	if (SchemaIssue.isIssue(error)) return error;
	if (typeof error === "object" && error !== null) {
		const issue = (error as { readonly issue?: unknown }).issue;
		if (SchemaIssue.isIssue(issue)) return issue;
	}
	return undefined;
};

const schemaBlocks = (error: unknown): ReadonlyArray<Block> | undefined => {
	const entries = issueEntries(issueOf(error));
	if (entries.length === 0) return undefined;
	const header =
		typeof error === "object" && error !== null && !SchemaIssue.isIssue(error)
			? firstLine(describe((error as { readonly message?: unknown }).message ?? ""))
			: "";
	const label: Array<InlineOf<"Text"> | InlineOf<"StatusMark"> | string> = [
		Doc.status(Status.core, "failure"),
		" ",
		header === "" ? `invalid value (${Fmt.plural(entries.length, "problem")})` : header,
	];
	const root: TreeInput = { label, children: issueTreeChildren(entries) };
	return [Doc.tree(root)];
};

interface Frame {
	readonly raw: string;
	readonly fn?: string;
	readonly file?: string;
	readonly line?: number;
	readonly col?: number;
}

/** The location of a frame as a path: a `file:` URL decoded, or an absolute POSIX or drive path; else `undefined`. */
const asPath = (location: string): string | undefined => {
	if (location.startsWith("file:")) {
		try {
			const path = decodeURIComponent(new URL(location).pathname);
			return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
		} catch {
			return undefined;
		}
	}
	return location.startsWith("/") || /^[A-Za-z]:[\\/]/.test(location) ? location : undefined;
};

const parseFrame = (raw: string): Frame => {
	const text = raw.trim().replace(/^at\s+/, "");
	const wrapped = /^(.*?)\s+\((.*)\)$/.exec(text);
	const fn = wrapped?.[1];
	const location = wrapped === null ? text : (wrapped[2] ?? "");
	const position = /^(.*):(\d+):(\d+)$/.exec(location);
	const file = asPath(position === null ? location : (position[1] ?? ""));
	return {
		raw: text,
		...(fn === undefined || fn === "" ? {} : { fn }),
		...(file === undefined ? {} : { file }),
		...(file === undefined || position === null ? {} : { line: Number(position[2]), col: Number(position[3]) }),
	};
};

/** A frame that is the runtime's or Effect's, not the program's. */
const isInternal = (raw: string): boolean =>
	/node:internal\//.test(raw) ||
	/[\\/]node_modules[\\/]effect[\\/]/.test(raw) ||
	/[\\/]packages[\\/]effect[\\/]src[\\/]/.test(raw) ||
	/Generator\.next|~effect\//.test(raw);

/** The frames of a stack that belong to the program, and how many were left out. */
const cleanStack = (stack: unknown): { readonly frames: ReadonlyArray<Frame>; readonly hidden: number } => {
	if (typeof stack !== "string") return { frames: [], hidden: 0 };
	const lines = stack.split(/\r\n|\r|\n/).filter((line) => /^\s*at\s/.test(line));
	const kept = lines.filter((line) => !isInternal(line));
	return { frames: kept.map(parseFrame), hidden: lines.length - kept.length };
};

const frameBlock = (frame: Frame, displayPath: (absolute: string) => string): Block => {
	if (frame.file === undefined) return Doc.paragraph(Doc.text("at ", "muted"), frame.raw);
	const where = `${displayPath(frame.file)}${frame.line === undefined ? "" : `:${frame.line}:${frame.col}`}`;
	const target = {
		file: frame.file,
		...(frame.line === undefined ? {} : { line: frame.line }),
		...(frame.col === undefined ? {} : { col: frame.col }),
	};
	return Doc.paragraph(
		Doc.text("at ", "muted"),
		...(frame.fn === undefined ? [] : [`${frame.fn} `]),
		Doc.link(target, where),
	);
};

const stackBlock = (defect: Error, displayPath: (absolute: string) => string): Block => {
	const { frames, hidden } = cleanStack(defect.stack);
	if (frames.length > 0)
		return Doc.collapsible(
			"stack",
			frames.map((frame) => frameBlock(frame, displayPath)),
			{ open: true },
		);
	const note = hidden === 0 ? "no stack" : `no user frames (${hidden} internal frames hidden)`;
	return Doc.collapsible("stack", [Doc.paragraph(Doc.text(note, "muted"))], { open: true });
};

/** The `Error.cause` chain below a defect as a tree of one-line messages, or none. */
const causeTree = (defect: Error): Block | undefined => {
	const chain: Array<string> = [];
	const seen = new Set<unknown>([defect]);
	for (let current: unknown = defect.cause; current !== undefined && chain.length < MAX_DEPTH; ) {
		if (seen.has(current)) break;
		seen.add(current);
		chain.push(firstLine(describe(current)));
		current = current instanceof Error ? current.cause : undefined;
	}
	if (chain.length === 0) return undefined;
	const nest = (index: number): TreeInput =>
		index === chain.length - 1
			? { label: chain[index] as string }
			: { label: chain[index] as string, children: [nest(index + 1)] };
	return Doc.tree({ label: firstLine(describe(defect)), children: [nest(0)] });
};

const dieBlocks = (
	defect: unknown,
	spans: ReadonlyArray<Block>,
	displayPath: (absolute: string) => string,
): ReadonlyArray<Block> => {
	// A prompt that was cancelled, or refused for want of a terminal, is a defect to the runtime and a fixed line to a person.
	if (defect instanceof Cancelled || defect instanceof NotInteractive) return [Doc.paragraph(defect.message)];
	const header = failureBlocks(describe(defect));
	if (!(defect instanceof Error)) return [...header, ...spans];
	const chain = causeTree(defect);
	return [...header, ...spans, stackBlock(defect, displayPath), ...(chain === undefined ? [] : [chain])];
};

const failBlocks = (
	error: unknown,
	spans: ReadonlyArray<Block>,
	options: CliFailureOptions | undefined,
): ReadonlyArray<Block> => {
	if (hasCliDoc(error)) {
		try {
			return [...error[CliDoc](), ...spans];
		} catch {
			// A document that cannot be built falls through to the generic line: a report must not fail to report.
		}
	}
	const tag = tagOf(error);
	const custom =
		tag === undefined || options?.render === undefined || !Object.hasOwn(options.render, tag)
			? undefined
			: options.render[tag];
	if (custom !== undefined) {
		try {
			return [...custom(error), ...spans];
		} catch {
			// Likewise.
		}
	}
	if (error instanceof Cancelled || error instanceof NotInteractive) return [Doc.paragraph(error.message)];
	const schema = schemaBlocks(error);
	if (schema !== undefined) return [...schema, ...spans];
	return [...failureBlocks(describe(error)), ...spans];
};

/** `in: outer › inner`, from the span stack the runtime annotates a reason with, or none. */
const spanBlocks = (reason: CauseType.Reason<unknown>): ReadonlyArray<Block> => {
	const names: Array<string> = [];
	let frame = Context.getOrUndefined(Cause.reasonAnnotations(reason), Cause.StackTrace);
	while (frame !== undefined && names.length < MAX_SPANS) {
		names.push(frame.name);
		frame = frame.parent;
	}
	if (names.length === 0) return [];
	return [Doc.paragraph(Doc.text("in: ", "muted"), Doc.path(...names.reverse()))];
};

/**
 * A failure as a document: what the default report prints, and a building block for a custom one.
 *
 * @remarks
 * One run of blocks per `Cause` reason. A typed failure is, in order of preference: the document of an error that
 * implements {@link CliDoc}; the document `options.render` holds for its `_tag`; for `Cancelled` and
 * `NotInteractive`, their one fixed line; a `Tree` of the rejected values, for a schema error or issue; else a failure
 * status line with its message. A defect is its message followed by a collapsible `stack` of the program's own frames,
 * each a file link (so a terminal can open it in an editor), with `node:internal` and Effect's frames left out, then an
 * `Error.cause` chain as a tree. When cleaning leaves no frame the stack says
 * `no user frames (N internal frames hidden)`, never an empty block. A reason that ran under spans is followed by
 * `in: outer › inner`. Interrupts are not rendered beside a real failure, and a cause with only interrupts is the
 * one line `interrupted`.
 *
 * All text goes through the document, so a control character in a message or a stack frame never reaches the terminal.
 * Render it with `Render.context` and `Render.plain`, `ansi`, `markdown` or `githubLog`, or `Doc.print` it.
 *
 * @public
 */
export class CliFailure {
	private constructor() {}

	/**
	 * Build the document of a cause.
	 *
	 * @param cause - the failure
	 * @param options - per-tag documents and a path display function
	 */
	static readonly toDoc = (cause: CauseType.Cause<unknown>, options?: CliFailureOptions): Document => {
		const reasons = cause.reasons;
		if (reasons.length > 0 && reasons.every(Cause.isInterruptReason)) return [Doc.paragraph("interrupted")];
		const displayPath = options?.displayPath ?? ((absolute: string) => absolute);
		return reasons.flatMap((reason): ReadonlyArray<Block> => {
			if (Cause.isFailReason(reason)) return failBlocks(reason.error, spanBlocks(reason), options);
			if (Cause.isDieReason(reason)) return dieBlocks(reason.defect, spanBlocks(reason), displayPath);
			return [];
		});
	};
}
