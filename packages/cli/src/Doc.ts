import type { Audience, TerminalEnv } from "@effected/env";
import { Console, Effect } from "effect";
import type { CliLinks } from "./CliLinks.js";
import type { CliTheme } from "./CliTheme.js";
import { autoFormat } from "./internal/autoFormat.js";
import { totalOf, visibleCountersOf } from "./internal/counts.js";
import { Render } from "./Render.js";
import type { Status, StatusDef } from "./Status.js";
import type { Style, TokenName } from "./Token.js";

/**
 * A status as a document stores it: its name and its resolved definition.
 *
 * @remarks
 * The definition is stored, not the vocabulary, so a node stays plain data.
 *
 * @public
 */
export interface StatusRef {
	/** The name in the vocabulary it was resolved from. */
	readonly name: string;
	/** The resolved definition. */
	readonly def: StatusDef;
}

/**
 * Where a link points: a URL, or a file with an optional position.
 *
 * @public
 */
export type LinkTarget =
	| { readonly url: string }
	| { readonly file: string; readonly line?: number; readonly col?: number };

/**
 * Content that flows inside a line.
 *
 * @remarks
 * - `Text`: a run of text, optionally painted with a token or style.
 * - `Code`: code in a monospace span.
 * - `Link`: a labelled link to a URL or a file position.
 * - `StatusMark`: a status glyph, carrying its resolved definition.
 * - `Path`: a path or breadcrumb, joined with the audience's path separator.
 *
 * @public
 */
export type Inline =
	| { readonly _tag: "Text"; readonly value: string; readonly token?: TokenName | Style }
	| { readonly _tag: "Code"; readonly value: string }
	| { readonly _tag: "Link"; readonly target: LinkTarget; readonly label: ReadonlyArray<Inline> }
	| { readonly _tag: "StatusMark"; readonly name: string; readonly def: StatusDef }
	| { readonly _tag: "Path"; readonly segments: ReadonlyArray<string> };

/**
 * A node of a {@link TreeNode} tree: a label and its children.
 *
 * @public
 */
export interface TreeNode {
	/** What the node says. */
	readonly label: ReadonlyArray<Inline>;
	/** Its children, in order. */
	readonly children: ReadonlyArray<TreeNode>;
}

/**
 * One column of a table.
 *
 * @public
 */
export interface Column {
	/** The header cell. */
	readonly header: ReadonlyArray<Inline>;
	/** How the column's cells align; left when unset. */
	readonly align?: "left" | "right" | "center";
}

/**
 * One counter of a `Counts` block.
 *
 * @public
 */
export interface Counter {
	/** A stable identifier, for a caller's total rule. */
	readonly key: string;
	/** What the counter is called when shown. */
	readonly label: string;
	/** The count. */
	readonly n: number;
	/** The status the count is painted with. */
	readonly status: StatusRef;
	/** Show the counter when `n` is zero; by default a zero counter is hidden. */
	readonly showZero?: boolean;
}

/**
 * A block of a document.
 *
 * @remarks
 * - `Paragraph`: one logical line; a paragraph of paragraphs is a `Section`.
 * - `List` and `Table`: with an optional `cap` on the rows shown, and an `overflow` that says what the hidden rows
 *   amount to, given how many there are.
 * - `Tree`: nested labels.
 * - `Collapsible`: a titled body a renderer may fold.
 * - `Callout`: a body with a kind.
 * - `CodeBlock`: preformatted text, with an optional language.
 * - `Diff`: expected against received text, with an optional cap on the lines shown.
 * - `Section`: children under an optional title.
 * - `Counts`: labelled counters in one of three layouts. `total` replaces the default sum of every counter, and
 *   `durationMs` is how long it took.
 *
 * Nodes are plain data and nothing decodes them, so a function field such as `overflow` or `total` is fine.
 *
 * @public
 */
export type Block =
	| { readonly _tag: "Heading"; readonly level: 1 | 2 | 3 | 4; readonly content: ReadonlyArray<Inline> }
	| { readonly _tag: "Paragraph"; readonly content: ReadonlyArray<Inline> }
	| {
			readonly _tag: "List";
			readonly items: ReadonlyArray<Block>;
			readonly cap?: number;
			readonly overflow?: (hidden: number) => ReadonlyArray<Inline>;
	  }
	| {
			readonly _tag: "Table";
			readonly columns: ReadonlyArray<Column>;
			readonly rows: ReadonlyArray<ReadonlyArray<ReadonlyArray<Inline>>>;
			readonly cap?: number;
			readonly overflow?: (hidden: number) => ReadonlyArray<Inline>;
	  }
	| { readonly _tag: "Tree"; readonly root: TreeNode }
	| {
			readonly _tag: "Collapsible";
			readonly title: ReadonlyArray<Inline>;
			readonly body: ReadonlyArray<Block>;
			readonly open?: boolean;
	  }
	| {
			readonly _tag: "Callout";
			readonly kind: "note" | "tip" | "important" | "warning" | "caution";
			readonly body: ReadonlyArray<Block>;
	  }
	| { readonly _tag: "CodeBlock"; readonly lang?: string; readonly text: string }
	| { readonly _tag: "Diff"; readonly expected: string; readonly received: string; readonly cap?: number }
	| { readonly _tag: "Section"; readonly title?: ReadonlyArray<Inline>; readonly children: ReadonlyArray<Block> }
	| {
			readonly _tag: "Counts";
			readonly label?: ReadonlyArray<Inline>;
			readonly counters: ReadonlyArray<Counter>;
			readonly total?: (counters: ReadonlyArray<Counter>) => number;
			readonly qualifier?: ReadonlyArray<Inline>;
			readonly durationMs?: number;
			readonly layout: "inline" | "columns" | "row";
	  };

/**
 * A whole document: its blocks, in order.
 *
 * @public
 */
export type Document = ReadonlyArray<Block>;

/**
 * What a constructor accepts for content: a string, one `Inline`, or an array of either.
 *
 * @remarks
 * A string becomes a `Text` node with no token.
 *
 * @public
 */
export type InlineInput = string | Inline | ReadonlyArray<string | Inline>;

/**
 * A tree node as a constructor accepts it: the label may be a string and `children` may be left out.
 *
 * @public
 */
export interface TreeInput {
	/** What the node says. */
	readonly label: InlineInput;
	/** Its children; none when omitted. */
	readonly children?: ReadonlyArray<TreeInput>;
}

/**
 * The inline node with a given `_tag`, so a constructor can return its precise type.
 *
 * @public
 */
export type InlineOf<Tag extends Inline["_tag"]> = Extract<Inline, { readonly _tag: Tag }>;

/**
 * The block node with a given `_tag`, so a constructor can return its precise type.
 *
 * @public
 */
export type BlockOf<Tag extends Block["_tag"]> = Extract<Block, { readonly _tag: Tag }>;

/**
 * The cap and overflow options of a list or table.
 *
 * @public
 */
export interface OverflowOptions {
	/** The most rows to show; the renderer hides the rest. */
	readonly cap?: number;
	/** Says what the hidden rows amount to, given how many there are; it is a function and is never serialised. */
	readonly overflow?: (hidden: number) => InlineInput;
}

/**
 * The options of {@link Doc.counts}.
 *
 * @public
 */
export interface CountsOptions {
	/** A leading label. */
	readonly label?: InlineInput;
	/** The counters, in the order they are shown. */
	readonly counters: ReadonlyArray<Counter>;
	/** Replaces the default total, the sum of `n` over every counter, for example to fold timed-out runs in. */
	readonly total?: (counters: ReadonlyArray<Counter>) => number;
	/** Text after the counters, such as `(1 flaky)`. */
	readonly qualifier?: InlineInput;
	/** How long it took, in milliseconds. */
	readonly durationMs?: number;
	/** How the counters are laid out. */
	readonly layout: "inline" | "columns" | "row";
}

const isList = (input: InlineInput): input is ReadonlyArray<string | Inline> => Array.isArray(input);

const freeze = <A extends object>(value: A): Readonly<A> => Object.freeze(value);

const frozenArray = <A>(items: ReadonlyArray<A>): ReadonlyArray<A> => Object.freeze([...items]);

const text = (value: string, token?: TokenName | Style): InlineOf<"Text"> =>
	freeze({ _tag: "Text", value, ...(token === undefined ? {} : { token }) });

const inlineOne = (part: string | Inline): Inline => (typeof part === "string" ? text(part) : part);

const inlines = (input: InlineInput): ReadonlyArray<Inline> =>
	frozenArray(isList(input) ? input.map(inlineOne) : [inlineOne(input)]);

const overflowOf =
	(overflow: (hidden: number) => InlineInput): ((hidden: number) => ReadonlyArray<Inline>) =>
	(hidden) =>
		inlines(overflow(hidden));

const overflowFields = (options: OverflowOptions | undefined) => ({
	...(options?.cap === undefined ? {} : { cap: options.cap }),
	...(options?.overflow === undefined ? {} : { overflow: overflowOf(options.overflow) }),
});

const treeNode = (input: TreeInput): TreeNode =>
	freeze({ label: inlines(input.label), children: frozenArray((input.children ?? []).map(treeNode)) });

const counterOf = (counter: Counter): Counter =>
	freeze({
		...counter,
		status: freeze({ name: counter.status.name, def: freeze({ ...counter.status.def }) }),
	});

/**
 * Options for {@link Doc.print}.
 *
 * @public
 */
export interface DocPrintOptions {
	/** The stream to write to; `stdout` by default. */
	readonly stream?: "stdout" | "stderr" | undefined;
	/**
	 * The renderer. `auto`, the default, is chosen from the audience: `plain` for an agent, `githubLog` for a CI
	 * that `CurrentRuntimeEnv` says is GitHub Actions and `plain` for any other, and `ansi` for a human.
	 */
	readonly format?: "auto" | "plain" | "ansi" | "markdown" | "githubLog" | undefined;
	/** Turns an absolute path into its display form, for example relative to the workspace; see `Render.context`. */
	readonly displayPath?: ((absolute: string) => string) | undefined;
	/** The display columns to lay out at, replacing the audience's default; see `Render.context`. */
	readonly width?: number | undefined;
}

/**
 * Constructors for the document IR, and two helpers a renderer shares.
 *
 * @remarks
 * Every constructor returns a frozen node and copies the arrays it is given, so editing an input afterwards
 * cannot change a document. An optional field that is not given is absent from the node, not `undefined`.
 * Content arguments accept a string, an `Inline` or an array of either.
 *
 * A node is plain data: nothing decodes or encodes one, so a function field such as `overflow` or `total` is fine
 * and a document is not meant to be serialised.
 *
 * Freezing covers what a `Doc` constructor builds. A literal you write by hand is not frozen, and a `Style` object
 * given as a token is shared by reference (the freeze of a status definition is shallow for the same reason).
 *
 * @public
 */
export class Doc {
	private constructor() {}

	/**
	 * A run of text.
	 *
	 * @param value - the text
	 * @param token - a semantic token or a style to paint it with
	 */
	static text(value: string, token?: TokenName | Style): InlineOf<"Text"> {
		return text(value, token);
	}

	/**
	 * Code in a monospace span.
	 *
	 * @param value - the code
	 */
	static code(value: string): InlineOf<"Code"> {
		return freeze({ _tag: "Code", value });
	}

	/**
	 * A link to a URL or a file position.
	 *
	 * @param target - `{ url }` or `{ file, line?, col? }`
	 * @param label - what the link says; when omitted, the bare URL or file path, which leaves out `line` and `col`
	 */
	static link(target: LinkTarget, label?: InlineInput): InlineOf<"Link"> {
		const fallback = "url" in target ? target.url : target.file;
		return freeze({ _tag: "Link", target: freeze({ ...target }), label: inlines(label ?? fallback) });
	}

	/**
	 * A status glyph, holding the resolved definition.
	 *
	 * @remarks
	 * A name the vocabulary does not have is a compile error.
	 *
	 * @param vocab - the vocabulary the name belongs to
	 * @param name - a status name in it
	 */
	static status<N extends string>(vocab: Status<N>, name: NoInfer<N>): InlineOf<"StatusMark"> {
		return freeze({ _tag: "StatusMark", name, def: vocab.resolve(name) });
	}

	/**
	 * A path or breadcrumb; a renderer joins the segments with the audience's separator.
	 *
	 * @param segments - the segments, in order
	 */
	static path(...segments: Array<string>): InlineOf<"Path"> {
		return freeze({ _tag: "Path", segments: frozenArray(segments) });
	}

	/**
	 * A heading.
	 *
	 * @param level - 1 to 4
	 * @param content - the heading text
	 */
	static heading(level: 1 | 2 | 3 | 4, content: InlineInput): BlockOf<"Heading"> {
		return freeze({ _tag: "Heading", level, content: inlines(content) });
	}

	/**
	 * One logical line of content.
	 *
	 * @param content - any number of strings, inlines or arrays of them, in order
	 */
	static paragraph(...content: Array<InlineInput>): BlockOf<"Paragraph"> {
		return freeze({ _tag: "Paragraph", content: inlines(content.flatMap((part) => (isList(part) ? part : [part]))) });
	}

	/**
	 * A list of blocks.
	 *
	 * @param items - the items
	 * @param options - `cap` and `overflow`
	 */
	static list(items: ReadonlyArray<Block>, options?: OverflowOptions): BlockOf<"List"> {
		return freeze({ _tag: "List", items: frozenArray(items), ...overflowFields(options) });
	}

	/**
	 * A table.
	 *
	 * @param columns - the columns: a header and an optional alignment each
	 * @param rows - the rows; each cell takes a string, an inline or an array of either
	 * @param options - `cap` and `overflow`
	 */
	static table(
		columns: ReadonlyArray<{ readonly header: InlineInput; readonly align?: "left" | "right" | "center" }>,
		rows: ReadonlyArray<ReadonlyArray<InlineInput>>,
		options?: OverflowOptions,
	): BlockOf<"Table"> {
		return freeze({
			_tag: "Table",
			columns: frozenArray(
				columns.map((column) =>
					freeze({ header: inlines(column.header), ...(column.align === undefined ? {} : { align: column.align }) }),
				),
			),
			rows: frozenArray(rows.map((row) => frozenArray(row.map(inlines)))),
			...overflowFields(options),
		});
	}

	/**
	 * A tree of labels.
	 *
	 * @param root - the root; a node's `children` may be left out
	 */
	static tree(root: TreeInput): BlockOf<"Tree"> {
		return freeze({ _tag: "Tree", root: treeNode(root) });
	}

	/**
	 * A titled body a renderer may fold.
	 *
	 * @param title - the title
	 * @param body - the body
	 * @param options - `open` asks for it to start unfolded
	 */
	static collapsible(
		title: InlineInput,
		body: ReadonlyArray<Block>,
		options?: { readonly open?: boolean },
	): BlockOf<"Collapsible"> {
		return freeze({
			_tag: "Collapsible",
			title: inlines(title),
			body: frozenArray(body),
			...(options?.open === undefined ? {} : { open: options.open }),
		});
	}

	/**
	 * A callout.
	 *
	 * @param kind - `note`, `tip`, `important`, `warning` or `caution`
	 * @param body - the body
	 */
	static callout(
		kind: "note" | "tip" | "important" | "warning" | "caution",
		body: ReadonlyArray<Block>,
	): BlockOf<"Callout"> {
		return freeze({ _tag: "Callout", kind, body: frozenArray(body) });
	}

	/**
	 * Preformatted text.
	 *
	 * @param text - the text
	 * @param lang - its language, for a renderer that fences it
	 */
	static codeBlock(text: string, lang?: string): BlockOf<"CodeBlock"> {
		return freeze({ _tag: "CodeBlock", ...(lang === undefined ? {} : { lang }), text });
	}

	/**
	 * Expected against received text.
	 *
	 * @param expected - the expected text
	 * @param received - the received text
	 * @param options - `cap` limits the lines shown
	 */
	static diff(expected: string, received: string, options?: { readonly cap?: number }): BlockOf<"Diff"> {
		return freeze({
			_tag: "Diff",
			expected,
			received,
			...(options?.cap === undefined ? {} : { cap: options.cap }),
		});
	}

	/**
	 * Children under an optional title.
	 *
	 * @param title - the title, or `undefined` for none
	 * @param children - the blocks
	 */
	static section(title: InlineInput | undefined, children: ReadonlyArray<Block>): BlockOf<"Section"> {
		return freeze({
			_tag: "Section",
			...(title === undefined ? {} : { title: inlines(title) }),
			children: frozenArray(children),
		});
	}

	/**
	 * One counter of a `Counts` block, with its status definition resolved.
	 *
	 * @remarks
	 * A name the vocabulary does not have is a compile error.
	 *
	 * @param vocab - the vocabulary the status belongs to
	 * @param name - a status name in it
	 * @param options - the counter's `key`, `label` and count `n`, and `showZero` to keep it when `n` is zero
	 */
	static counter<N extends string>(
		vocab: Status<N>,
		name: NoInfer<N>,
		options: { readonly key: string; readonly label: string; readonly n: number; readonly showZero?: boolean },
	): Counter {
		return counterOf({
			key: options.key,
			label: options.label,
			n: options.n,
			status: { name, def: vocab.resolve(name) },
			...(options.showZero === undefined ? {} : { showZero: options.showZero }),
		});
	}

	/**
	 * Counters in one of three layouts.
	 *
	 * @param options - the counters, the layout and the optional label, total rule, qualifier and duration
	 */
	static counts(options: CountsOptions): BlockOf<"Counts"> {
		return freeze({
			_tag: "Counts",
			...(options.label === undefined ? {} : { label: inlines(options.label) }),
			counters: frozenArray(options.counters.map(counterOf)),
			...(options.total === undefined ? {} : { total: options.total }),
			...(options.qualifier === undefined ? {} : { qualifier: inlines(options.qualifier) }),
			...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
			layout: options.layout,
		});
	}

	/**
	 * The total of a `Counts` block: the caller's rule when it has one, otherwise the sum of `n` over every counter.
	 *
	 * @remarks
	 * The rule sees every counter, including the ones a renderer hides, so hiding never changes the total.
	 *
	 * @param block - the `Counts` block
	 */
	static total(block: BlockOf<"Counts">): number {
		return totalOf(block);
	}

	/**
	 * The counters a renderer shows: every one except a zero counter that does not ask for `showZero`.
	 *
	 * @param block - the `Counts` block
	 */
	static visibleCounters(block: BlockOf<"Counts">): ReadonlyArray<Counter> {
		return visibleCountersOf(block);
	}

	/**
	 * Render a document for whoever is running the program and write it to a stream.
	 *
	 * @remarks
	 * The context is {@link Render.context} for the stream, so the width, the colour, the links and the audience
	 * come from the services the program already has, and the text is written with `Console.log` or
	 * `Console.error`: a test captures it by swapping the `Console`. With `format: "auto"` the renderer follows
	 * the audience, and the width is unbounded for an agent and a CI.
	 *
	 * An agent is never written an escape of any kind, even with an explicit `format: "ansi"`: its context is
	 * colourless and its links are off. A document that renders to nothing prints nothing.
	 *
	 * `CurrentRuntimeEnv` is read if the environment has one and is not required: a `ci` audience prints
	 * GitHub's log format only when it says GitHub Actions, and plain text otherwise, including when it is
	 * absent. An explicit `format` is honoured whatever the audience.
	 *
	 * @param doc - the document
	 * @param options - the stream and the format
	 */
	static readonly print = (
		doc: Document,
		options?: DocPrintOptions,
	): Effect.Effect<void, never, CliTheme | TerminalEnv | Audience | CliLinks> =>
		Effect.gen(function* () {
			const stream = options?.stream ?? "stdout";
			const ctx = yield* Render.context(stream, {
				...(options?.displayPath === undefined ? {} : { displayPath: options.displayPath }),
				...(options?.width === undefined ? {} : { width: options.width }),
			});
			const requested = options?.format ?? "auto";
			const format = requested === "auto" ? yield* autoFormat(ctx.audience) : requested;
			const text = Render[format](doc, ctx);
			// An empty document prints nothing, not a blank line.
			if (text === "") return;
			yield* stream === "stderr" ? Console.error(text) : Console.log(text);
		});
}
