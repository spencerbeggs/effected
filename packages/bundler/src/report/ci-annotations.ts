import type { BuildReport } from "./schema.js";

/** Removes C0 and C1 controls and DEL, which reach stdout raw here, keeping the line breaks the escapes below map. */
const stripControls = (s: string): string =>
	Array.from(s)
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code === 0x0a || code === 0x0d || !(code < 0x20 || (code >= 0x7f && code <= 0x9f));
		})
		.join("");

/** A workflow command's message. */
const escapeData = (s: string): string =>
	stripControls(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

/** A workflow command's property value, where `:` ends the list and `,` starts the next property. */
const escapeProperty = (s: string): string => escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");

/**
 * Render a build report as GitHub Actions workflow-command annotations, one `::error` or `::warning`
 * line per diagnostic. Suppressed diagnostics are never annotated. Pure.
 *
 * @remarks
 * The text is a diagnostic's, so it is untrusted: control characters are removed, so it cannot repaint a terminal, and
 * property values have `:` and `,` escaped, so a file name cannot forge a property or end the list.
 *
 * @public
 */
export function renderCiAnnotations(report: BuildReport): ReadonlyArray<string> {
	const lines: Array<string> = [];
	for (const g of report.targetGroups) {
		for (const e of g.errors) {
			const loc =
				e.file !== undefined ? ` file=${escapeProperty(e.file)}${e.line !== undefined ? `,line=${e.line}` : ""}` : "";
			lines.push(
				`::error title=${escapeProperty(report.package)} (${escapeProperty(g.id)})${loc}::${escapeData(e.text)}`,
			);
		}
		for (const w of g.warnings) {
			const loc =
				w.file !== undefined ? ` file=${escapeProperty(w.file)}${w.line !== undefined ? `,line=${w.line}` : ""}` : "";
			lines.push(
				`::warning title=${escapeProperty(report.package)} (${escapeProperty(g.id)})${loc}::${escapeData(w.text)}`,
			);
		}
	}
	return lines;
}
