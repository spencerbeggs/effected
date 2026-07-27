import { assert, describe, it } from "@effect/vitest";
import { DateTime, Schema } from "effect";
import { GitHubMarkdown } from "../src/GitHubMarkdown.js";

describe("GitHubMarkdown", () => {
	describe("table — escaping is the safety argument", () => {
		it("a cell carrying `>=1 || <2` must not shift columns", () => {
			// The live defect this writer exists to delete: the predecessor joined
			// cells with " | " and a semver range added two phantom columns.
			assert.strictEqual(
				GitHubMarkdown.table(["Check", "Outcome"], [[">=1 || <2", "ok"]]),
				"| Check | Outcome |\n| --- | --- |\n| >=1 \\|\\| <2 | ok |",
			);
		});

		it("cells are pre-rendered markdown and pass through verbatim", () => {
			const out = GitHubMarkdown.table(["Check"], [["[build](https://example.dev) **bold**"]]);
			assert.include(out, "[build](https://example.dev) **bold**");
		});

		it("a short row pads to the header width instead of shifting", () => {
			assert.strictEqual(
				GitHubMarkdown.table(["A", "B", "C"], [["only"]]),
				"| A | B | C |\n| --- | --- | --- |\n| only |  |  |",
			);
		});

		it("a cell carrying a newline stays one row — line breaks become <br>", () => {
			// The same corruption class as an unescaped pipe: a raw newline in a
			// cell (a multi-line format result, npm stderr) terminates the row.
			assert.strictEqual(
				GitHubMarkdown.table(["Check", "Log"], [["build", "line one\nline two"]]),
				"| Check | Log |\n| --- | --- |\n| build | line one<br>line two |",
			);
		});
	});

	describe("code", () => {
		it("inline code containing a backtick widens the delimiter", () => {
			assert.strictEqual(GitHubMarkdown.code("a ` b"), "``a ` b``");
		});

		it("a code block whose content contains a fence lengthens the fence", () => {
			assert.strictEqual(GitHubMarkdown.codeBlock("a\n```\nb", "ts"), "````ts\na\n```\nb\n````");
		});

		it("a code block without a language carries a bare fence", () => {
			assert.strictEqual(GitHubMarkdown.codeBlock("plain"), "```\nplain\n```");
		});
	});

	describe("link", () => {
		it("a url the destination cannot carry raw is angle-bracketed", () => {
			assert.strictEqual(
				GitHubMarkdown.link("the check", "https://x.dev/a b(c)"),
				"[the check](<https://x.dev/a b(c)>)",
			);
		});

		it("an ordinary url stays bare", () => {
			assert.strictEqual(GitHubMarkdown.link("npm", "https://www.npmjs.com/"), "[npm](https://www.npmjs.com/)");
		});
	});

	describe("heading", () => {
		it("defaults to level 2", () => {
			assert.strictEqual(GitHubMarkdown.heading("Release Validation"), "## Release Validation");
		});

		it("renders the requested depth", () => {
			assert.strictEqual(GitHubMarkdown.heading("Details", 3), "### Details");
		});
	});

	describe("list", () => {
		it("renders bullets, and a multi-line item stays inside its bullet", () => {
			assert.strictEqual(
				GitHubMarkdown.list(["first **bold**", "second line1\nline2"]),
				"- first **bold**\n- second line1\n  line2",
			);
		});

		it("renders ordered items", () => {
			assert.strictEqual(GitHubMarkdown.list(["one", "two"], { ordered: true }), "1. one\n2. two");
		});
	});

	describe("details", () => {
		it("wraps the body in blank lines so GitHub renders the markdown inside", () => {
			assert.strictEqual(
				GitHubMarkdown.details("<strong>logs</strong>", "| A |\n| --- |\n| x |"),
				"<details>\n<summary><strong>logs</strong></summary>\n\n| A |\n| --- |\n| x |\n\n</details>",
			);
		});
	});

	describe("raw", () => {
		it("is the identity, by name", () => {
			const rendered = "already **markdown** with a [link](url)";
			assert.strictEqual(GitHubMarkdown.raw(rendered), rendered);
		});
	});

	describe("tableFor — the schema is the single authority for the table's shape", () => {
		it("headers come from title annotations, falling back to the field name", () => {
			const Row = Schema.Struct({
				name: Schema.String.annotate({ title: "Check" }),
				detail: Schema.String,
			});
			assert.strictEqual(
				GitHubMarkdown.tableFor(Row).render([{ name: "build", detail: "clean" }]),
				"| Check | detail |\n| --- | --- |\n| build | clean |",
			);
		});

		it("a per-column header override beats the annotation", () => {
			const Row = Schema.Struct({ name: Schema.String.annotate({ title: "Check" }) });
			assert.strictEqual(
				GitHubMarkdown.tableFor(Row, { columns: { name: { header: "Step" } } }).render([{ name: "build" }]),
				"| Step |\n| --- |\n| build |",
			);
		});

		it("column order is field declaration order, not row-object key order", () => {
			const Row = Schema.Struct({
				first: Schema.String,
				second: Schema.String,
				third: Schema.String,
			});
			// The row object deliberately spells its keys in a different order:
			// a typed row cannot transpose columns, which is the hazard this
			// construct exists to delete.
			const out = GitHubMarkdown.tableFor(Row).render([{ third: "3", first: "1", second: "2" }]);
			assert.strictEqual(out, "| first | second | third |\n| --- | --- | --- |\n| 1 | 2 | 3 |");
		});

		it("a typed field projects through its own codec", () => {
			const Row = Schema.Struct({
				name: Schema.String,
				at: Schema.DateTimeUtcFromString.annotate({ title: "When" }),
				outcome: Schema.Literals(["passed", "failed"]),
			});
			assert.strictEqual(
				GitHubMarkdown.tableFor(Row).render([
					{ name: "build", at: DateTime.makeUnsafe("2026-07-26T12:30:00Z"), outcome: "passed" },
				]),
				"| name | When | outcome |\n| --- | --- | --- |\n| build | 2026-07-26T12:30:00.000Z | passed |",
			);
		});

		it("a field whose encoded side is not a string renders through its required formatter", () => {
			// v4's Schema.DateTimeUtc encodes to DateTime.Utc itself — the string
			// serialization moved out of the declare — so it has no string
			// projection to borrow and the type of `options` demands a format.
			const Row = Schema.Struct({ at: Schema.DateTimeUtc });
			const table = GitHubMarkdown.tableFor(Row, {
				columns: { at: { format: (value) => DateTime.formatIso(value) } },
			});
			assert.strictEqual(
				table.render([{ at: DateTime.makeUnsafe("2026-07-26T12:30:00Z") }]),
				"| at |\n| --- |\n| 2026-07-26T12:30:00.000Z |",
			);

			// The obligation is enforced at the type level, in both directions:
			// @ts-expect-error — a non-string-encoded field makes `options` required
			GitHubMarkdown.tableFor(Row);
			// @ts-expect-error — and its column entry cannot omit `format`
			GitHubMarkdown.tableFor(Row, { columns: { at: { header: "When" } } });
		});

		it("escaping is inherited from table — a cell carrying pipes cannot shift columns", () => {
			const Row = Schema.Struct({ range: Schema.String, outcome: Schema.String });
			assert.strictEqual(
				GitHubMarkdown.tableFor(Row).render([{ range: ">=1 || <2", outcome: "ok" }]),
				"| range | outcome |\n| --- | --- |\n| >=1 \\|\\| <2 | ok |",
			);
		});

		it("an absent optional field renders as an empty cell", () => {
			const Row = Schema.Struct({ name: Schema.String, note: Schema.optionalKey(Schema.String) });
			assert.strictEqual(
				GitHubMarkdown.tableFor(Row).render([{ name: "build" }, { name: "test", note: "flaky" }]),
				"| name | note |\n| --- | --- |\n| build |  |\n| test | flaky |",
			);
		});

		it("re-rendering from current state is just calling render again", () => {
			const Row = Schema.Struct({ name: Schema.String, outcome: Schema.Literals(["queued", "passed"]) });
			const table = GitHubMarkdown.tableFor(Row);
			const rows: Array<typeof Row.Type> = [{ name: "build", outcome: "queued" }];
			const before = table.render(rows);
			assert.strictEqual(before, "| name | outcome |\n| --- | --- |\n| build | queued |");
			rows[0] = { name: "build", outcome: "passed" };
			rows.push({ name: "test", outcome: "queued" });
			assert.strictEqual(
				table.render(rows),
				"| name | outcome |\n| --- | --- |\n| build | passed |\n| test | queued |",
			);
			// Identical rows are byte-identical output — the renderer holds no state.
			assert.strictEqual(table.render([{ name: "build", outcome: "queued" }]), before);
		});
	});
});
