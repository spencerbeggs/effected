import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { ConfigProvider, Effect, FileSystem, PlatformError } from "effect";
import { StepSummary } from "../src/StepSummary.js";

// The env is a `ConfigProvider`, swapped per test; an empty record is the
// unset case, which the real `fromEnv()` default would read from the process.
const env = (record: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromEnv({ env: record }));

describe("StepSummary.append", () => {
	it.effect("appends to an existing GITHUB_STEP_SUMMARY file and returns true", () =>
		Effect.gen(function* () {
			const appended = yield* StepSummary.append("hello\n");
			assert.isTrue(appended);
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/summary.md"), "existing\nhello\n");
		}).pipe(
			Effect.provide(MemoryFileSystem.layerWith({ "/summary.md": "existing\n" })),
			Effect.provide(env({ GITHUB_STEP_SUMMARY: "/summary.md" })),
		),
	);

	it.effect("creates the file when GITHUB_STEP_SUMMARY points at nothing yet", () =>
		Effect.gen(function* () {
			const appended = yield* StepSummary.append("hello\n");
			assert.isTrue(appended);
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/summary.md"), "hello\n");
		}).pipe(
			Effect.provide(MemoryFileSystem.layerWith({})),
			Effect.provide(env({ GITHUB_STEP_SUMMARY: "/summary.md" })),
		),
	);

	it.effect("returns false and writes nothing when GITHUB_STEP_SUMMARY is unset", () =>
		Effect.gen(function* () {
			const appended = yield* StepSummary.append("hello\n");
			assert.isFalse(appended);
			const fs = yield* FileSystem.FileSystem;
			assert.isFalse(yield* fs.exists("/summary.md"));
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({})), Effect.provide(env({}))),
	);

	it.effect("returns false and writes nothing when GITHUB_STEP_SUMMARY is empty", () =>
		Effect.gen(function* () {
			const appended = yield* StepSummary.append("hello\n");
			assert.isFalse(appended);
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({})), Effect.provide(env({ GITHUB_STEP_SUMMARY: "" }))),
	);

	it.effect("logs a warning and returns false when the write fails", () =>
		Effect.gen(function* () {
			const appended = yield* StepSummary.append("hello\n");
			assert.isFalse(appended);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerFaultyWith(
					{ "/summary.md": "existing\n" },
					{
						writeFile: (path) =>
							Effect.fail(
								PlatformError.systemError({
									_tag: "PermissionDenied",
									module: "FileSystem",
									method: "writeFile",
									pathOrDescriptor: path,
								}),
							),
					},
				),
			),
			Effect.provide(env({ GITHUB_STEP_SUMMARY: "/summary.md" })),
		),
	);

	it.effect("logs a warning and returns false when the read fails", () =>
		Effect.gen(function* () {
			const appended = yield* StepSummary.append("hello\n");
			assert.isFalse(appended);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerFaultyWith(
					{ "/summary.md": "existing\n" },
					{
						readFile: (path) =>
							Effect.fail(
								PlatformError.systemError({
									_tag: "PermissionDenied",
									module: "FileSystem",
									method: "readFile",
									pathOrDescriptor: path,
								}),
							),
					},
				),
			),
			Effect.provide(env({ GITHUB_STEP_SUMMARY: "/summary.md" })),
		),
	);
});
