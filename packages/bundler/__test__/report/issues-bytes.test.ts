import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Schema } from "effect";
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

	it.effect("writes the same bytes to dist/prod/issues.json for a pinned clock", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const cwd = "/ws/pkg";
			const path = yield* writeIssuesArtifact({
				cwd,
				target: "prod",
				reports: [report],
				now: () => new Date("2026-06-21T00:00:00.000Z"),
				buildOk: false,
				failure,
			}).pipe(Effect.provide(handle.layer));
			assert.strictEqual(path, join(cwd, "dist", "prod", "issues.json"));
			assert.strictEqual(handle.volume.text(path), fixture("issues.expected.json"));
		}),
	);
});
