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
const schemaLines = (schema: SchemaReport, report: RunReport): ReadonlyArray<string> => {
	switch (schema.outcome) {
		case "written":
			return [`written (${schema.change}) ${schema.path}`];
		case "unchanged":
			return [`unchanged ${schema.path}`];
		case "would-write":
			return [`would write (${schema.change}) ${schema.path}`];
		case "drift":
			return [`DRIFT ${schema.change}${publishedClause(schema)}${suggestionClause(schema)} — ${schema.path}`];
		case "held":
			return [`held (${report.gateFailed ? "gate failed elsewhere" : "drift elsewhere"}) ${schema.path}`];
		case "gate-failed":
			return [
				`GATE FAILED ${schema.path} (${blockingCount(schema.findings)} blocking finding(s))`,
				...schema.findings.map(findingLine),
			];
		default:
			return schema.outcome satisfies never;
	}
};

const catalogLine = (entry: CatalogReport): string => {
	switch (entry.outcome) {
		case "written":
			return `written catalog ${entry.path}`;
		case "unchanged":
			return `unchanged catalog ${entry.path}`;
		case "would-write":
			return `would write catalog ${entry.path}`;
		case "held":
			return `held catalog ${entry.path}`;
		default:
			return entry.outcome satisfies never;
	}
};

const summaryLine = (report: RunReport): string => {
	const written = report.schemas.filter((schema) => schema.outcome === "written").length;
	const unchanged = report.schemas.filter((schema) => schema.outcome === "unchanged").length;
	const drift = report.schemas.filter((schema) => schema.verdict === "drift").length;
	const gateFailed = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
	return (
		`${report.schemas.length} schema(s): ${written} written, ${unchanged} unchanged, ${drift} drift, ` +
		`${gateFailed} gate failed — drift policy ${report.drift.policy}/${report.drift.onDrift} (${report.drift.source})`
	);
};

const warningLine = (schema: SchemaReport): string =>
	`warning: DRIFT ${schema.change}${publishedClause(schema)} written under --on-drift=warn — ${schema.path}`;

const tableRow = (columns: ReadonlyArray<string>): string => `| ${columns.join(" | ")} |`;

/**
 * Renders a {@link RunReport} for a terminal, a JSON consumer or a GitHub
 * step summary.
 *
 * @public
 */
export class Report {
	private constructor() {}

	/** stdout lines. */
	static human(report: RunReport): ReadonlyArray<string> {
		const lines: Array<string> = [];
		for (const schema of report.schemas) {
			lines.push(...schemaLines(schema, report));
		}
		for (const entry of report.catalog) {
			lines.push(catalogLine(entry));
		}
		lines.push(summaryLine(report));
		return lines;
	}

	/** stderr lines: one per drift written under `onDrift: "warn"`. */
	static warnings(report: RunReport): ReadonlyArray<string> {
		if (report.drift.onDrift !== "warn") {
			return [];
		}
		return report.schemas.filter((schema) => schema.verdict === "drift").map(warningLine);
	}

	/** One JSON document, stable key order. */
	static json(report: RunReport): string {
		const doc = {
			mode: report.mode,
			configPath: report.configPath,
			drift: { policy: report.drift.policy, onDrift: report.drift.onDrift, source: report.drift.source },
			schemas: report.schemas.map((schema) => ({
				$id: schema.$id,
				path: schema.path,
				...(schema.name !== undefined ? { name: schema.name } : {}),
				...(schema.version !== undefined ? { version: schema.version } : {}),
				published: schema.published,
				change: schema.change,
				verdict: schema.verdict,
				outcome: schema.outcome,
				...(schema.nextVersion !== undefined ? { nextVersion: schema.nextVersion } : {}),
				findings: schema.findings.map((finding) => ({
					source: finding.source,
					severity: finding.severity,
					...(finding.check !== undefined ? { check: finding.check } : {}),
					path: finding.path,
					message: finding.message,
				})),
			})),
			catalog: report.catalog.map((entry) => ({ name: entry.name, path: entry.path, outcome: entry.outcome })),
			drifted: report.drifted,
			gateFailed: report.gateFailed,
			wrote: report.wrote,
		};
		return JSON.stringify(doc, null, "\t");
	}

	/** The step-summary table. */
	static markdown(report: RunReport): string {
		const lines: Array<string> = [`### schemastore ${report.mode}`, ""];
		lines.push(
			tableRow(["schema", "version", "published", "change", "outcome"]),
			tableRow(["---", "---", "---", "---", "---"]),
		);
		for (const schema of report.schemas) {
			lines.push(
				tableRow([
					schema.name ?? schema.$id,
					schema.version ?? "",
					schema.published ? "yes" : "no",
					schema.change,
					schema.outcome,
				]),
			);
		}
		if (report.catalog.length > 0) {
			lines.push("", tableRow(["catalog", "outcome"]), tableRow(["---", "---"]));
			for (const entry of report.catalog) {
				lines.push(tableRow([entry.name, entry.outcome]));
			}
		}
		lines.push("");
		if (report.gateFailed) {
			const failed = report.schemas.filter((schema) => schema.outcome === "gate-failed").length;
			lines.push(`**Gate:** ${failed} schema(s) failed`);
		} else if (report.drifted) {
			const drifted = report.schemas.filter((schema) => schema.verdict === "drift").length;
			lines.push(`**Drift:** ${drifted} schema(s) drifted under ${report.drift.policy}/${report.drift.onDrift}`);
		} else {
			lines.push("**Drift:** none");
		}
		return lines.join("\n");
	}
}
