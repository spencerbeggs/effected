import type { BlockOf, InlineInput } from "@effected/cli-kit";
import { Doc } from "@effected/cli-kit";
import type { ActionInitResult } from "@effected/engine/build";

/** What is left to do, as lines: the packages to add, the module type, and the build. */
const nextSteps = (result: ActionInitResult): ReadonlyArray<string> => [
	...(result.missingDependencies.length > 0 ? [`add dependencies: ${result.missingDependencies.join(" ")}`] : []),
	...(result.missingDevDependencies.length > 0
		? [`add devDependencies: ${result.missingDevDependencies.join(" ")}`]
		: []),
	...(result.typeModule ? [] : ['set "type": "module" in package.json']),
	"then run: effected action build",
];

const fileLine = (result: ActionInitResult, file: string): string =>
	`${result.overwritten.includes(file) ? "replaced" : "wrote"} ${file}`;

/**
 * An `action init` for a reader: a line per file written, then what is left to do.
 *
 * @public
 */
export class InitDoc {
	private constructor() {}

	/** The report as plain lines, for a log. */
	static lines(result: ActionInitResult): ReadonlyArray<string> {
		return [...result.written.map((file) => fileLine(result, file)), ...nextSteps(result)];
	}

	/**
	 * The report as a `Doc`.
	 *
	 * @remarks
	 * Every line goes in as a `Doc.text` run, which is data, so a name echoed back cannot repaint the terminal.
	 */
	static render(result: ActionInitResult): BlockOf<"Lines"> {
		const rows: Array<InlineInput> = [
			...result.written.map((file) =>
				Doc.text(fileLine(result, file), result.overwritten.includes(file) ? "warning" : "success"),
			),
			...nextSteps(result).map((line) => Doc.text(line, "muted")),
		];
		return Doc.lines(rows, { wrap: false });
	}
}
