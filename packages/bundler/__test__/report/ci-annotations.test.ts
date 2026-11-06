import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { renderCiAnnotations } from "../../src/report/ci-annotations.js";
import { BuildReport, DiagnosticEntry, TargetGroupReport } from "../../src/report/schema.js";

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

	describe("hostile text", () => {
		const hostile = (entry: Partial<DiagnosticEntry>, id = "npm", pkg = "p") =>
			renderCiAnnotations(
				BuildReport.make({
					package: pkg,
					targetGroups: [
						TargetGroupReport.make({
							id,
							entries: [],
							passes: [],
							warnings: [],
							errors: [DiagnosticEntry.make({ source: "meta", level: "error", text: "t", ...entry })],
							suppressed: [],
							timings: { totalMs: 0 },
						}),
					],
				}),
			)[0];

		it("strips every C0 and C1 control and DEL from the message", () => {
			const controls = [...Array(32).keys(), 127, ...Array.from({ length: 32 }, (_, i) => 0x80 + i)]
				.filter((code) => code !== 10 && code !== 13)
				.map((code) => String.fromCharCode(code))
				.join("");
			assert.strictEqual(hostile({ text: `bad${controls}text` }), "::error title=p (npm)::badtext");
		});

		it("removes the escape of a terminal sequence, leaving its text inert", () => {
			assert.strictEqual(hostile({ text: "bad\u001b[2Jtext" }), "::error title=p (npm)::bad[2Jtext");
		});

		it("still maps a line break in the message, and leaves : and , in it alone", () => {
			assert.strictEqual(hostile({ text: "a:b,c%\r\nd" }), "::error title=p (npm)::a:b,c%25%0D%0Ad");
		});

		it("a file name cannot forge a property or end the property list", () => {
			assert.strictEqual(
				hostile({ file: "a,line=99::forged", line: 3 }),
				"::error title=p (npm) file=a%2Cline=99%3A%3Aforged,line=3::t",
			);
		});

		it("the title's values are escaped too, and stripped", () => {
			assert.strictEqual(hostile({}, "g,x", "p::\u001b[2Jq"), "::error title=p%3A%3A[2Jq (g%2Cx)::t");
		});
	});
});
