import type { BlockOf, InlineInput } from "@effected/cli-kit";
import { Doc } from "@effected/cli-kit";
import type { ActionBuildResult, BundleResult, ValidationIssue } from "@effected/engine/build";

const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const issueLine = (issue: ValidationIssue): string => `${issue.code}: ${issue.message}`;

/** One line for an entry, with only the first line of its error: a failed load's message can carry a require stack. */
const entryLine = (entry: BundleResult): string => {
	if (entry.stats === undefined) return `✗ ${(entry.error ?? "failed").split("\n")[0]}`;
	const { entry: name, size, duration, outputPath } = entry.stats;
	return `✓ ${name}: ${formatBytes(size)} (${duration}ms) → ${outputPath}`;
};

const summaryOf = ({ build }: ActionBuildResult): string =>
	`built ${build.entries.filter((entry) => entry.success).length} entries in ${build.duration}ms`;

/** A warning as its first line, indented under the entry it belongs to. */
const warningLines = (entry: BundleResult): ReadonlyArray<string> =>
	(entry.warnings ?? []).map((warning) => `  ${warning.trim().split("\n")[0]}`);

/**
 * An action build for a reader: validation's errors, its warnings, a line per entry, then the total.
 *
 * @public
 */
export class ActionDoc {
	private constructor() {}

	/** The report as plain lines, the total last, for a log. */
	static lines(result: ActionBuildResult): ReadonlyArray<string> {
		return [
			...result.validation.errors.map(issueLine),
			...result.validation.warnings.map(issueLine),
			...result.build.entries.flatMap((entry) => [entryLine(entry), ...warningLines(entry)]),
			summaryOf(result),
		];
	}

	/**
	 * The report as a `Doc`.
	 *
	 * @remarks
	 * Every line goes in as a `Doc.text` run, which is data: the renderers remove escape and control characters from it,
	 * so an error quoting untrusted text cannot repaint the terminal.
	 */
	static render(result: ActionBuildResult): BlockOf<"Lines"> {
		const rows: Array<InlineInput> = [
			...result.validation.errors.map((issue) => Doc.text(issueLine(issue), "error")),
			...result.validation.warnings.map((issue) => Doc.text(issueLine(issue), "warning")),
			...result.build.entries.flatMap((entry) => [
				Doc.text(entryLine(entry), entry.success ? "success" : "error"),
				...warningLines(entry).map((line) => Doc.text(line, "warning")),
			]),
			Doc.text(summaryOf(result), result.build.success ? "success" : "error"),
		];
		return Doc.lines(rows, { wrap: false });
	}

	/** The report for a GitHub step summary, in a code block. */
	static markdown(result: ActionBuildResult): string {
		const body = ActionDoc.lines(result).join("\n");
		const longest = (body.match(/`+/g) ?? []).reduce((length, run) => Math.max(length, run.length), 2);
		const fence = "`".repeat(longest + 1);
		return ["### effected action build", "", fence, body, fence, ""].join("\n");
	}
}
