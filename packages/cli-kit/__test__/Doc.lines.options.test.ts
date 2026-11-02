import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Block, RenderContext } from "../src/index.js";
import { Doc, Render } from "../src/index.js";
import { contextOf } from "./helpers/renderContext.js";

const linesOf = (doc: ReadonlyArray<Block>, overrides: Partial<RenderContext> = {}) =>
	Effect.map(contextOf(overrides), (ctx) => Render.plain(doc, ctx).split("\n"));

/** Two entries wider than the 12-column width, so wrapping, cutting and keeping whole all differ. */
const ROWS = ["alpha beta gamma delta", "one two three four five"];

describe("Doc.lines: truncate and wrap: false hold for every entry, as for Doc.line", () => {
	it.effect("control: by default each entry wraps at the width", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.lines(ROWS)], { width: 12 });
			assert.isAbove(out.length, ROWS.length);
		}),
	);

	it.effect("wrap: false keeps each entry whole on one line", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.lines(ROWS, { wrap: false })], { width: 12 });
			assert.deepStrictEqual(out, ROWS);
		}),
	);

	it.effect("truncate cuts each entry to the width", () =>
		Effect.gen(function* () {
			const out = yield* linesOf([Doc.lines(ROWS, { truncate: true })], { width: 12 });
			assert.strictEqual(out.length, ROWS.length);
			for (const line of out) assert.isAtMost(line.length, 12, line);
		}),
	);

	it.effect("each entry renders as Doc.line with the same options would", () =>
		Effect.gen(function* () {
			for (const options of [{ wrap: false }, { truncate: true }] as const) {
				const lines = yield* linesOf([Doc.lines(ROWS, options)], { width: 12 });
				const each = yield* linesOf(
					ROWS.map((row) => Doc.line(row, options)),
					{ width: 12 },
				);
				assert.deepStrictEqual(lines, each, JSON.stringify(options));
			}
		}),
	);

	it("leaves an omitted option off the node", () => {
		assert.deepStrictEqual(Object.keys(Doc.lines(ROWS)), ["_tag", "lines"]);
		assert.deepStrictEqual(Object.keys(Doc.lines(ROWS, { wrap: false })), ["_tag", "lines", "wrap"]);
	});
});
