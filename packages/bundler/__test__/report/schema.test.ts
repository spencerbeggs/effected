// Ported from savvy-web/systems packages/tsdown-plugins/__test__/report/schema.test.ts on 2026-11-06
// packages/bundler/__test__/report/schema.test.ts

import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { BuildReport, DiagnosticEntry } from "../../src/report/schema.js";

describe("BuildReport schema", () => {
	it("decodes a report with passes, files, and structured diagnostics", () => {
		const decoded = Schema.decodeUnknownSync(BuildReport)({
			package: "@x/p",
			targetGroups: [
				{
					id: "npm",
					entries: ["index"],
					passes: [
						{ id: "js", files: [{ path: "index.js", bytes: 60 }], ms: 731 },
						{ id: "dts", files: [{ path: "index.d.ts", bytes: 2400, gzip: 890 }], ms: 205 },
					],
					warnings: [{ source: "tsdown", level: "warn", text: "heads up" }],
					errors: [],
					suppressed: [],
					timings: { totalMs: 936 },
				},
			],
		});
		assert.strictEqual(decoded.targetGroups[0]?.passes.length, 2);
		assert.strictEqual(decoded.targetGroups[0]?.passes[0]?.files[0]?.bytes, 60);
	});

	it("rejects an unknown diagnostic source and decodes a structured entry", () => {
		// An out-of-enum source is rejected by the DiagnosticEntry schema.
		assert.throws(() => Schema.decodeUnknownSync(DiagnosticEntry)({ source: "nope", level: "warn", text: "x" }));
		// A full entry with file/line/column round-trips.
		const entry: DiagnosticEntry = Schema.decodeUnknownSync(DiagnosticEntry)({
			source: "api-extractor",
			level: "error",
			text: "boom",
			file: "a.ts",
			line: 3,
			column: 1,
		});
		assert.strictEqual(entry.file, "a.ts");
	});
});
