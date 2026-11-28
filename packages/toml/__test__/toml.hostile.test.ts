// How the cost of the hostile inputs in `hostile.test.ts` grows. That file holds what each returns; this one holds
// that four times the input costs about four times the CPU time, where a quadratic scan costs sixteen.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Effect } from "effect";
import { Toml } from "../src/Toml.js";
import { TomlFormat } from "../src/TomlFormat.js";

/** A parse of `text`, run to its exit: a parse that fails typed is timed like one that succeeds. */
const parse = (text: string) => () => Effect.runSyncExit(Toml.parse(text));

/** `segments` distinct keys, `k0` onward. */
const segmentsOf = (segments: number) => Array.from({ length: segments }, (_, index) => `k${index}`);

/**
 * How many times one timed run resolves its path. The cap keeps a path short, so one resolution takes about a tenth
 * of a millisecond, and Growth refuses a first run fifty times slower than the later ones as cached work: one
 * collector pause of a few milliseconds in that first run did it. Thirty-two resolutions a run make the run long
 * enough that no pause reads as a cache, and multiply both sizes alike, so the ratio is unchanged.
 */
const RESOLUTIONS = 32;

/** Replace the value at `path` in `text`, `RESOLUTIONS` times, keeping the last result. */
const modifyRepeatedly = (text: string, path: ReadonlyArray<string>) => () => {
	let result = TomlFormat.modifyResult(text, path, 2);
	for (let index = 1; index < RESOLUTIONS; index += 1) result = TomlFormat.modifyResult(text, path, 2);
	return result;
};

describe("hostile inputs: growth", () => {
	// The path cap is 256 segments (`MAX_NESTING_DEPTH`), and a longer path is refused by a length check before any
	// work, which costs the same at every length; `hardening.test.ts` holds that answer. What grows with a path is
	// resolving one under the cap, so these measure 64 segments against 256, the cap itself, each path resolved to
	// its last segment and its value replaced.
	it("replaces a value at the end of a 256-segment dotted key in time linear in the path", () => {
		Growth.assertOrder(
			(segments) => {
				const path = segmentsOf(segments);
				return modifyRepeatedly(`${path.join(".")} = 1\n`, path);
			},
			{ from: 64, order: 1 },
		);
	});

	it("replaces a value at the end of a 256-segment path through nested inline tables in time linear in the path", () => {
		Growth.assertOrder(
			(segments) => {
				const path = segmentsOf(segments);
				const nested = path.slice(1).reduceRight((inner, key) => `{ ${key} = ${inner} }`, "1");
				return modifyRepeatedly(`${path[0]} = ${nested}\n`, path);
			},
			{ from: 64, order: 1 },
		);
	});

	it("parses a 2 MB document of 50,000 key-values in time linear in the keys", () => {
		Growth.assertOrder(
			(keys) =>
				parse(
					`${Array.from({ length: keys }, (_, index) => `k${String(index).padStart(5, "0")} = "${"x".repeat(28)}"`).join("\n")}\n`,
				),
			{ from: 12_500, order: 1 },
		);
	});

	it("parses a long single-line string in time linear in the string", () => {
		Growth.assertOrder((length) => parse(`s = "${"x".repeat(length)}"\n`), { from: 32_768, order: 1 });
	});

	it("refuses a long unterminated string in time linear in the string: no quadratic scan", () => {
		Growth.assertOrder((length) => parse(`s = "${"x".repeat(length)}`), { from: 32_768, order: 1 });
	});
});
