import { assert, describe, it } from "@effect/vitest";
import { Doc, Render, Status } from "../src/index.js";

const changes = (n: number) =>
	Doc.counter(Status.core, "success", {
		key: "changes",
		label: { one: "change", other: "changes" },
		n,
		showZero: true,
	});
const errors = (n: number) =>
	Doc.counter(Status.core, "failure", { key: "errors", label: { one: "error", other: "errors" }, n, showZero: true });

const ctx = Render.contextOf({ audience: "agent" });
const plain = (layout: "inline" | "columns" | "row", n: number, share?: false) =>
	Render.plain(
		[Doc.counts({ counters: [changes(n), errors(n)], layout, ...(share === undefined ? {} : { share }) })],
		ctx,
	);

describe("Doc.counter with a plural label", () => {
	it("chooses one for exactly 1 and other for 0 and 2, in the headline's share and after it", () => {
		assert.strictEqual(plain("inline", 0), "0/0 changes, 0 errors");
		assert.strictEqual(plain("inline", 1), "1/2 change, 1 error");
		assert.strictEqual(plain("inline", 2), "2/4 changes, 2 errors");
	});

	it("chooses by the counter's own n, not by the total the share shows", () => {
		const text = Render.plain([Doc.counts({ counters: [changes(1), errors(2)], layout: "inline" })], ctx);
		assert.strictEqual(text, "1/3 change, 2 errors");
	});

	it("applies with share off, and in the columns and row layouts", () => {
		assert.strictEqual(plain("inline", 1, false), "1 change, 1 error");
		assert.strictEqual(plain("columns", 1), "change  1\nerror   1");
		assert.strictEqual(plain("columns", 2), "changes  2\nerrors   2");
		assert.strictEqual(plain("row", 1), "1/2 change  1 error");
	});

	it("applies in markdown", () => {
		const md = (n: number) =>
			Render.markdown([Doc.counts({ counters: [changes(n), errors(n)], layout: "columns" })], ctx);
		assert.strictEqual(md(1), "- change: 1\n- error: 1");
		assert.strictEqual(md(2), "- changes: 2\n- errors: 2");
	});

	it("heads a counts table's column with the plural form, since the column holds every row's count", () => {
		const text = Render.plain(
			[
				Doc.countsTable([
					{ label: "a", counters: [changes(1)] },
					{ label: "b", counters: [changes(2)] },
				]),
			],
			ctx,
		);
		assert.include(text, "changes");
		assert.notMatch(text, /\bchange\b/);
	});

	it("a plain string label is unchanged, and the counter node stays frozen", () => {
		const one = Doc.counter(Status.core, "success", { key: "p", label: "passed", n: 1 });
		assert.strictEqual(one.label, "passed");
		const plural = changes(1);
		assert.deepStrictEqual(plural.label, { one: "change", other: "changes" });
		assert.isTrue(Object.isFrozen(plural.label));
	});
});
