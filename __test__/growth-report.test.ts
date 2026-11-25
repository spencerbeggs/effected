import { assert, describe, it } from "vitest";
import { summarize } from "../lib/scripts/growth-report.js";

/**
 * The table the Hostile Tests job prints of the growth checks nearest their bounds (#1415).
 *
 * @remarks
 * A growth check passes or fails, and a pass says nothing of its margin. The margin differs by machine, so a check
 * with room on a laptop can sit at its bound on a runner and fail one run in three. `Growth` appends each
 * measurement to the file `EFFECTED_GROWTH_REPORT` names, and this turns the file into the rows worth reading.
 */
const line = (record: Record<string, unknown>): string => JSON.stringify(record);
const record = (site: string, ratio: number, bound = 10, from = 1000) =>
	line({ site, from, factor: 4, bound, ratio, smallMs: 1, largeMs: ratio, rounds: 1 });

describe("summarize", () => {
	it("lists the checks nearest their bounds first", () => {
		const table = summarize(
			[record("a/__test__/a.hostile.test.ts:1", 4), record("b/__test__/b.hostile.test.ts:2", 9)].join("\n"),
		);
		const rows = table.split("\n").filter((row) => row.startsWith("| ") && row.includes("__test__"));
		assert.strictEqual(rows.length, 2);
		assert.include(rows[0], "b/__test__/b.hostile.test.ts:2");
		assert.include(rows[0], "90%");
		assert.include(rows[0], "9.00x");
		assert.include(rows[1], "40%");
	});

	it("gives a call site measured many times one row, with its worst ratio and how many times it ran", () => {
		const site = "shell/__test__/shell.hostile.test.ts:39 < shell/__test__/shell.hostile.test.ts:147";
		const table = summarize([record(site, 4.1), record(site, 7.5), record(site, 3.9)].join("\n"));
		const rows = table.split("\n").filter((row) => row.includes("shell.hostile"));
		assert.strictEqual(rows.length, 1);
		assert.include(rows[0], "7.50x");
		assert.include(rows[0], "| 3 |");
	});

	it("keeps one site apart by its sizing and its bound", () => {
		const site = "glob/__test__/glob.hostile.test.ts:358";
		const table = summarize([record(site, 5, 10, 250), record(site, 12, 32, 60)].join("\n"));
		assert.strictEqual(table.split("\n").filter((row) => row.includes("glob.hostile")).length, 2);
	});

	it("shows only as many rows as asked for, and counts everything it read", () => {
		const text = Array.from({ length: 30 }, (_, index) =>
			record(`p/__test__/p.hostile.test.ts:${index}`, 4 + index / 10),
		).join("\n");
		const table = summarize(text, 5);
		assert.strictEqual(table.split("\n").filter((row) => row.includes("p.hostile")).length, 5);
		assert.include(table, "30 measurements across 30 checks");
	});

	// The kit's controls prove a runner can tell the orders apart by measuring work that crosses its bound on purpose.
	it("leaves out the test kit's own controls", () => {
		const table = summarize(
			[
				record("testing/__test__/Growth.hostile.test.ts:65", 64, 32),
				record("glob/__test__/glob.hostile.test.ts:1", 5),
			].join("\n"),
		);
		assert.notInclude(table, "testing/__test__");
		assert.include(table, "1 measurements across 1 checks");
	});

	it("says so when there is nothing to report", () => {
		assert.include(summarize(""), "No growth measurements were recorded");
	});
});
