// How trimming a table cell grows on a long run of line breaks or spaces. `Render.tableCell.test.ts` holds what
// the trim leaves.

import { describe, it } from "@effect/vitest";
import { Growth } from "@effected/testing";
import { Effect } from "effect";
import { Doc, Render } from "../src/index.js";
import { contextOf } from "./helpers/renderContext.js";

describe("a table cell's trailing line breaks", () => {
	// A backtracking trim doubles its work with each CRLF in the run: 26 of them were enough to notice, so these
	// sizes fail in seconds on such a trim instead of never returning.
	it.effect("are trimmed without backtracking on a CRLF run before more text", () =>
		Effect.gen(function* () {
			const ctx = yield* contextOf({ color: "none" });
			Growth.assertOrder(
				(count) => {
					const doc = [Doc.table([{ header: "h" }], [[`a${"\r\n".repeat(count)}b`]])];
					return () => Render.plain(doc, ctx);
				},
				{ from: 6, order: 1 },
			);
		}),
	);
});

describe("a markdown table cell's edges", () => {
	for (const [name, unit] of [
		["spaces", " "],
		["line breaks", "\n"],
	] as const) {
		it.effect(`are trimmed in time linear in an interior run of ${name}`, () =>
			Effect.gen(function* () {
				const ctx = yield* contextOf({ color: "none" });
				Growth.assertOrder(
					(count) => {
						const doc = [Doc.table([{ header: "h" }], [[`x${unit.repeat(count)}y`]])];
						return () => Render.markdown(doc, ctx);
					},
					{ from: 10_000, order: 1 },
				);
			}),
		);
	}
});
