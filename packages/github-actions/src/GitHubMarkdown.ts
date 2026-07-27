import {
	Code,
	Html,
	InlineCode,
	Link,
	List,
	ListItem,
	Markdown,
	Paragraph,
	Root,
	Table,
	TableCell,
	TableRow,
} from "@effected/markdown";
import { Result, Schema, SchemaAST } from "effect";

/**
 * A heading level GitHub renders, `1` through `6`.
 *
 * @public
 */
export type GitHubHeadingDepth = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Options for {@link GitHubMarkdown.list}.
 *
 * @public
 */
export interface GitHubListOptions {
	/** Render `1.`-numbered items instead of bullets. */
	readonly ordered?: boolean | undefined;
}

/**
 * The row-schema constraint {@link GitHubMarkdown.tableFor} accepts: any
 * schema exposing a struct field map — `Schema.Struct` and `Schema.Class`
 * both qualify.
 *
 * @public
 */
export type GitHubRowSchema = Schema.Constraint & { readonly fields: Schema.Struct.Fields };

/**
 * The field keys of a row schema whose column REQUIRES an explicit
 * `format`: fields whose encoded side is not a string (their codec has no
 * string projection to borrow), and fields whose encoding needs services
 * (a sync cell render cannot provide them).
 *
 * @public
 */
export type GitHubSchemaTableFormatRequiredKeys<Fields extends Schema.Struct.Fields> = {
	[K in keyof Fields]: [Fields[K]["Encoded"]] extends [string | undefined]
		? [Fields[K]["EncodingServices"]] extends [never]
			? never
			: K
		: K;
}[keyof Fields];

/**
 * Per-column configuration for {@link GitHubMarkdown.tableFor}.
 *
 * @public
 */
export interface GitHubSchemaTableColumn<Value> {
	/**
	 * The column header, overriding the field schema's `title` annotation
	 * and the field-name fallback. Pre-rendered markdown, like every cell.
	 */
	readonly header?: string | undefined;
	/**
	 * Render a cell from the decoded field value instead of encoding it
	 * through the field's codec. Required — by type — for a field whose
	 * encoded side is not a string.
	 */
	readonly format?: ((value: Value) => string) | undefined;
}

/**
 * {@link GitHubSchemaTableColumn} with the `format` obligation discharged —
 * the entry shape a non-string-encoded field demands.
 *
 * @public
 */
export interface GitHubSchemaTableFormattedColumn<Value> extends GitHubSchemaTableColumn<Value> {
	readonly format: (value: Value) => string;
}

/**
 * The per-field column map for {@link GitHubMarkdown.tableFor}: entries are
 * optional except where the field's encoded side is not a string, where the
 * entry — and its `format` — are required.
 *
 * @public
 */
export type GitHubSchemaTableColumns<Fields extends Schema.Struct.Fields> = {
	readonly [K in GitHubSchemaTableFormatRequiredKeys<Fields>]: GitHubSchemaTableFormattedColumn<
		Exclude<Fields[K]["Type"], undefined>
	>;
} & {
	readonly [K in Exclude<keyof Fields, GitHubSchemaTableFormatRequiredKeys<Fields>>]?: GitHubSchemaTableColumn<
		Exclude<Fields[K]["Type"], undefined>
	>;
};

/**
 * Options for {@link GitHubMarkdown.tableFor}. The whole bag is optional
 * exactly when every field's encoded side is a string; one field without a
 * string projection makes `columns` — and the entry carrying its `format` —
 * required.
 *
 * @public
 */
export type GitHubSchemaTableOptions<Fields extends Schema.Struct.Fields> = [
	GitHubSchemaTableFormatRequiredKeys<Fields>,
] extends [never]
	? { readonly columns?: GitHubSchemaTableColumns<Fields> | undefined }
	: { readonly columns: GitHubSchemaTableColumns<Fields> };

/**
 * A renderer minted by {@link GitHubMarkdown.tableFor}: columns are fixed by
 * the schema, rows are supplied at each render.
 *
 * @public
 */
export interface GitHubSchemaTable<Row> {
	/**
	 * Render the current rows as a GFM table. Pure and repeatable — identical
	 * rows produce identical output, so re-rendering from changed state is
	 * just calling it again.
	 */
	render(rows: ReadonlyArray<Row>): string;
}

/** The runtime view of a column after the type-level obligations are erased. */
interface ColumnRuntime {
	readonly key: string;
	readonly header: string;
	readonly cell: (value: unknown) => string;
}

/**
 * A block node whose value passes through the serializer verbatim, which is
 * exactly how a pre-rendered markdown fragment must travel: GFM structure
 * around it is escaped, the fragment itself is not.
 */
const passthrough = (value: string): Html => Html.make({ value });

/**
 * Serialize a tree the writer built itself.
 *
 * @remarks
 * `Markdown.stringifyResult` is total over every tree this module can
 * construct — its only failure is the hardening depth cap, which a
 * fixed-shape two-level tree cannot reach — so the impossible arm is a
 * defect, **not** a silent fallback to unescaped string joining. The
 * predecessor's fallback arm is the live table-corruption defect this module
 * exists to delete.
 */
const render = (root: Root): string => Result.getOrThrow(Markdown.stringifyResult(root)).trimEnd();

const block = (node: Root["children"][number]): string => render(Root.make({ children: [node] }));

/**
 * The fluent markdown writer for GitHub surfaces — PR comments, check-run
 * summaries, job summaries.
 *
 * @remarks
 * Every member takes **pre-rendered markdown** (links, emphasis, emoji — the
 * caller's fragments pass through verbatim) and returns a `string`, so
 * compositions read as plain string assembly. What the writer owns is the
 * *structure*: wherever a fragment could break the construct around it, the
 * output goes through `@effected/markdown`'s node classes and serializer
 * rather than string joining. A table cell carrying `>=1 || <2` renders with
 * its pipes escaped instead of shifting every column after it; a code block
 * whose content contains a fence gets a longer fence; inline code containing
 * a backtick gets a wider delimiter; a URL containing spaces or parentheses
 * is angle-bracketed.
 *
 * This module is the package's **only** importer of `@effected/markdown` — a
 * structural test pins that, on the same terms as the Azure confinement — so
 * an action that never renders markdown never links the engine.
 *
 * @example
 * ```ts
 * import { GitHubMarkdown } from "@effected/github-actions";
 *
 * const body = [
 *   GitHubMarkdown.heading("Release Validation"),
 *   GitHubMarkdown.table(["Check", "Outcome"], [["build", "✅ passed"]]),
 *   GitHubMarkdown.details("Logs", GitHubMarkdown.codeBlock(log, "text")),
 * ].join("\n\n");
 * ```
 *
 * @public
 */
export class GitHubMarkdown {
	private constructor() {}

	/**
	 * A GFM table.
	 *
	 * @remarks
	 * Cells are pre-rendered markdown; the serializer escapes the pipes GFM
	 * would otherwise read as column breaks. Rows shorter than the header are
	 * padded with empty cells rather than shifting.
	 */
	static table(headers: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<string>>): string {
		const cells = (values: ReadonlyArray<string>): TableRow =>
			TableRow.make({
				children: Array.from({ length: headers.length }, (_, index) =>
					TableCell.make({ children: [passthrough(values[index] ?? "")] }),
				),
			});
		return block(Table.make({ children: [cells(headers), ...rows.map(cells)] }));
	}

	/**
	 * A GFM table whose columns are defined ONCE by a row schema.
	 *
	 * @remarks
	 * The schema is the single authority for the table's shape: column order
	 * is field declaration order, each header is the field's `title`
	 * annotation (fall back: the property name, overridable per column), and
	 * each cell is the field value's **encoded** string form — a branded or
	 * typed field projects through its own codec, so the vocabulary lives
	 * with the schema instead of being respelled at every call site, and a
	 * row can no longer transpose columns because it is a typed object, not
	 * a positional array.
	 *
	 * A field whose encoded side is not a string has no string projection to
	 * borrow; the type of `options` makes its column's `format` — and
	 * therefore `columns` and `options` themselves — required. An absent or
	 * `undefined` optional field renders as an empty cell without consulting
	 * codec or formatter.
	 *
	 * The renderer is a pure value: `render` maps current rows through
	 * {@link GitHubMarkdown.table}, so escaping is inherited and identical
	 * rows produce identical output. Rows are already-decoded values of the
	 * schema's type, so encoding them is total in practice; a value smuggled
	 * past the types throws the codec's `SchemaError` as a defect — same
	 * posture as the serializer arm above, **not** a silent fallback.
	 *
	 * Only string-keyed fields become columns; symbol keys are not
	 * enumerable table columns.
	 *
	 * @example
	 * ```ts
	 * import { GitHubMarkdown } from "@effected/github-actions";
	 * import { Schema } from "effect";
	 *
	 * const CheckRow = Schema.Struct({
	 *   name: Schema.String.annotate({ title: "Check" }),
	 *   outcome: Schema.Literals(["passed", "failed"]),
	 * });
	 * const checks = GitHubMarkdown.tableFor(CheckRow);
	 * const body = checks.render([{ name: "build", outcome: "passed" }]);
	 * ```
	 */
	static tableFor<S extends GitHubRowSchema>(
		schema: S,
		...options: [GitHubSchemaTableFormatRequiredKeys<S["fields"]>] extends [never]
			? [options?: GitHubSchemaTableOptions<S["fields"]>]
			: [options: GitHubSchemaTableOptions<S["fields"]>]
	): GitHubSchemaTable<S["Type"]> {
		const overrides = (options[0]?.columns ?? {}) as Record<string, GitHubSchemaTableColumn<unknown> | undefined>;
		const columns: ReadonlyArray<ColumnRuntime> = Object.keys(schema.fields).map((key) => {
			const field = schema.fields[key] as Schema.Constraint;
			const column = overrides[key];
			const format = column?.format;
			const encode =
				format === undefined
					? (Schema.encodeSync(field as Schema.ConstraintEncoder<string | undefined>) as (
							value: unknown,
						) => string | undefined)
					: undefined;
			return {
				key,
				header: column?.header ?? SchemaAST.resolveTitle(field.ast) ?? key,
				cell: (value: unknown): string =>
					value === undefined ? "" : format !== undefined ? format(value) : (encode?.(value) ?? ""),
			};
		});
		const headers = columns.map((column) => column.header);
		return {
			render: (rows: ReadonlyArray<S["Type"]>): string =>
				GitHubMarkdown.table(
					headers,
					rows.map((row) => columns.map((column) => column.cell((row as Record<string, unknown>)[column.key]))),
				),
		};
	}

	/** An ATX heading; the level defaults to `2`. */
	static heading(text: string, level: GitHubHeadingDepth = 2): string {
		return `${"#".repeat(level)} ${text}`;
	}

	/** A link. URLs the destination cannot carry raw are angle-bracketed. */
	static link(text: string, url: string): string {
		return block(Paragraph.make({ children: [Link.make({ url, children: [passthrough(text)] })] }));
	}

	/** Inline code. Content containing backticks widens the delimiter. */
	static code(text: string): string {
		return block(Paragraph.make({ children: [InlineCode.make({ value: text })] }));
	}

	/** A fenced code block. Content containing a fence lengthens the fence. */
	static codeBlock(content: string, language?: string): string {
		// The explicit fenceChar keeps a language-less block FENCED: without it
		// the serializer falls back to an indented code block, which GitHub
		// renders but which cannot be copy-pasted around other markdown safely.
		return block(
			Code.make({
				value: content,
				fenceChar: "`",
				...(language === undefined || language === "" ? {} : { lang: language }),
			}),
		);
	}

	/**
	 * A list of pre-rendered markdown items.
	 *
	 * @remarks
	 * A multi-line item is indented onto continuation lines, so it stays part
	 * of its bullet instead of terminating the list.
	 */
	static list(items: ReadonlyArray<string>, options?: GitHubListOptions): string {
		const ordered = options?.ordered ?? false;
		return block(
			List.make({
				ordered,
				...(ordered ? { start: 1 } : {}),
				children: items.map((item) => ListItem.make({ children: [passthrough(item)] })),
			}),
		);
	}

	/**
	 * A collapsible `<details>` block.
	 *
	 * @remarks
	 * mdast has no details node, so this is the one construct the writer emits
	 * as raw HTML. The blank lines around `body` are what make GitHub render
	 * the markdown inside it; `summary` is HTML context — markdown is **not**
	 * rendered there, so bold a summary with `<strong>`, not `**`.
	 */
	static details(summary: string, body: string): string {
		return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
	}

	/**
	 * Pre-rendered markdown, passed through by name.
	 *
	 * @remarks
	 * The identity function, deliberately: every writer member already treats
	 * its fragments as markdown, so `raw` adds no behavior — it adds the
	 * *statement* that a value is already rendered. Use it where a fragment
	 * from elsewhere enters a composition and a reader would otherwise wonder
	 * whether it still needs escaping. It replaces the `Html.make` idiom,
	 * which passes markdown through correctly but announces the wrong intent.
	 */
	static raw(markdown: string): string {
		return markdown;
	}
}
