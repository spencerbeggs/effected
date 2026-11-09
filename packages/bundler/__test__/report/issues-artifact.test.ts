// Ported from savvy-web/systems packages/tsdown-plugins/__test__/report/issues-artifact.test.ts on 2026-11-06
import { dirname, join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, PlatformError } from "effect";
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
	const cwd = "/ws/pkg";
	const now = () => new Date("2026-06-21T00:00:00.000Z");

	it.effect("writes dist/<target>/issues.json and returns its path", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const reports = [new BuildReport({ package: "@x/p", targetGroups: [group("npm", [warn()])] })];
			const path = yield* writeIssuesArtifact({ cwd, target: "prod", reports, now }).pipe(Effect.provide(handle.layer));
			assert.strictEqual(path, join(cwd, "dist", "prod", "issues.json"));
			const parsed = JSON.parse(handle.volume.text(path) ?? "");
			assert.strictEqual(parsed.target, "prod");
			assert.strictEqual(parsed.generatedAt, "2026-06-21T00:00:00.000Z");
			assert.lengthOf(parsed.warnings, 1);
		}),
	);

	it.effect("stamps the Effect clock when no clock is passed", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const reports = [new BuildReport({ package: "@x/p", targetGroups: [] })];
			const path = yield* writeIssuesArtifact({ cwd, target: "prod", reports }).pipe(Effect.provide(handle.layer));
			// Under it.effect the TestClock starts at the epoch.
			assert.strictEqual(JSON.parse(handle.volume.text(path) ?? "").generatedAt, "1970-01-01T00:00:00.000Z");
		}),
	);

	it.effect("writes an empty-but-present file when there are no issues", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const path = yield* writeIssuesArtifact({
				cwd,
				target: "dev",
				reports: [new BuildReport({ package: "@x/p", targetGroups: [] })],
				now,
			}).pipe(Effect.provide(handle.layer));
			assert.deepStrictEqual(JSON.parse(handle.volume.text(path) ?? ""), {
				generatedAt: "2026-06-21T00:00:00.000Z",
				package: "@x/p",
				target: "dev",
				buildOk: true,
				warnings: [],
				errors: [],
				suppressed: [],
			});
		}),
	);

	it.effect("stamps buildOk false and the failure when the build crashed", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const path = yield* writeIssuesArtifact({
				cwd,
				target: "prod",
				reports: [new BuildReport({ package: "@x/p", targetGroups: [] })],
				now,
				buildOk: false,
				failure: { name: "InternalError", message: "dist/prod/npm/pkg/index.d.ts not found" },
			}).pipe(Effect.provide(handle.layer));
			const parsed = JSON.parse(handle.volume.text(path) ?? "");
			assert.strictEqual(parsed.buildOk, false);
			assert.deepStrictEqual(parsed.failure, {
				name: "InternalError",
				message: "dist/prod/npm/pkg/index.d.ts not found",
			});
		}),
	);

	it.effect("writes atomically — replaces a previous artifact and leaves no temp file behind", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync();
			const write = (buildOk: boolean) =>
				writeIssuesArtifact({
					cwd,
					target: "prod",
					reports: [new BuildReport({ package: "@x/p", targetGroups: [group("npm", buildOk ? [] : [warn()])] })],
					now,
					buildOk,
				}).pipe(Effect.provide(handle.layer));
			yield* write(true);
			const path = yield* write(false);
			const parsed = JSON.parse(handle.volume.text(path) ?? "");
			assert.strictEqual(parsed.buildOk, false);
			assert.lengthOf(parsed.warnings, 1);
			assert.deepStrictEqual(handle.volume.readDirectory(dirname(path)), ["issues.json"]);
		}),
	);

	it.effect("removes its temp file and fails typed when the rename fails", () =>
		Effect.gen(function* () {
			const denied = PlatformError.systemError({
				_tag: "PermissionDenied",
				module: "FileSystem",
				method: "rename",
				pathOrDescriptor: cwd,
			});
			const handle = MemoryFileSystem.makeSync({}, { faults: { rename: () => Effect.fail(denied) } });
			const error = yield* Effect.flip(
				writeIssuesArtifact({
					cwd,
					target: "prod",
					reports: [new BuildReport({ package: "@x/p", targetGroups: [] })],
					now,
				}).pipe(Effect.provide(handle.layer)),
			);
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			assert.deepStrictEqual(handle.volume.readDirectory(join(cwd, "dist", "prod")), []);
		}),
	);
});
