import type { BuildReport } from "./schema.js";

const esc = (s: string): string => s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/**
 * Render a build report as GitHub Actions workflow-command annotations, one `::error` or `::warning`
 * line per diagnostic. Suppressed diagnostics are never annotated. Pure.
 *
 * @public
 */
export function renderCiAnnotations(report: BuildReport): ReadonlyArray<string> {
	const lines: Array<string> = [];
	for (const g of report.targetGroups) {
		for (const e of g.errors) {
			const loc = e.file !== undefined ? ` file=${esc(e.file)}${e.line !== undefined ? `,line=${e.line}` : ""}` : "";
			lines.push(`::error title=${esc(report.package)} (${esc(g.id)})${loc}::${esc(e.text)}`);
		}
		for (const w of g.warnings) {
			const loc = w.file !== undefined ? ` file=${esc(w.file)}${w.line !== undefined ? `,line=${w.line}` : ""}` : "";
			lines.push(`::warning title=${esc(report.package)} (${esc(g.id)})${loc}::${esc(w.text)}`);
		}
	}
	return lines;
}
