// Pure string building over a `RunReport` — no IO, no Effect. `StepSummary`
// owns the one effectful sink (`GITHUB_STEP_SUMMARY`); everything here is a
// total function of the report value.

import type { PipelineFinding } from "@effected/schemastore";
import { Schema } from "effect";
import type {
	CatalogConflict,
	CatalogReport,
	CatalogSliceReport,
	DocumentDiff,
	MergedCatalogReport,
	SchemaReport,
} from "./RunReport.js";
import { RunReport } from "./RunReport.js";
import { VersionMismatch } from "./VersionCheck.js";

const findingLine = (finding: PipelineFinding): string => `  ${finding.label} at "${finding.path}": ${finding.message}`;

// `defaultBlocking` in `SchemaPipeline` is `severity === "warning"`, and the
// Runner never overrides it — the tool owns no other blocking rule, so the
// reported count mirrors that same test.
const blockingCount = (findings: SchemaReport["findings"]): number =>
	findings.filter((finding) => finding.severity === "warning").length;

const suggestionClause = (schema: SchemaReport): string =>
	schema.nextVersion !== undefined && schema.nextVersion !== schema.version ? ` → suggest ${schema.nextVersion}` : "";

const publishedClause = (schema: SchemaReport): string =>
	schema.version !== undefined ? ` at published ${schema.version}` : "";

// `held` collapses two report-level facts into one flavour of the line — a
// report only ever holds a schema for ONE reason, but which reason it was
// is not on the `SchemaReport` itself, so this reads `report.gateFailed`
// rather than the schema.
// A per-schema line names its own effective policy only when the report
// carries no flag-forced one — `report.policy` present means every schema
// shares it, which the summary's `driftClause` already says once.
const policyClause = (schema: SchemaReport, report: RunReport): string =>
	report.policy === undefined ? ` [policy ${schema.policy}]` : "";

const frozenClause = (schema: SchemaReport): string =>
	schema.frozen.length > 0 ? ` (frozen: ${schema.frozen.join(", ")})` : "";

const schemaLines = (schema: SchemaReport, report: RunReport): ReadonlyArray<string> => {
	const suffix = `${policyClause(schema, report)}${frozenClause(schema)}`;
	switch (schema.outcome) {
		case "written":
			return [`written (${schema.change}) ${schema.path}${suffix}`];
		case "unchanged":
			return [`unchanged ${schema.path}${suffix}`];
		case "would-write":
			return [`would write (${schema.change}) ${schema.path}${suffix}`];
		case "drift":
			return [`DRIFT ${schema.change}${publishedClause(schema)}${suggestionClause(schema)} — ${schema.path}${suffix}`];
		case "held":
			return [`held (${report.gateFailed ? "gate failed elsewhere" : "drift elsewhere"}) ${schema.path}${suffix}`];
		case "gate-failed":
			return [
				`GATE FAILED ${schema.path}${suffix} (${blockingCount(schema.findings)} blocking finding(s))`,
				...schema.findings.map(findingLine),
			];
		default:
			return schema.outcome satisfies never;
	}
};

// The config name a slice path carries: its base name without `.json`.
const sliceOwner = (slicePath: string): string => (slicePath.split(/[\\/]/).pop() ?? slicePath).replace(/\.json$/, "");

// A case-folded claim is never silent: the line names the file it took.
const sliceCounts = (slice: CatalogSliceReport): string =>
	slice.caseFoldedMatch !== undefined
		? `(${slice.entries} entries; claimed ${slice.caseFoldedMatch} by case-folded match for "${sliceOwner(slice.path)}")`
		: `(${slice.entries} entries)`;

const sliceLine = (slice: CatalogSliceReport): string => {
	switch (slice.outcome) {
		case "written":
			return `written catalog slice ${slice.path} ${sliceCounts(slice)}`;
		case "unchanged":
			return `unchanged catalog slice ${slice.path} ${sliceCounts(slice)}`;
		case "would-write":
			return `would write catalog slice ${slice.path} ${sliceCounts(slice)}`;
		case "held":
			return `held catalog slice ${slice.path} ${sliceCounts(slice)}`;
		case "orphaned":
			return `orphaned catalog slice ${slice.path} (no schema declares a catalog; the merged catalog keeps advertising its entries until it is deleted — delete it by hand; build never will)`;
		default:
			return slice.outcome satisfies never;
	}
};

// `url <url>` or `name <name>`: what a conflict line or table cell names.
const conflictSubject = (conflict: CatalogConflict): string =>
	conflict.kind === "url" ? `url ${conflict.url}` : `name ${conflict.name}`;

const mergedLines = (merged: MergedCatalogReport): ReadonlyArray<string> => {
	const counts = `(${merged.entries} entries from ${merged.slices.length} slice(s))`;
	switch (merged.outcome) {
		case "written":
			return [`written catalog ${merged.path} ${counts}`];
		case "unchanged":
			return [`unchanged catalog ${merged.path} ${counts}`];
		case "would-write":
			return [`would write catalog ${merged.path} ${counts}`];
		case "held":
			return [`held catalog ${merged.path} ${counts}`];
		case "orphaned":
			return [`orphaned catalog ${merged.path} (no catalog slice remains — delete it by hand; build never will)`];
		case "blocked":
			return [
				`CATALOG BLOCKED ${merged.path} (not written: fix the slices below)`,
				...merged.conflicts.map(
					(conflict) => `  ${conflictSubject(conflict)} advertised by ${conflict.slices.join(", ")}`,
				),
				...merged.invalid.map(({ path, reason }) => `  slice ${path} is invalid: ${reason}`),
			];
		default:
			return merged.outcome satisfies never;
	}
};

const catalogLines = (catalog: CatalogReport): ReadonlyArray<string> => [
	...(catalog.slice !== undefined ? [sliceLine(catalog.slice)] : []),
	...(catalog.merged !== undefined ? mergedLines(catalog.merged) : []),
];

// An orphaned document's remedy is its own: `build` never deletes it, so the
// line says what to do rather than letting the summary's build-prescription
// mislead.
const orphanedLine = (orphan: string): string =>
	`orphaned document ${orphan} (no target, frozen version, or catalog entry claims it — delete it by hand; build never will)`;

// A flag-forced policy overrides every schema's own for this run; absent one,
// drift is classified per schema under its own tolerance. This renders from
// `policy`'s presence.
const driftClause = (report: RunReport): string =>
	`drift ${report.policy !== undefined ? `${report.policy} (flag)` : "per schema (config)"}, on-drift ${report.onDrift}`;

const summaryLine = (report: RunReport): string => {
	const written = report.schemas.filter((schema) => schema.outcome === "written").length;
	const unchanged = report.schemas.filter((schema) => schema.outcome === "unchanged").length;
	const drift = report.schemas.filter((schema) => schema.verdict === "drift").length;
	const gateFailed = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
	return (
		`${report.schemas.length} schema(s): ${written} written, ${unchanged} unchanged, ${drift} drift, ` +
		`${gateFailed} gate failed — ${driftClause(report)}`
	);
};

// `check` writes nothing, so its warn-mode line says what a build would do.
const warningLine = (schema: SchemaReport, report: RunReport): string =>
	`warning: DRIFT ${schema.change}${publishedClause(schema)} ${report.mode === "build" ? "written" : "would write"} under --on-drift=warn — ${schema.path}`;

// Cells carry untrusted text (a slice's key names, a path), so a `\` is
// escaped FIRST, then a `|`, and a line break folded to a space: none can
// add a column or end the row. Backslashes go first, or an input `\|` would
// render as an escaped backslash followed by a live pipe.
const tableCell = (cell: string): string => cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const tableRow = (columns: ReadonlyArray<string>): string => `| ${columns.map(tableCell).join(" | ")} |`;

// How much of one document's diff a step summary shows. A summary is read in a
// browser and GitHub caps its size, while the report keeps the whole diff.
const STEP_SUMMARY_DIFF_LINES = 200;

// A fence longer than any backtick run in the text, because a schema's
// description can hold a code fence that would otherwise close this one.
const fenceFor = (lines: ReadonlyArray<string>): string => {
	const longest = Math.max(0, ...lines.flatMap((line) => (line.match(/`+/g) ?? []).map((run) => run.length)));
	return "`".repeat(Math.max(3, longest + 1));
};

const diffBlock = (schema: SchemaReport, diff: DocumentDiff): ReadonlyArray<string> => {
	const lines = diff.unified.replace(/\n$/, "").split("\n");
	const shown = lines.slice(0, STEP_SUMMARY_DIFF_LINES);
	const fence = fenceFor(shown);
	return [
		"",
		`**${schema.name}** ${schema.path}`,
		"",
		`${fence}diff`,
		...shown,
		fence,
		...(lines.length > shown.length ? ["", `… ${lines.length - shown.length} more lines`] : []),
	];
};

/**
 * Renders a {@link RunReport} for a terminal, a JSON consumer or a GitHub
 * step summary.
 *
 * @public
 */
export class Report {
	private constructor() {}

	/**
	 * stdout lines.
	 *
	 * @remarks
	 * The summary's `drift` count is the number of schemas whose VERDICT is
	 * `"drift"`, independent of `written`/`unchanged`: under
	 * `onDrift: "warn"` a drifting schema is written AND counted as drift,
	 * so the four counts need not sum to the schema total.
	 */
	static human(report: RunReport): ReadonlyArray<string> {
		const lines: Array<string> = [];
		for (const schema of report.schemas) {
			lines.push(...schemaLines(schema, report));
		}
		if (report.catalog !== undefined) {
			lines.push(...catalogLines(report.catalog));
		}
		for (const orphan of report.orphaned ?? []) {
			lines.push(orphanedLine(orphan));
		}
		lines.push(summaryLine(report));
		return lines;
	}

	/**
	 * stderr lines: one per drift written (or, under `check`, would be written)
	 * under `onDrift: "warn"`. Empty when the gate failed — nothing was (or
	 * would be) written, so there is no drift to warn about.
	 */
	static warnings(report: RunReport): ReadonlyArray<string> {
		if (report.onDrift !== "warn" || report.gateFailed) {
			return [];
		}
		return report.schemas.filter((schema) => schema.verdict === "drift").map((schema) => warningLine(schema, report));
	}

	/**
	 * One JSON document, stable key order: {@link RunReport.Json}'s encoding.
	 *
	 * @remarks
	 * A version mismatch the run went on past is not part of the report, so it is
	 * passed beside it and comes last, where `ValidateReport.Json` has it: an agent
	 * reading only stdout must see it. Without one the document is unchanged.
	 */
	static json(report: RunReport, versionMismatch?: VersionMismatch): string {
		const encoded = Schema.encodeSync(RunReport.Json)(report);
		return JSON.stringify(
			versionMismatch === undefined
				? encoded
				: { ...(encoded as object), versionMismatch: Schema.encodeSync(VersionMismatch)(versionMismatch) },
			null,
			"\t",
		);
	}

	/**
	 * The step-summary tables, then one fenced `diff` block per changed document,
	 * each capped; ends with a newline so a later append starts on its own line.
	 */
	static markdown(report: RunReport): string {
		const lines: Array<string> = [`### effected schema ${report.mode}`, ""];
		lines.push(
			tableRow(["schema", "version", "frozen", "published", "change", "outcome"]),
			tableRow(["---", "---", "---", "---", "---", "---"]),
		);
		for (const schema of report.schemas) {
			lines.push(
				tableRow([
					schema.name,
					schema.version ?? "",
					schema.frozen.join(", "),
					schema.published ? "yes" : "no",
					schema.change,
					schema.outcome,
				]),
			);
		}
		if (report.catalog !== undefined) {
			const { slice, merged } = report.catalog;
			lines.push(
				"",
				tableRow(["catalog", "file", "entries", "outcome"]),
				tableRow(["---", "---", "---", "---"]),
				...(slice !== undefined
					? [
							tableRow([
								"slice",
								slice.path,
								String(slice.entries),
								slice.caseFoldedMatch !== undefined
									? `${slice.outcome} (case-folded match: ${slice.caseFoldedMatch})`
									: slice.outcome,
							]),
						]
					: []),
				...(merged !== undefined ? [tableRow(["merged", merged.path, String(merged.entries), merged.outcome])] : []),
			);
			if (merged !== undefined && (merged.conflicts.length > 0 || merged.invalid.length > 0)) {
				lines.push(
					"",
					tableRow(["catalog problem", "slices"]),
					tableRow(["---", "---"]),
					...merged.conflicts.map((conflict) => tableRow([conflictSubject(conflict), conflict.slices.join(", ")])),
					...merged.invalid.map(({ path, reason }) => tableRow([`invalid: ${reason}`, path])),
				);
			}
		}
		if (report.orphaned !== undefined) {
			lines.push(
				"",
				tableRow(["orphaned document", "claimed by"]),
				tableRow(["---", "---"]),
				...report.orphaned.map((orphan) => tableRow([orphan, "nothing — delete by hand"])),
			);
		}
		lines.push("");
		if (report.gateFailed) {
			const failed = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
			lines.push(`**Gate:** ${failed} schema(s) failed`);
		} else if (report.drifted) {
			const drifted = report.schemas.filter((schema) => schema.verdict === "drift").length;
			lines.push(`**Drift:** ${drifted} schema(s) drifted — ${driftClause(report)}`);
		} else {
			lines.push("**Drift:** none");
		}
		for (const schema of report.schemas) {
			if (schema.diff !== undefined) {
				lines.push(...diffBlock(schema, schema.diff));
			}
		}
		lines.push("");
		return lines.join("\n");
	}
}
