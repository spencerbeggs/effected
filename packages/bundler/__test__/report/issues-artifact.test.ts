import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { flattenIssues, serializeIssues, writeIssuesArtifact } from "../../src/report/issues-artifact.js";
import { BuildReport, DiagnosticEntry, ReportTimings, TargetGroupReport } from "../../src/report/schema.js";

const warn = (over: Partial<ConstructorParameters<typeof DiagnosticEntry>[0]> = {}) =>
	new DiagnosticEntry({
		source: "api-extractor",
		level: "warn",
		text: "missing release tag",
		code: "ae-missing-release-tag",
		file: "src/index.ts",
		line: 12,
		...over,
	});

const group = (id: string, warnings: DiagnosticEntry[]) =>
	new TargetGroupReport({
		id,
		entries: ["index"],
		passes: [],
		warnings,
		errors: [],
		suppressed: [],
		timings: new ReportTimings({ totalMs: 0 }),
	});

describe("flattenIssues", () => {
	it("aggregates and de-duplicates identical diagnostics across target groups", () => {
		const report = new BuildReport({
			package: "@x/p",
			targetGroups: [group("npm", [warn()]), group("jsr", [warn()])],
		});
		const issues = flattenIssues([report], { target: "prod", generatedAt: "2026-06-21T00:00:00.000Z" });
		assert.strictEqual(issues.package, "@x/p");
		assert.strictEqual(issues.target, "prod");
		assert.strictEqual(issues.generatedAt, "2026-06-21T00:00:00.000Z");
		assert.strictEqual(issues.buildOk, true);
		assert.isUndefined(issues.failure);
		assert.lengthOf(issues.warnings, 1);
		assert.deepStrictEqual(issues.warnings[0], {
			source: "api-extractor",
			level: "warn",
			text: "missing release tag",
			code: "ae-missing-release-tag",
			file: "src/index.ts",
			line: 12,
		});
		assert.deepStrictEqual(issues.errors, []);
		assert.deepStrictEqual(issues.suppressed, []);
	});

	it("keeps distinct diagnostics and drops undefined optional fields", () => {
		const report = new BuildReport({
			package: "@x/p",
			targetGroups: [
				group("npm", [warn(), warn({ line: 20 }), warn({ code: "tsdoc-undefined-tag", text: "bad tag" })]),
			],
		});
		const issues = flattenIssues([report], { target: "prod", generatedAt: "t" });
		assert.lengthOf(issues.warnings, 3);
		const noFileEntry = flattenIssues(
			[
				new BuildReport({
					package: "@x/p",
					targetGroups: [group("npm", [warn({ file: undefined, line: undefined })])],
				}),
			],
			{ target: "dev", generatedAt: "t" },
		).warnings[0];
		assert.deepStrictEqual(Object.keys(noFileEntry ?? {}), ["source", "level", "text", "code"]);
	});

	it("serializes to pretty JSON with a trailing newline", () => {
		const issues = flattenIssues([new BuildReport({ package: "@x/p", targetGroups: [] })], {
			target: "prod",
			generatedAt: "t",
		});
		const text = serializeIssues(issues);
		assert.strictEqual(text.endsWith("\n"), true);
		assert.deepStrictEqual(JSON.parse(text), {
			generatedAt: "t",
			package: "@x/p",
			target: "prod",
			buildOk: true,
			warnings: [],
			errors: [],
			suppressed: [],
		});
	});

	it("stamps a failed build with buildOk false and the failure", () => {
		const issues = flattenIssues([new BuildReport({ package: "@x/p", targetGroups: [] })], {
			target: "prod",
			generatedAt: "t",
			buildOk: false,
			failure: { name: "InternalError", message: "The referenced path was not found" },
		});
		assert.strictEqual(issues.buildOk, false);
		assert.deepStrictEqual(issues.failure, { name: "InternalError", message: "The referenced path was not found" });
		// The crash-shaped artifact: empty buckets, but no longer indistinguishable from a clean gate.
		assert.deepStrictEqual(issues.errors, []);
		assert.deepStrictEqual(issues.warnings, []);
	});

	it("omits an empty failure name and truncates an oversized failure message", () => {
		const issues = flattenIssues([new BuildReport({ package: "@x/p", targetGroups: [] })], {
			target: "prod",
			generatedAt: "t",
			buildOk: false,
			failure: { name: "", message: "x".repeat(2500) },
		});
		assert.deepStrictEqual(Object.keys(issues.failure ?? {}), ["message"]);
		// The ellipsis is inside the budget, not additional to it.
		assert.strictEqual(issues.failure?.message.length, 2000);
		assert.strictEqual(issues.failure?.message.endsWith("…"), true);
	});

	it("leaves a failure message exactly at the limit untruncated", () => {
		const issues = flattenIssues([new BuildReport({ package: "@x/p", targetGroups: [] })], {
			target: "prod",
			generatedAt: "t",
			buildOk: false,
			failure: { message: "x".repeat(2000) },
		});
		assert.strictEqual(issues.failure?.message.length, 2000);
		assert.strictEqual(issues.failure?.message.endsWith("…"), false);
	});
});

describe("writeIssuesArtifact", () => {
	it("writes dist/<target>/issues.json and returns its path", () => {
		const cwd = mkdtempSync(join(tmpdir(), "issues-"));
		const reports = [new BuildReport({ package: "@x/p", targetGroups: [group("npm", [warn()])] })];
		const path = writeIssuesArtifact({
			cwd,
			target: "prod",
			reports,
			now: () => new Date("2026-06-21T00:00:00.000Z"),
		});
		assert.strictEqual(path, join(cwd, "dist", "prod", "issues.json"));
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		assert.strictEqual(parsed.target, "prod");
		assert.strictEqual(parsed.generatedAt, "2026-06-21T00:00:00.000Z");
		assert.lengthOf(parsed.warnings, 1);
	});

	it("writes an empty-but-present file when there are no issues", () => {
		const cwd = mkdtempSync(join(tmpdir(), "issues-"));
		const path = writeIssuesArtifact({
			cwd,
			target: "dev",
			reports: [new BuildReport({ package: "@x/p", targetGroups: [] })],
			now: () => new Date("2026-06-21T00:00:00.000Z"),
		});
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		assert.deepStrictEqual(parsed, {
			generatedAt: "2026-06-21T00:00:00.000Z",
			package: "@x/p",
			target: "dev",
			buildOk: true,
			warnings: [],
			errors: [],
			suppressed: [],
		});
	});

	it("stamps buildOk false and the failure when the build crashed", () => {
		const cwd = mkdtempSync(join(tmpdir(), "issues-"));
		const path = writeIssuesArtifact({
			cwd,
			target: "prod",
			reports: [new BuildReport({ package: "@x/p", targetGroups: [] })],
			now: () => new Date("2026-06-21T00:00:00.000Z"),
			buildOk: false,
			failure: { name: "InternalError", message: "dist/prod/npm/pkg/index.d.ts not found" },
		});
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		assert.strictEqual(parsed.buildOk, false);
		assert.deepStrictEqual(parsed.failure, {
			name: "InternalError",
			message: "dist/prod/npm/pkg/index.d.ts not found",
		});
	});

	it("writes atomically — replaces a previous artifact and leaves no temp file behind", () => {
		const cwd = mkdtempSync(join(tmpdir(), "issues-"));
		const write = (buildOk: boolean) =>
			writeIssuesArtifact({
				cwd,
				target: "prod",
				reports: [new BuildReport({ package: "@x/p", targetGroups: [group("npm", buildOk ? [] : [warn()])] })],
				now: () => new Date("2026-06-21T00:00:00.000Z"),
				buildOk,
			});
		write(true);
		const path = write(false);
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		assert.strictEqual(parsed.buildOk, false);
		assert.lengthOf(parsed.warnings, 1);
		assert.deepStrictEqual(readdirSync(dirname(path)), ["issues.json"]);
	});
});
