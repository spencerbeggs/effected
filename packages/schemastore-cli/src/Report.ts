// Pure string building over a `RunReport` — no IO, no Effect. `StepSummary`
// owns the one effectful sink (`GITHUB_STEP_SUMMARY`); everything here is a
// total function of the report value.

import type { PipelineFinding } from "@effected/schemastore";
import type { CatalogReport, RunReport, SchemaReport } from "./Runner.js";

const findingLine = (finding: PipelineFinding): string => `  ${finding.label} at "${finding.path}": ${finding.message}`;

// `defaultBlocking` in `SchemaPipeline` is `severity === "warning"`, and the
// Runner never overrides it — the CLI owns no other blocking rule, so the
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

const catalogLine = (entry: CatalogReport): string => {
	switch (entry.outcome) {
		case "written":
			return `written catalog ${entry.path} (${entry.entries} entries)`;
		case "unchanged":
			return `unchanged catalog ${entry.path} (${entry.entries} entries)`;
		case "would-write":
			return `would write catalog ${entry.path} (${entry.entries} entries)`;
		case "held":
			return `held catalog ${entry.path} (${entry.entries} entries)`;
		default:
			return entry.outcome satisfies never;
	}
};

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

const tableRow = (columns: ReadonlyArray<string>): string => `| ${columns.join(" | ")} |`;

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
			lines.push(catalogLine(report.catalog));
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

	/** One JSON document, stable key order. */
	static json(report: RunReport): string {
		const doc = {
			mode: report.mode,
			configPath: report.configPath,
			drift: {
				onDrift: report.onDrift,
				...(report.policy !== undefined ? { policy: report.policy } : {}),
			},
			schemas: report.schemas.map((schema) => ({
				$id: schema.$id,
				path: schema.path,
				name: schema.name,
				...(schema.version !== undefined ? { version: schema.version } : {}),
				published: schema.published,
				change: schema.change,
				verdict: schema.verdict,
				policy: schema.policy,
				outcome: schema.outcome,
				...(schema.nextVersion !== undefined ? { nextVersion: schema.nextVersion } : {}),
				...(schema.frozen.length > 0 ? { frozen: schema.frozen } : {}),
				findings: schema.findings.map((finding) => ({
					source: finding.source,
					severity: finding.severity,
					...(finding.check !== undefined ? { check: finding.check } : {}),
					path: finding.path,
					message: finding.message,
				})),
			})),
			...(report.catalog !== undefined
				? { catalog: { path: report.catalog.path, entries: report.catalog.entries, outcome: report.catalog.outcome } }
				: {}),
			drifted: report.drifted,
			gateFailed: report.gateFailed,
			wrote: report.wrote,
		};
		return JSON.stringify(doc, null, "\t");
	}

	/** The step-summary table; ends with a newline so a later append starts on its own line. */
	static markdown(report: RunReport): string {
		const lines: Array<string> = [`### schemastore ${report.mode}`, ""];
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
			lines.push(
				"",
				tableRow(["catalog", "entries", "outcome"]),
				tableRow(["---", "---", "---"]),
				tableRow([report.catalog.path, String(report.catalog.entries), report.catalog.outcome]),
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
		lines.push("");
		return lines.join("\n");
	}
}
