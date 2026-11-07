import type { BlockOf, InlineInput } from "@effected/cli-kit";
import { Doc } from "@effected/cli-kit";
import type { BuildIssues } from "@effected/engine/build";

type Diagnostic = BuildIssues["errors"][number];

/** `file:line:col code text`, leaving out whichever parts the diagnostic does not have. */
const lineOf = (diagnostic: Diagnostic): string => {
	const location =
		diagnostic.file === undefined
			? []
			: [[diagnostic.file, diagnostic.line, diagnostic.column].filter((part) => part !== undefined).join(":")];
	return [...location, ...(diagnostic.code !== undefined ? [diagnostic.code] : []), diagnostic.text].join(" ");
};

const summaryOf = (issues: BuildIssues): string =>
	`built ${issues.package}: ${issues.errors.length} errors, ${issues.warnings.length} warnings, ${issues.suppressed.length} suppressed`;

const summaryToken = (issues: BuildIssues): "error" | "warning" | "success" =>
	!issues.buildOk || issues.errors.length > 0 ? "error" : issues.warnings.length > 0 ? "warning" : "success";

// A fence longer than any backtick run in the text, because a diagnostic can quote one.
const fenceFor = (text: string): string => {
	const longest = (text.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 2);
	return "`".repeat(longest + 1);
};

/**
 * A build's `issues.json` for a reader: errors, then warnings, then one summary line. Suppressed diagnostics are only
 * counted.
 *
 * @public
 */
export class IssuesDoc {
	private constructor() {}

	/** The report as plain lines, the summary last, for a log. */
	static lines(issues: BuildIssues): ReadonlyArray<string> {
		return [...issues.errors.map(lineOf), ...issues.warnings.map(lineOf), summaryOf(issues)];
	}

	/**
	 * The report as a `Doc`.
	 *
	 * @remarks
	 * Every line goes in as a `Doc.text` run, which is data: the renderers remove escape and control characters from it,
	 * so a diagnostic quoting untrusted text cannot repaint the terminal.
	 */
	static render(issues: BuildIssues): BlockOf<"Lines"> {
		const rows: Array<InlineInput> = [
			...issues.errors.map((diagnostic) => Doc.text(lineOf(diagnostic), "error")),
			...issues.warnings.map((diagnostic) => Doc.text(lineOf(diagnostic), "warning")),
			Doc.text(summaryOf(issues), summaryToken(issues)),
		];
		return Doc.lines(rows, { wrap: false });
	}

	/** The report for a GitHub step summary: the failure, when there is one, and the diagnostics in a code block. */
	static markdown(issues: BuildIssues): string {
		const diagnostics = [...issues.errors, ...issues.warnings].map(lineOf).join("\n");
		const fence = fenceFor(diagnostics);
		return [
			"### effected package build",
			"",
			summaryOf(issues),
			...(issues.failure !== undefined ? ["", `Failed: ${issues.failure.message}`] : []),
			...(diagnostics !== "" ? ["", fence, diagnostics, fence] : []),
			"",
		].join("\n");
	}
}
