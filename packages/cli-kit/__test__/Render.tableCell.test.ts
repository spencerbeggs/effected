import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Doc, Render } from "../src/index.js";
import { contextOf } from "./helpers/renderContext.js";

describe("a table cell's trailing line breaks", () => {
	// `Render.tableCell.hostile.test.ts` holds that the trim does not backtrack on this run.
	it.effect("keeps the first line of a cell holding a long CRLF run before more text", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			const cell = `a${"\r\n".repeat(26)}b`;
			const out = Render.plain([Doc.table([{ header: "h" }], [[cell]])], ctx);
			assert.strictEqual(out, `h\n${"-".repeat(2)}\na${ctx.glyphs.ellipsis}`);
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
	// `Render.tableCell.hostile.test.ts` holds that the trim is linear in these runs.
	it.effect("renders a cell holding a long interior run of spaces or line breaks", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			for (const run of [" ".repeat(40_000), "\n".repeat(40_000)]) {
				const out = Render.markdown([Doc.table([{ header: "h" }], [[`x${run}y`]])], ctx);
				assert.isTrue(out.startsWith("| h |"), out.slice(0, 20));
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
