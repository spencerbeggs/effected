import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { renderCiAnnotations } from "../../src/report/ci-annotations.js";
import { BuildReport } from "../../src/report/schema.js";

const decode = Schema.decodeUnknownSync(BuildReport);

const report = decode({
	package: "@x/p",
	targetGroups: [
		{
			id: "npm",
			entries: ["index"],
			passes: [],
			warnings: [{ source: "tsdown", level: "warn", text: "heads up" }],
			errors: [{ source: "api-extractor", level: "error", text: "boom", file: "a.ts", line: 3, column: 1 }],
			suppressed: [],
			timings: { totalMs: 936 },
		},
	],
});

const fatalReport = decode({
	package: "@x/p",
	targetGroups: [
		{
			id: "npm",
			entries: ["index"],
			passes: [],
			warnings: [
				{
					source: "api-extractor",
					level: "warn",
					text: "Bar needs export",
					code: "ae-forgotten-export",
					ciFatal: true,
				},
			],
			errors: [],
			suppressed: [{ source: "api-extractor", level: "warn", text: "Y undocumented", code: "tsdoc-undefined-tag" }],
			timings: { totalMs: 5 },
		},
	],
});

describe("renderCiAnnotations", () => {
	it("emits ::error with file/line, one line per diagnostic", () => {
		assert.deepStrictEqual(renderCiAnnotations(report), [
			"::error title=@x/p (npm) file=a.ts,line=3::boom",
			"::warning title=@x/p (npm)::heads up",
		]);
	});

	it("does not emit suppressed messages or the fails-CI tag", () => {
		const content = renderCiAnnotations(fatalReport).join("\n");
		assert.notInclude(content, "[fails CI]");
		assert.notInclude(content, "Y undocumented");
		assert.include(content, "::warning");
	});

	it("escapes percent and newlines in the message", () => {
		const r = decode({
			package: "p",
			targetGroups: [
				{
					id: "g",
					entries: [],
					passes: [],
					warnings: [{ source: "tsdown", level: "warn", text: "a%b\nc" }],
					errors: [],
					suppressed: [],
					timings: { totalMs: 0 },
				},
			],
		});
		assert.deepStrictEqual(renderCiAnnotations(r), ["::warning title=p (g)::a%25b%0Ac"]);
	});

	it("is empty when the report has no diagnostics", () => {
		assert.deepStrictEqual(renderCiAnnotations(decode({ package: "p", targetGroups: [] })), []);
	});
});
