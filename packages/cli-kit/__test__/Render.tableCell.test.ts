import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Doc, Render } from "../src/index.js";
import { contextOf } from "./helpers/renderContext.js";

/**
 * Milliseconds of CPU time this process has spent (`process.cpuUsage`, user plus system): time the work spent, not
 * time the process was descheduled, so a loaded machine can not stretch a sample. vitest runs each file in its own
 * fork, so no other test's CPU lands here. It under-measures async I/O, which the units here do not use.
 */
const cpuNow = (): number => {
	const used = process.cpuUsage();
	return (used.user + used.system) / 1000;
};

describe("a table cell's trailing line breaks", () => {
	it.effect("are trimmed in linear time: a long CRLF run before more text does not backtrack", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			const cell = `a${"\r\n".repeat(26)}b`;
			const started = cpuNow();
			const out = Render.plain([Doc.table([{ header: "h" }], [[cell]])], ctx);
			const elapsed = cpuNow() - started;
			assert.strictEqual(out, `h\n${"-".repeat(2)}\na${ctx.glyphs.ellipsis}`);
			assert.isBelow(elapsed, 500, `took ${elapsed} ms`);
		}),
	);

	it.effect("only trailing breaks are dropped, of every kind, and a cell keeps its first line", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			const rows = ["a\r\n\r\n", "a\n\r", "a\r\r\n\n", "a\nb\r\n"].map((cell) => [cell]);
			assert.strictEqual(
				Render.plain([Doc.table([{ header: "h" }], rows)], ctx),
				["h", "--", "a", "a", "a", `a${ctx.glyphs.ellipsis}`].join("\n"),
			);
		}),
	);
});

describe("a markdown table cell's edges", () => {
	it.effect("are trimmed in linear time: a long interior run of spaces or line breaks does not backtrack", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			for (const run of [" ".repeat(40_000), "\n".repeat(40_000)]) {
				const started = cpuNow();
				const out = Render.markdown([Doc.table([{ header: "h" }], [[`x${run}y`]])], ctx);
				const elapsed = cpuNow() - started;
				assert.isTrue(out.startsWith("| h |"), out.slice(0, 20));
				assert.isBelow(elapsed, 500, `took ${elapsed} ms`);
			}
		}),
	);

	it.effect("drop only leading and trailing whitespace and line breaks", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			const cells = [" \n a b \n ", "\n\na", "a\n\n", "a \n b", "   ", "\n"];
			const out = Render.markdown(
				[
					Doc.table(
						[{ header: "h" }],
						cells.map((cell) => [cell]),
					),
				],
				ctx,
			);
			assert.deepStrictEqual(out.split("\n").slice(2), ["| a b |", "| a |", "| a |", "| a <br> b |", "| |", "| |"]);
		}),
	);
});
