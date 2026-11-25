/**
 * The growth checks nearest their bounds, as a table (#1415).
 *
 * @remarks
 * A growth check passes or fails, and a pass says nothing of its margin. The margin differs by machine: one check
 * read 4.2x on macOS and 11.9x on a Linux runner, against a bound of 10. With `EFFECTED_GROWTH_REPORT` naming a
 * file, `Growth` in `@effected/testing` appends every measurement to it, and this prints the rows worth reading:
 * one per call site and sizing, with its worst ratio, nearest its bound first. A check over about 70% of its bound
 * on the runner is the next one to fail; measure it at a smaller size, where the work is the same and the memory
 * it holds is not yet the cost.
 *
 * Run as a script it reads the file named and prints the table: `tsx lib/scripts/growth-report.ts <file>`. A file
 * that is not there prints the empty report, so the step that runs this never fails a job the tests passed.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Where `@effected/testing`'s own tests of `Growth` live. */
const KIT_CONTROLS = "testing/__test__/";

interface Measurement {
	readonly site: string;
	readonly from: number;
	readonly factor: number;
	readonly bound: number;
	readonly ratio: number;
	readonly smallMs: number;
	readonly largeMs: number;
}

interface Check {
	readonly worst: Measurement;
	readonly runs: number;
}

/** The table for the report file's text, showing the `top` checks nearest their bounds. */
export const summarize = (text: string, top = 20): string => {
	const measurements = text
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as Measurement)
		// The kit's own controls measure work that crosses its bound on purpose, to prove the runner can tell.
		.filter((measurement) => !measurement.site.startsWith(KIT_CONTROLS));
	if (measurements.length === 0) return "### Growth checks\n\nNo growth measurements were recorded.\n";
	const checks = new Map<string, Check>();
	for (const measurement of measurements) {
		const key = `${measurement.site}\n${measurement.from}\n${measurement.factor}\n${measurement.bound}`;
		const seen = checks.get(key);
		checks.set(key, {
			worst: seen === undefined || measurement.ratio > seen.worst.ratio ? measurement : seen.worst,
			runs: (seen?.runs ?? 0) + 1,
		});
	}
	const nearest = [...checks.values()]
		.sort((a, b) => b.worst.ratio / b.worst.bound - a.worst.ratio / a.worst.bound)
		.slice(0, top);
	const rows = nearest.map(({ worst, runs }) =>
		[
			`${Math.round((worst.ratio / worst.bound) * 100)}%`,
			`${worst.ratio.toFixed(2)}x`,
			String(worst.bound),
			`${worst.from} x${worst.factor}`,
			`${worst.smallMs.toFixed(3)} -> ${worst.largeMs.toFixed(3)} ms`,
			String(runs),
			worst.site,
		].join(" | "),
	);
	return [
		"### Growth checks nearest their bounds",
		"",
		`${measurements.length} measurements across ${checks.size} checks. A row is one call site and sizing, with its worst ratio.`,
		"",
		"| Of bound | Worst ratio | Bound | Sizes | Time | Runs | Where |",
		"| --- | --- | --- | --- | --- | --- | --- |",
		...rows.map((row) => `| ${row} |`),
		"",
	].join("\n");
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
	const file = process.argv[2];
	process.stdout.write(summarize(file !== undefined && existsSync(file) ? readFileSync(file, "utf8") : ""));
}
