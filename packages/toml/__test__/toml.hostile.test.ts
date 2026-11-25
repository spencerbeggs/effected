// How the cost of the hostile inputs in `hostile.test.ts` grows. That file holds what each returns; this one holds
// that four times the input costs about four times the CPU time, where a quadratic scan costs sixteen.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Effect } from "effect";
import { Toml } from "../src/Toml.js";
import { TomlFormat } from "../src/TomlFormat.js";

/** A parse of `text`, run to its exit: a parse that fails typed is timed like one that succeeds. */
const parse = (text: string) => () => Effect.runSyncExit(Toml.parse(text));

describe("hostile inputs: growth", () => {
	it("refuses a path of 100,000 segments in time linear in the path", () => {
		Growth.assertOrder(
			(segments) => {
				const path = Array.from({ length: segments }, (_, index) => `k${index}`);
				return () => TomlFormat.modifyResult("a = 1\n", path, 2);
			},
			{ from: 25_000, order: 1 },
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
