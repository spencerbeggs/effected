// The run's report as `Schema` classes, so the CLI's JSON and the MCP's result
// are encodings of one thing and cannot drift. The field order of `SchemaReport`
// is the order `RunReport.Json` emits.

import { PipelineFinding, SchemaVersion } from "@effected/schemastore";
import { Schema, SchemaTransformation } from "effect";

/**
 * One line of a {@link DocumentDiff} hunk, mirroring `LineDiffLine` from
 * `@effected/source`, which stays free of any dependency.
 *
 * @public
 */
export const LineDiffLineSchema = Schema.Struct({
	kind: Schema.Literals(["context", "add", "remove"]),
	text: Schema.String,
	/** 1-based line in the old text; absent on an `add`. */
	oldLine: Schema.optionalKey(Schema.Number),
	/** 1-based line in the new text; absent on a `remove`. */
	newLine: Schema.optionalKey(Schema.Number),
	/** Set on a line that is the last of its text and has no terminating newline. */
	noNewline: Schema.optionalKey(Schema.Literal(true)),
});

/**
 * One {@link DocumentDiff} hunk, mirroring `LineDiffHunk` from `@effected/source`.
 *
 * @public
 */
export const LineDiffHunkSchema = Schema.Struct({
	oldStart: Schema.Number,
	oldLines: Schema.Number,
	newStart: Schema.Number,
	newLines: Schema.Number,
	lines: Schema.Array(LineDiffLineSchema),
});

/**
 * What differs between a document on disk and the generated one, line by line.
 *
 * @remarks
 * Both sides are in the kit's canonical JSON layout, so hunk line numbers refer
 * to that form, which is byte-identical to the file in a tab-indented repo. A
 * document that does not parse diffs as its raw text, and a missing one as all
 * additions.
 *
 * @public
 */
export class DocumentDiff extends Schema.Class<DocumentDiff>("DocumentDiff")({
	/** The hunks, for a consumer that draws its own diff. */
	hunks: Schema.Array(LineDiffHunkSchema),
	/** The same hunks as git-style unified text. */
	unified: Schema.String,
}) {}

/**
 * What the run did with one schema.
 *
 * - `written` / `unchanged` — the `build` outcomes when the run wrote.
 * - `would-write` — `check` mode: a build would touch the file.
 * - `drift` — the drift policy refused it (and, under `onDrift: "error"`,
 *   held everything else).
 * - `held` — the run wrote nothing because ANOTHER schema failed its gate
 *   or drifted under `onDrift: "error"`; this one was clean and would
 *   otherwise have been written. Reported by both modes: `check` reports
 *   what `build` would do, so it holds the same schemas a build holds.
 * - `gate-failed` — a lint warning or engine finding blocked it.
 *
 * @public
 */
export type SchemaOutcome = "written" | "unchanged" | "would-write" | "drift" | "held" | "gate-failed";

/**
 * One schema's line in the {@link RunReport}.
 *
 * @public
 */
export class SchemaReport extends Schema.Class<SchemaReport>("SchemaReport")({
	$id: Schema.String,
	path: Schema.String,
	/** The schema's key in the config. */
	name: Schema.String,
	version: Schema.optionalKey(SchemaVersion),
	published: Schema.Boolean,
	/** What differs between the on-disk document and the generated one. */
	change: Schema.Literals(["none", "annotations", "contract", "created"]),
	/** The drift policy's verdict; a written schema under `onDrift: "warn"` keeps `"drift"`. */
	verdict: Schema.Literals(["write", "drift"]),
	/** The tolerance actually applied: this schema's own, or a flag's override over every schema. */
	policy: Schema.Literals(["strict", "semantic", "allow"]),
	outcome: Schema.Literals(["written", "unchanged", "would-write", "drift", "held", "gate-failed"]),
	/** The label to publish under instead — set only for a `contract` change on a pinned (non-prerelease) versioned schema. */
	nextVersion: Schema.optionalKey(SchemaVersion),
	/** Every OTHER advertised version this schema's frozen check verified. */
	frozen: Schema.Array(SchemaVersion),
	/** Every finding, blocking or not. */
	findings: Schema.Array(PipelineFinding),
	/** Present when `change` is not `none`. The report always carries it whole; a summary caps what it shows. */
	diff: Schema.optionalKey(DocumentDiff),
}) {}

/**
 * This config's own catalog slice, `<catalogDir>/<name>.json`: a bare
 * SchemaStore catalog entry array holding every entry the config declares,
 * rewritten wholesale — so a removed schema's entry drops out.
 *
 * @public
 */
export class CatalogSliceReport extends Schema.Class<CatalogSliceReport>("CatalogSliceReport")({
	/** The slice file: `<catalogDir>/<name>.json`. */
	path: Schema.String,
	/** How many entries the slice holds; `0` for an orphan. */
	entries: Schema.Number,
	/**
	 * `held` mirrors {@link SchemaOutcome}: the run refused every write.
	 * `orphaned`: no schema declares a catalog but the slice exists — stale
	 * under `check`, reported and left in place under `build` (the tool may
	 * not have written it).
	 */
	outcome: Schema.Literals(["written", "unchanged", "would-write", "held", "orphaned"]),
	/**
	 * Present when no file matched `<name>.json` exactly and the volume
	 * resolved that exact path to the one listed file whose name matches it
	 * case-insensitively (a leftover `docs.json` for a config named `Docs`
	 * on a case-insensitive volume) — the on-disk path it claimed. Never set
	 * on a case-sensitive volume, where that file is another slice. On a
	 * case-insensitive volume two configs whose names differ only in case
	 * share, and overwrite, that one file.
	 */
	caseFoldedMatch: Schema.optionalKey(Schema.String),
}) {}

/**
 * One catalog URL or display name advertised more than once across the
 * slices, discriminated by `kind`. The merged catalog refuses to pick a
 * winner: for a URL, which entry a host serves would depend on which config
 * built last; for a name, an editor or SchemaStore would show two entries
 * it cannot tell apart. A name is compared over the entries the merge
 * advertises — an entry that already lost its URL to another slice is
 * reported once, as the URL conflict.
 *
 * @public
 */
export const CatalogConflict = Schema.Union([
	Schema.Struct({
		kind: Schema.Literal("url"),
		/** The entry `url` claimed more than once. */
		url: Schema.String,
		/** Every slice file advertising it, sorted; a slice listed twice declares it twice itself. */
		slices: Schema.Array(Schema.String),
	}),
	Schema.Struct({
		kind: Schema.Literal("name"),
		/** The entry `name` claimed more than once. */
		name: Schema.String,
		/** Every slice file advertising it, sorted; a slice listed twice declares it twice itself. */
		slices: Schema.Array(Schema.String),
	}),
]);

/**
 * The type of a {@link (CatalogConflict:variable)}.
 *
 * @public
 */
export type CatalogConflict = typeof CatalogConflict.Type;

/**
 * One slice the merge could not use, and why: `unreadable: <reason>` (a
 * dangling symlink, a permission failure), `not JSON`, or the decode issue
 * itself — `Expected array` for a document that is not an array,
 * `Expected no excess property at [0]["extra"]` for an entry carrying a key
 * a catalog entry does not declare — one semicolon-separated clause per issue.
 *
 * @public
 */
export class InvalidSlice extends Schema.Class<InvalidSlice>("InvalidSlice")({
	/** The slice file. */
	path: Schema.String,
	/** Why it cannot be merged. */
	reason: Schema.String,
}) {}

/**
 * The merged catalog, `catalog.json` in `catalogDir`'s parent: every slice
 * in `catalogDir` united and sorted by entry `url`, with the running
 * config's slice replaced by the entries it computes now when it declares
 * any — so `check` compares against what a build would produce. A config
 * that declares none merges its orphaned slice as it sits on disk, as every
 * other config sees it, so whichever config sharing the directory builds
 * last writes the identical file.
 *
 * @public
 */
export class MergedCatalogReport extends Schema.Class<MergedCatalogReport>("MergedCatalogReport")({
	/** The merged file: `catalog.json` in `catalogDir`'s parent. */
	path: Schema.String,
	/** How many entries the merged file holds (or would hold); `0` for an orphan. */
	entries: Schema.Number,
	/**
	 * `written`/`unchanged`/`would-write`/`held` as for the slice.
	 * `orphaned`: no slice remains but the merged file exists — stale under
	 * `check`, left in place under `build`. `blocked`: a URL or name conflict or an
	 * invalid slice leaves no merged catalog to trust, so none is written
	 * (both modes fail).
	 */
	outcome: Schema.Literals(["written", "unchanged", "would-write", "held", "orphaned", "blocked"]),
	/** Every slice file the merge reads — the running config's own included when it declares entries — sorted. */
	slices: Schema.Array(Schema.String),
	/**
	 * Every URL, then every name, advertised more than once; each kind
	 * sorted by its value in code-unit order; empty when none.
	 */
	conflicts: Schema.Array(CatalogConflict),
	/**
	 * Every OTHER slice file that cannot be read (a dangling symlink, a
	 * permission failure), is not JSON, or is not a catalog entry array —
	 * one carrying a key a catalog entry does not declare included — sorted;
	 * empty when none. A slice that vanished between listing and reading is
	 * skipped, not listed.
	 */
	invalid: Schema.Array(InvalidSlice),
}) {}

/**
 * The catalog's line in the {@link RunReport}: this config's slice and the
 * merged catalog, each present only when there is something to report.
 *
 * @public
 */
export class CatalogReport extends Schema.Class<CatalogReport>("CatalogReport")({
	/** Present when the config declares a catalog entry, or declares none but its slice exists (`orphaned`). */
	slice: Schema.optionalKey(CatalogSliceReport),
	/** Present when any slice contributes, or none does but the merged file exists (`orphaned`). */
	merged: Schema.optionalKey(MergedCatalogReport),
}) {}

// The published JSON document, as a plain shape over the classes' own encoded
// fields. It differs from the classes in three ways: drift settings nest under
// `drift`, and an empty `frozen`, `conflicts` or `invalid` is left out.
const JsonSchemaReport = Schema.toEncoded(
	Schema.Struct({ ...SchemaReport.fields, frozen: Schema.optionalKey(SchemaReport.fields.frozen) }),
);
const JsonMergedReport = Schema.toEncoded(
	Schema.Struct({
		...MergedCatalogReport.fields,
		conflicts: Schema.optionalKey(MergedCatalogReport.fields.conflicts),
		invalid: Schema.optionalKey(MergedCatalogReport.fields.invalid),
	}),
);
const JsonDocument = Schema.Struct({
	mode: Schema.Literals(["build", "check"]),
	configPath: Schema.String,
	drift: Schema.Struct({
		onDrift: Schema.Literals(["error", "warn"]),
		policy: Schema.optionalKey(Schema.Literals(["strict", "semantic", "allow"])),
	}),
	schemas: Schema.Array(JsonSchemaReport),
	catalog: Schema.optionalKey(
		Schema.Struct({
			slice: Schema.optionalKey(Schema.toEncoded(CatalogSliceReport)),
			merged: Schema.optionalKey(JsonMergedReport),
		}),
	),
	orphaned: Schema.optionalKey(Schema.Array(Schema.String)),
	drifted: Schema.Boolean,
	gateFailed: Schema.Boolean,
	wrote: Schema.Boolean,
});

const fromJsonDocument = (doc: typeof JsonDocument.Type): typeof RunReport.Encoded => {
	const { drift, schemas, catalog, ...rest } = doc;
	return {
		...rest,
		onDrift: drift.onDrift,
		...(drift.policy !== undefined ? { policy: drift.policy } : {}),
		schemas: schemas.map((schema) => ({ ...schema, frozen: schema.frozen ?? [] })),
		...(catalog !== undefined
			? {
					catalog: {
						...(catalog.slice !== undefined ? { slice: catalog.slice } : {}),
						...(catalog.merged !== undefined
							? {
									merged: {
										...catalog.merged,
										conflicts: catalog.merged.conflicts ?? [],
										invalid: catalog.merged.invalid ?? [],
									},
								}
							: {}),
					},
				}
			: {}),
	};
};

const toJsonDocument = (report: typeof RunReport.Encoded): typeof JsonDocument.Type => {
	const { onDrift, policy, schemas, catalog, ...rest } = report;
	return {
		...rest,
		drift: { onDrift, ...(policy !== undefined ? { policy } : {}) },
		schemas: schemas.map(({ frozen, ...schema }) => ({
			...schema,
			...(frozen.length > 0 ? { frozen } : {}),
		})),
		...(catalog !== undefined
			? {
					catalog: {
						...(catalog.slice !== undefined ? { slice: catalog.slice } : {}),
						...(catalog.merged !== undefined
							? {
									merged: (({ conflicts, invalid, ...merged }) => ({
										...merged,
										...(conflicts.length > 0 ? { conflicts } : {}),
										...(invalid.length > 0 ? { invalid } : {}),
									}))(catalog.merged),
								}
							: {}),
					},
				}
			: {}),
	};
};

/**
 * The whole run, as a value: the renderers and the exit-code mapping read
 * this and nothing else.
 *
 * @public
 */
export class RunReport extends Schema.Class<RunReport>("RunReport")({
	mode: Schema.Literals(["build", "check"]),
	configPath: Schema.String,
	onDrift: Schema.Literals(["error", "warn"]),
	policy: Schema.optionalKey(Schema.Literals(["strict", "semantic", "allow"])),
	/** One per config schema, in config order. */
	schemas: Schema.Array(SchemaReport),
	/** Absent when there is neither a slice nor a merged catalog to report. */
	catalog: Schema.optionalKey(CatalogReport),
	/**
	 * Every document sitting at a sibling shape of a path the config derives
	 * — the file an `appendVersion` flip or a `layout` change left behind
	 * under the old derived name — that no target, frozen version, catalog
	 * slice, or the merged catalog claims. `check` counts them stale; `build`
	 * reports and never deletes them (the tool may not have written them).
	 * Absent when none. In config order: schema by schema, the unversioned
	 * shape first, then each label's three other shapes.
	 */
	orphaned: Schema.optionalKey(Schema.Array(Schema.String)),
	/** At least one schema's verdict is `"drift"`. */
	drifted: Schema.Boolean,
	/** At least one schema failed its gate. */
	gateFailed: Schema.Boolean,
	/** At least one file was written. */
	wrote: Schema.Boolean,
}) {
	/**
	 * The report as the CLI's `--format=json` document: `onDrift` and `policy`
	 * nest under `drift`, and an empty `frozen`, `conflicts` or `invalid` is left
	 * out. Decoding it gives back the same report, so a consumer of the CLI's
	 * stdout reads the class the MCP result encodes.
	 */
	static readonly Json: Schema.Codec<RunReport, unknown> = JsonDocument.pipe(
		Schema.decodeTo(RunReport, SchemaTransformation.transform({ decode: fromJsonDocument, encode: toJsonDocument })),
	);
}
