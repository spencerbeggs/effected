import { assert, describe, it } from "@effect/vitest";
import { Doc, Render, Token } from "@effected/cli-kit";
import type { DocumentDiff } from "@effected/engine/schema";
import { vi } from "vitest";
import { DEFAULT_MAX_DIFF_LINES, DiffDoc } from "../../src/render/DiffDoc.js";

vi.mock("ink", () => {
	throw new Error("ink must not load");
});
vi.mock("react", () => {
	throw new Error("react must not load");
});

const ESC = "\u001B";

const line = (kind: "context" | "add" | "remove", text: string, extra: object = {}) => ({ kind, text, ...extra });

const sample: DocumentDiff = {
	hunks: [
		{
			oldStart: 1,
			oldLines: 4,
			newStart: 1,
			newLines: 7,
			lines: [
				line("context", '  "properties": {'),
				line("remove", '    "description": "The project name",'),
				line("add", '    "description": "The bundles project name",'),
				line("add", '    "strict": {'),
				line("context", "  }"),
			],
		},
	],
	unified: "",
};

// A marker theme: every painted run is wrapped in <token>…</token>, so a test reads which token painted what.
const markerCtx = (overrides: Partial<Parameters<typeof Render.contextOf>[0]> = {}) => {
	const base = Render.contextOf({ audience: "human", color: "truecolor", ...overrides });
	return {
		...base,
		paint: (token: Parameters<typeof base.paint>[0], text: string) =>
			`<${typeof token === "string" ? token : "style"}>${text}</${typeof token === "string" ? token : "style"}>`,
	};
};

const plainCtx = Render.contextOf({ audience: "agent" });

describe("DiffDoc", () => {
	it("plain render has the @@ header and +/- lines", () => {
		const out = Render.plain([DiffDoc.render("schemas/okfit.json", sample)], plainCtx);
		assert.include(out, "@@ schemas/okfit.json @@");
		assert.include(out, '-    "description": "The project name",');
		assert.include(out, '+    "strict": {');
		assert.include(out, '   "properties": {');
		assert.notInclude(out, ESC);
	});

	it("ansi render colours removes with error and adds with success", () => {
		const out = Render.ansi([DiffDoc.render("a.json", sample)], markerCtx());
		assert.include(out, '<error>-    "description": "The project name",</error>');
		assert.include(out, '<success>+    "strict": {</success>');
		assert.notInclude(out, "<error>   ");
		assert.notInclude(out, "<success>   ");
	});

	it("over maxLines truncates with an exact '… N more lines' tail", () => {
		const lines = Array.from({ length: 10 }, (_, i) => line("add", `row ${i}`));
		const diff: DocumentDiff = { hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 10, lines }], unified: "" };
		const out = Render.plain([DiffDoc.render("a.json", diff, { maxLines: 4 })], plainCtx);
		assert.include(out, "+row 3");
		assert.notInclude(out, "+row 4");
		assert.include(out, "… 6 more lines");
		const within = Render.plain([DiffDoc.render("a.json", diff, { maxLines: 10 })], plainCtx);
		assert.notInclude(within, "more line");
		assert.include(within, "+row 9");
	});

	it("a single hidden line reads '… 1 more line'", () => {
		const lines = [line("add", "a"), line("add", "b")];
		const diff: DocumentDiff = { hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines }], unified: "" };
		const out = Render.plain([DiffDoc.render("a.json", diff, { maxLines: 1 })], plainCtx);
		assert.include(out, "… 1 more line");
		assert.notInclude(out, "1 more lines");
	});

	it("the default cap is a named constant that applies when no option is given", () => {
		const lines = Array.from({ length: DEFAULT_MAX_DIFF_LINES + 3 }, (_, i) => line("add", `r${i}`));
		const diff: DocumentDiff = {
			hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: lines.length, lines }],
			unified: "",
		};
		assert.include(Render.plain([DiffDoc.render("a.json", diff)], plainCtx), "… 3 more lines");
	});

	it("a line with noNewline is followed by git's marker", () => {
		const diff: DocumentDiff = {
			hunks: [
				{
					oldStart: 1,
					oldLines: 1,
					newStart: 1,
					newLines: 1,
					lines: [line("remove", "x", { noNewline: true }), line("add", "y")],
				},
			],
			unified: "",
		};
		const out = Render.plain([DiffDoc.render("a.json", diff)], plainCtx).split("\n");
		const at = out.indexOf("-x");
		assert.strictEqual(out[at + 1], "\\ No newline at end of file");
		assert.strictEqual(out[at + 2], "+y");
	});

	it("hostile text is data: escapes are removed and markup stays literal", () => {
		const hostile = `${ESC}[2J${ESC}]8;;https://evil.test\u0007click${ESC}]8;;\u0007 **bold** [x](y) lone${ESC}end \u0007`;
		const diff: DocumentDiff = {
			hunks: [
				{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [line("remove", hostile), line("add", hostile)] },
			],
			unified: "",
		};
		const doc = DiffDoc.render(`pa${ESC}[31mth.json`, diff);
		const ansi = Render.ansi([doc], Render.contextOf({ audience: "human", color: "truecolor" }));
		const plain = Render.plain([doc], plainCtx);
		for (const out of [plain]) {
			assert.notInclude(out, ESC);
			assert.notInclude(out, "\u0007");
			assert.include(out, "**bold** [x](y)");
		}
		// The only escapes in colour output are the theme's own SGR runs.
		const withoutSgr = ansi.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
		assert.notInclude(withoutSgr, ESC);
		assert.notInclude(withoutSgr, "\u0007");
		assert.include(withoutSgr, "**bold** [x](y)");
	});

	it("a workflow command in the text is neutralized for a CI log", () => {
		const diff: DocumentDiff = {
			hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [line("add", "::error::boom")] }],
			unified: "",
		};
		const out = Render.githubLog(
			[DiffDoc.render("a.json", diff)],
			Render.contextOf({ audience: "ci", neutralizeWorkflowCommands: true }),
		);
		assert.isFalse(out.split("\n").some((l) => l.startsWith("::")));
	});

	it("is a plain Doc value built with no react or ink", () => {
		const doc = DiffDoc.render("a.json", sample);
		assert.strictEqual(typeof doc, "object");
		assert.isDefined(Doc);
		assert.isDefined(Token);
	});
});
