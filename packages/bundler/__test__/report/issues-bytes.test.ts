import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Schema } from "effect";
import { flattenIssues, serializeIssues, writeIssuesArtifact } from "../../src/report/issues-artifact.js";
import { BuildReport } from "../../src/report/schema.js";

const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "..", "fixtures", name), "utf8");
const report = Schema.decodeUnknownSync(BuildReport)(JSON.parse(fixture("issues.input.json")));
const failure = { name: "ConfigValidationError", message: "bad config" };

describe("issues.json byte stability", () => {
	it("serializes a fixed report to the bytes the previous implementation produced", () => {
		const issues = flattenIssues([report], {
			target: "prod",
			generatedAt: "2026-06-21T00:00:00.000Z",
			buildOk: false,
			failure,
		});
		assert.strictEqual(serializeIssues(issues), fixture("issues.expected.json"));
	});

	it("writes the same bytes to dist/prod/issues.json for a pinned clock", () => {
		const cwd = mkdtempSync(join(tmpdir(), "issues-bytes-"));
		const path = writeIssuesArtifact({
			cwd,
			target: "prod",
			reports: [report],
			now: () => new Date("2026-06-21T00:00:00.000Z"),
			buildOk: false,
			failure,
		});
		assert.strictEqual(path, join(cwd, "dist", "prod", "issues.json"));
		assert.strictEqual(readFileSync(path, "utf8"), fixture("issues.expected.json"));
	});
});
