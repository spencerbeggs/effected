import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { BundlerSeams } from "@effected/bundler";
import { BuildReport, EffectedConfigError, TargetGroupReport, flattenIssues, serializeIssues } from "@effected/bundler";
import { JournalWatcher } from "@effected/jsonl";
import type { MemoryFileSystemHandle, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path, PlatformError, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { BuildProgress, BuildRunDeps } from "../../src/build/BuildRun.js";
import { BuildRun, NotAPackageError } from "../../src/build/BuildRun.js";
import { BuildRunResult } from "../../src/build/BuildRunResult.js";

const ROOT = "/repo";
const CWD = `${ROOT}/packages/a`;
const ISSUES_PATH = `${CWD}/dist/prod/issues.json`;
const BUILD_JOURNAL = `${ROOT}/.cache/effected/build.jsonl`;
const ISSUE_JOURNAL = `${ROOT}/.cache/effected/issues.jsonl`;

const idleWatcher = Layer.succeed(JournalWatcher, { watch: () => Effect.succeed(Stream.never) });

const workspace: MemoryFileSystemSeed = {
	[`${ROOT}/package.json`]: JSON.stringify({ name: "root" }),
	[`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"\n',
	[`${CWD}/package.json`]: JSON.stringify({ name: "@scope/a", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
};

/** Every bundler side effect replaced: `issues.json` lands in the volume, and `onBuild` plays the passes. */
const seamsFor = (handle: MemoryFileSystemHandle, overrides: Partial<BundlerSeams> = {}): Partial<BundlerSeams> => ({
	readPackageJson: () => ({ name: "@scope/a", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
	readTsconfigJsx: () => ({}),
	writeTsconfig: () => "/fake/tsconfig.json",
	buildTargetGroups: async () => {},
	writeTargetsBinding: (cwd) => `${cwd}/dist/prod/targets.json`,
	runMetaPass: async () => {},
	writeIssues: ({ cwd, reports, buildOk, failure }) => {
		const path = `${cwd}/dist/prod/issues.json`;
		handle.write(
			path,
			serializeIssues(
				flattenIssues(reports, { target: "prod", generatedAt: "2026-11-06T12:00:00.000Z", buildOk, failure }),
			),
		);
		return path;
	},
	...overrides,
});

const run = (handle: MemoryFileSystemHandle, deps: Partial<BuildRunDeps> = {}) =>
	BuildRun.run(
		{ noExe: false, verbose: false },
		{ cwd: CWD, ci: false, journalWatcher: idleWatcher, seams: seamsFor(handle), ...deps },
	).pipe(Effect.provide(handle.layer));

const volume = (seed: MemoryFileSystemSeed = workspace) => MemoryFileSystem.makeHandle(seed);

// biome-ignore lint/suspicious/noExplicitAny: a raw journal line, asserted on field by field
const linesOf = (handle: MemoryFileSystemHandle, path: string): ReadonlyArray<any> =>
	(handle.volume.text(path) ?? "")
		.split("\n")
		.filter((line) => line !== "")
		.map((line) => JSON.parse(line));

describe("BuildRun.run", () => {
	it.effect("a clean build is ok, carries the report and the config sources, and is journalled at the root", () =>
		Effect.gen(function* () {
			const handle = yield* volume({ ...workspace, [`${CWD}/effected.toml`]: "" });
			const result = yield* run(handle);

			assert.instanceOf(result, BuildRunResult);
			assert.strictEqual(result.package, "@scope/a");
			assert.strictEqual(result.verdict, "ok");
			assert.strictEqual(result.issues.buildOk, true);
			assert.deepStrictEqual(result.config.sources, { package: `${CWD}/effected.toml` });
			assert.strictEqual(result.report.package, "@scope/a");

			const [line, ...rest] = linesOf(handle, BUILD_JOURNAL);
			assert.strictEqual(rest.length, 0);
			assert.strictEqual(line.scope, "@scope/a");
			assert.strictEqual(line.data.buildOk, true);
			assert.strictEqual(line.data.cwd, CWD);
			assert.strictEqual(line.data.issuesPath, ISSUES_PATH);
		}),
	);

	it.effect("a package outside any workspace journals under its own directory", () =>
		Effect.gen(function* () {
			const handle = yield* volume({ "/solo/package.json": JSON.stringify({ name: "solo" }) });
			const result = yield* run(handle, { cwd: "/solo" });

			assert.strictEqual(result.verdict, "ok");
			assert.strictEqual(linesOf(handle, "/solo/.cache/effected/build.jsonl").length, 1);
		}),
	);

	it.effect("an artifact with an error and buildOk true is failed, and its issue is journalled", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const report = BuildReport.make({
				package: "@scope/a",
				targetGroups: [
					TargetGroupReport.make({
						id: "npm",
						entries: [],
						passes: [],
						warnings: [],
						errors: [{ source: "meta", level: "error", text: "bad" }],
						suppressed: [],
						timings: { totalMs: 0 },
					}),
				],
			});
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					writeIssues: ({ cwd, buildOk }) => {
						const path = `${cwd}/dist/prod/issues.json`;
						handle.write(
							path,
							serializeIssues(
								flattenIssues([report], { target: "prod", generatedAt: "2026-11-06T12:00:00.000Z", buildOk }),
							),
						);
						return path;
					},
				}),
			});

			assert.strictEqual(result.issues.buildOk, true);
			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(linesOf(handle, BUILD_JOURNAL)[0].data.errors, 1);
			assert.strictEqual(linesOf(handle, ISSUE_JOURNAL)[0].data.text, "bad");
		}),
	);

	it.effect("a crashed build is a failed verdict rather than a failure, and the journal has its envelope", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					buildTargetGroups: async () => {
						throw new Error("tsdown exploded");
					},
				}),
			});

			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(result.issues.buildOk, false);
			assert.strictEqual(result.issues.failure?.message, "tsdown exploded");
			const [line] = linesOf(handle, BUILD_JOURNAL);
			assert.strictEqual(line.data.buildOk, false);
			assert.strictEqual(line.data.failure.message, "tsdown exploded");
		}),
	);

	it.effect("an internal error in a late pass, an ENOENT on a meta file, is a failed verdict too (#1291)", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					runMetaPass: async () => {
						throw Object.assign(
							new Error("ENOENT: no such file or directory, open '/repo/packages/a/dist/prod/npm/meta/a.api.json'"),
							{
								code: "ENOENT",
							},
						);
					},
				}),
			});

			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(result.issues.buildOk, false);
			assert.strictEqual(result.issues.errors.length, 0);
			assert.include(result.issues.failure?.message ?? "", "ENOENT");
			assert.strictEqual(linesOf(handle, BUILD_JOURNAL)[0].data.buildOk, false);
		}),
	);

	it.effect("an artifact saying buildOk false with no error and no crash is still failed (#1291)", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					writeIssues: ({ cwd, reports }) => {
						const path = `${cwd}/dist/prod/issues.json`;
						handle.write(
							path,
							serializeIssues(
								flattenIssues(reports, {
									target: "prod",
									generatedAt: "2026-11-06T12:00:00.000Z",
									buildOk: false,
									failure: { name: "Error", message: "ENOENT: a meta file" },
								}),
							),
						);
						return path;
					},
				}),
			});

			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(result.issues.errors.length, 0);
			assert.strictEqual(result.issues.failure?.message, "ENOENT: a meta file");
		}),
	);

	it.effect("a crash whose artifact never landed still answers failed, not a stale artifact's pass", () =>
		Effect.gen(function* () {
			const stale = serializeIssues(flattenIssues([], { target: "prod", generatedAt: "earlier", buildOk: true }));
			const handle = yield* volume({ ...workspace, [ISSUES_PATH]: stale });
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					buildTargetGroups: async () => {
						throw new Error("tsdown exploded");
					},
					writeIssues: () => {
						throw new Error("disk full");
					},
				}),
			});

			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(result.issues.buildOk, false);
			assert.strictEqual(result.issues.failure?.message, "tsdown exploded");
			assert.strictEqual(result.issues.package, "@scope/a");
			assert.strictEqual(linesOf(handle, BUILD_JOURNAL)[0].data.buildOk, false);
		}),
	);

	it.effect("a finished build whose artifact cannot be read back is failed, naming why", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					writeIssues: ({ cwd }) => {
						const path = `${cwd}/dist/prod/issues.json`;
						handle.write(path, "{ not json");
						return path;
					},
				}),
			});

			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(result.issues.buildOk, false);
			assert.include(result.issues.failure?.message ?? "", "issues.json");
		}),
	);

	it.effect("a finished build whose artifact write failed never takes a pass from a previous build's file", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-11-06T12:00:00.000Z"));
			const stale = serializeIssues(
				flattenIssues([], { target: "prod", generatedAt: "2026-11-06T11:59:59.999Z", buildOk: true }),
			);
			const handle = yield* volume({ ...workspace, [ISSUES_PATH]: stale });
			const result = yield* run(handle, {
				seams: seamsFor(handle, {
					writeIssues: () => {
						throw new Error("disk full");
					},
				}),
			});

			assert.strictEqual(result.verdict, "failed");
			assert.strictEqual(result.issues.buildOk, false);
			assert.include(result.issues.failure?.message ?? "", "older than this build");
			assert.strictEqual(linesOf(handle, BUILD_JOURNAL)[0].data.buildOk, false);
		}),
	);

	it.live("two builds of one package run one after the other, and both leave a clean dist (#1291)", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			let active = 0;
			let peak = 0;
			const seams = seamsFor(handle, {
				buildTargetGroups: async ({ cwd }) => {
					active += 1;
					peak = Math.max(peak, active);
					// What a second build would clobber: the first's half-written dist.
					handle.write(`${cwd}/dist/prod/npm/pkg/index.js`, "half");
					await new Promise((resolve) => setTimeout(resolve, 30));
					handle.write(`${cwd}/dist/prod/npm/pkg/index.js`, "whole");
					active -= 1;
				},
				// Stamped now: on the live clock a fixed stamp would read as an earlier build's artifact.
				writeIssues: ({ cwd, reports, buildOk, failure }) => {
					const path = `${cwd}/dist/prod/issues.json`;
					const generatedAt = new Date().toISOString();
					handle.write(
						path,
						serializeIssues(flattenIssues(reports, { target: "prod", generatedAt, buildOk, failure })),
					);
					return path;
				},
			});
			const events: Array<BuildProgress["_tag"]> = [];
			const build = run(handle, {
				seams,
				lock: { pid: 100, isAlive: () => true, pollInterval: "2 millis" },
				onProgress: (event) => Effect.sync(() => events.push(event._tag)),
			});
			const [a, b] = yield* Effect.all([build, build], { concurrency: "unbounded" });

			assert.strictEqual(peak, 1, "the bundler never ran for both at once");
			assert.strictEqual(a.verdict, "ok");
			assert.strictEqual(b.verdict, "ok");
			assert.strictEqual(handle.volume.text(`${CWD}/dist/prod/npm/pkg/index.js`), "whole");
			assert.isTrue(
				Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ buildOk: Schema.Boolean })))(
					handle.volume.text(ISSUES_PATH) ?? "",
				).buildOk,
			);
			assert.strictEqual(events.filter((tag) => tag === "Waiting").length, 1);
			assert.strictEqual(events.indexOf("Waiting") < events.lastIndexOf("Started"), true, events.join(","));
			assert.isUndefined(handle.volume.text(`${ROOT}/.cache/effected/locks/@scope+a.lock`));
			assert.strictEqual(linesOf(handle, BUILD_JOURNAL).length, 2);
		}),
	);

	it.effect("a lock held for the whole wait fails BuildLockTimeoutError, and nothing is built or journalled", () =>
		Effect.gen(function* () {
			const lock = JSON.stringify({ pid: 300, startedAt: "2026-11-10T12:00:00.000Z", cwd: CWD });
			const handle = yield* volume({ ...workspace, [`${ROOT}/.cache/effected/locks/@scope+a.lock`]: lock });
			let built = false;
			const error = yield* run(handle, {
				seams: seamsFor(handle, {
					buildTargetGroups: async () => {
						built = true;
					},
				}),
				lock: { pid: 100, isAlive: () => true, timeout: 0 },
			}).pipe(Effect.flip);

			assert.strictEqual(error._tag, "BuildLockTimeoutError");
			assert.include(error.message, "process 300");
			assert.isFalse(built);
			assert.isUndefined(handle.volume.text(BUILD_JOURNAL));
		}),
	);

	it.effect("an artifact stamped in the millisecond the build started is this build's", () =>
		Effect.gen(function* () {
			yield* TestClock.setTime(Date.parse("2026-11-06T12:00:00.000Z"));
			const result = yield* run(yield* volume());

			assert.strictEqual(result.verdict, "ok");
		}),
	);

	it.effect("an IO failure under workspace discovery stays a PlatformError, not a config fault", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(workspace, {
				faults: (base) => ({
					readFileString: (path, encoding) =>
						path.endsWith("pnpm-workspace.yaml")
							? Effect.fail(
									PlatformError.systemError({
										_tag: "PermissionDenied",
										module: "FileSystem",
										method: "readFileString",
										pathOrDescriptor: path,
									}),
								)
							: base.readFileString(path, encoding),
				}),
			});
			const error = yield* Effect.flip(run(handle));

			assert.strictEqual(error._tag, "PlatformError");
		}),
	);

	it.effect("reports Started, each pass with its group, then Done", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const events: BuildProgress[] = [];
			yield* run(handle, {
				onProgress: (event) => Effect.sync(() => events.push(event)),
				seams: seamsFor(handle, {
					buildTargetGroups: async ({ collector }) => {
						collector?.recordPassTiming("npm", "js", 1);
						collector?.recordPassTiming("npm", "dts", 1);
					},
				}),
			});

			assert.deepStrictEqual(
				events.map((event) => (event._tag === "PassDone" ? `PassDone ${event.group} ${event.pass}` : event._tag)),
				["Started", "PassDone npm js", "PassDone npm dts", "Done"],
			);
			const [started] = events;
			assert.isTrue(started?._tag === "Started" && started.package === "@scope/a");
		}),
	);

	it.effect("invalid TOML fails EffectedConfigError, and nothing is built or journalled", () =>
		Effect.gen(function* () {
			const handle = yield* volume({ ...workspace, [`${CWD}/effected.toml`]: "not = [valid" });
			const error = yield* Effect.flip(run(handle));

			assert.instanceOf(error, EffectedConfigError);
			assert.strictEqual(handle.volume.text(BUILD_JOURNAL), undefined);
			assert.strictEqual(handle.volume.text(ISSUES_PATH), undefined);
		}),
	);

	it.effect("no package.json fails NotAPackageError", () =>
		Effect.gen(function* () {
			const handle = yield* volume({ "/empty/README.md": "" });
			const error = yield* Effect.flip(run(handle, { cwd: "/empty" }));

			assert.instanceOf(error, NotAPackageError);
			assert.strictEqual(error.cwd, "/empty");
		}),
	);

	it.effect("a package.json that is not JSON fails NotAPackageError saying so", () =>
		Effect.gen(function* () {
			const handle = yield* volume({ "/broken/package.json": "{" });
			const error = yield* Effect.flip(run(handle, { cwd: "/broken" }));

			assert.instanceOf(error, NotAPackageError);
			assert.include(error.message, "/broken");
		}),
	);

	it.effect("a config the bundler rejects stays a failure of the run", () =>
		Effect.gen(function* () {
			const handle = yield* volume({
				...workspace,
				[`${CWD}/effected.toml`]: '[[package.build.overrides]]\nentries = ["nope"]\n',
			});
			const error = yield* Effect.flip(run(handle));

			assert.strictEqual(error._tag, "ConfigValidationError");
		}),
	);

	it.live("on a real filesystem the default watcher appends, and the run returns with the journals closed", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped());
			yield* fs.writeFileString(path.join(dir, "package.json"), JSON.stringify({ name: "real" }));

			const result = yield* BuildRun.run(
				{ noExe: false, verbose: false },
				{
					cwd: dir,
					ci: false,
					seams: {
						readTsconfigJsx: () => ({}),
						writeTsconfig: () => "/fake/tsconfig.json",
						buildTargetGroups: async () => {},
						writeTargetsBinding: (cwd) => `${cwd}/dist/prod/targets.json`,
						runMetaPass: async () => {},
					},
				},
			);

			assert.strictEqual(result.verdict, "ok");
			assert.strictEqual(result.issues.package, "real");
			const text = yield* fs.readFileString(path.join(dir, ".cache/effected/build.jsonl"));
			assert.strictEqual(JSON.parse(text.trimEnd()).data.package, "real");
			assert.isTrue(yield* fs.exists(path.join(dir, ".cache/effected/issues.jsonl")));
		}).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
	);

	it.effect("the result encodes to plain JSON and decodes back", () =>
		Effect.gen(function* () {
			const handle = yield* volume();
			const result = yield* run(handle);
			const encoded = yield* Schema.encodeEffect(BuildRunResult)(result);
			const decoded = yield* Schema.decodeUnknownEffect(BuildRunResult)(JSON.parse(JSON.stringify(encoded)));

			assert.strictEqual(decoded.verdict, "ok");
		}),
	);
});
