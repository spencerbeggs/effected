// `package_build` in process, with the bundler's side effects replaced and `issues.json` landing in the memfs volume the
// engine reads it back from.
import { assert, describe, it } from "@effect/vitest";
import { JournalWatcher } from "@effected/jsonl";
import { McpHarness } from "@effected/mcp-kit/testing";
import type { MemoryFileSystemHandle, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { SERVER_INSTRUCTIONS, ServerLayer } from "../../src/server.js";
import type { PackageToolOptions } from "../../src/tools/package.js";

const ROOT = "/repo";
const CWD = `${ROOT}/packages/a`;

const idleWatcher = Layer.succeed(JournalWatcher, { watch: () => Effect.succeed(Stream.never) });

const workspace: MemoryFileSystemSeed = {
	[`${ROOT}/package.json`]: JSON.stringify({ name: "root" }),
	[`${ROOT}/pnpm-workspace.yaml`]: 'packages:\n  - "packages/*"\n',
	[`${CWD}/package.json`]: JSON.stringify({ name: "@scope/a", version: "1.0.0" }),
};

type Seams = NonNullable<PackageToolOptions["seams"]>;

interface ToolResult {
	readonly isError?: boolean;
	readonly structuredContent?: {
		readonly verdict?: string;
		readonly package?: string;
		readonly issues?: { readonly buildOk?: boolean; readonly failure?: { readonly message?: string } };
	};
	readonly content?: ReadonlyArray<{ readonly text?: string }>;
}

const resultOf = (response: { readonly result?: unknown }): ToolResult => response.result as ToolResult;
const textOf = (result: ToolResult): string => result.content?.map((part) => part.text ?? "").join("") ?? "";

const seamsFor = (handle: MemoryFileSystemHandle, overrides: Seams = {}): Seams => ({
	readPackageJson: () => ({ name: "@scope/a", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
	readTsconfigJsx: () => ({}),
	writeTsconfig: () => "/fake/tsconfig.json",
	buildTargetGroups: async () => {},
	writeTargetsBinding: (cwd) => `${cwd}/dist/prod/targets.json`,
	runMetaPass: async () => {},
	writeIssues: ({ cwd, reports, buildOk, failure }) => {
		const path = `${cwd}/dist/prod/issues.json`;
		const groups = reports.flatMap((report) => report.targetGroups);
		handle.write(
			path,
			JSON.stringify({
				generatedAt: "2026-11-06T12:00:00.000Z",
				package: reports[0]?.package ?? "unknown",
				target: "prod",
				buildOk,
				...(failure !== undefined ? { failure } : {}),
				warnings: groups.flatMap((group) => group.warnings),
				errors: groups.flatMap((group) => group.errors),
				suppressed: groups.flatMap((group) => group.suppressed),
			}),
		);
		return path;
	},
	...overrides,
});

const serve = (
	options: {
		readonly seed?: MemoryFileSystemSeed;
		readonly cwd?: string;
		readonly seams?: Seams;
		readonly tool?: Partial<PackageToolOptions>;
	} = {},
) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(options.seed ?? workspace);
		const services = yield* Layer.build(handle.layer);
		const harness = yield* McpHarness.make(
			ServerLayer({
				cwd: options.cwd ?? CWD,
				journalWatcher: idleWatcher,
				seams: seamsFor(handle, options.seams),
				...options.tool,
			}),
			{ services },
		);
		yield* harness.initialize;
		return { harness, volume: handle.volume };
	});

const crash: Seams = {
	buildTargetGroups: async () => {
		throw new Error("tsdown exploded");
	},
};

describe("package_build", () => {
	it.effect("is listed with its output schema and its annotations, and the instructions name it", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve();
			const tool = (yield* harness.listTools).find((candidate) => candidate.name === "package_build") as unknown as {
				readonly outputSchema?: unknown;
				readonly annotations?: { readonly readOnlyHint?: boolean; readonly idempotentHint?: boolean };
			};
			assert.include(JSON.stringify(tool.outputSchema ?? {}), '"verdict"');
			assert.strictEqual(tool.annotations?.readOnlyHint, false);
			assert.strictEqual(tool.annotations?.idempotentHint, true);
			assert.include(SERVER_INSTRUCTIONS, "package_build");
		}).pipe(Effect.scoped),
	);

	it.effect(
		"an ok build is a result, built where the server started when no cwd is given, and journalled at the root",
		() =>
			Effect.gen(function* () {
				const { harness, volume } = yield* serve();
				const result = resultOf(yield* harness.callTool("package_build", {}));
				assert.strictEqual(result.isError ?? false, false, textOf(result));
				assert.strictEqual(result.structuredContent?.verdict, "ok");
				assert.strictEqual(result.structuredContent?.package, "@scope/a");
				assert.isDefined(volume.text(`${CWD}/dist/prod/issues.json`));
				assert.isDefined(volume.text(`${ROOT}/.cache/effected/build.jsonl`));
			}).pipe(Effect.scoped),
	);

	it.effect("a relative cwd resolves against the workspace root, not the server's directory", () =>
		Effect.gen(function* () {
			const { harness, volume } = yield* serve({
				seed: { ...workspace, [`${ROOT}/packages/b/package.json`]: JSON.stringify({ name: "@scope/b" }) },
			});
			const result = resultOf(yield* harness.callTool("package_build", { cwd: "packages/b" }));
			assert.strictEqual(result.structuredContent?.verdict, "ok", textOf(result));
			assert.isDefined(volume.text(`${ROOT}/packages/b/dist/prod/issues.json`));
		}).pipe(Effect.scoped),
	);

	it.effect("a failed verdict is a result, not an error", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({ seams: crash });
			const result = resultOf(yield* harness.callTool("package_build", {}));
			assert.strictEqual(result.isError ?? false, false, textOf(result));
			assert.strictEqual(result.structuredContent?.verdict, "failed");
			assert.strictEqual(result.structuredContent?.issues?.buildOk, false);
			assert.strictEqual(result.structuredContent?.issues?.failure?.message, "tsdown exploded");
		}).pipe(Effect.scoped),
	);

	it.effect("a cwd outside the workspace root is refused before anything runs", () =>
		Effect.gen(function* () {
			let builds = 0;
			const { harness } = yield* serve({
				seed: { ...workspace, "/elsewhere/package.json": JSON.stringify({ name: "x" }) },
				seams: {
					buildTargetGroups: async () => {
						builds++;
					},
				},
			});
			for (const cwd of ["/elsewhere", "../elsewhere"]) {
				const result = resultOf(yield* harness.callTool("package_build", { cwd }));
				assert.isTrue(result.isError, cwd);
				assert.include(textOf(result), "outside the workspace root");
			}
			assert.strictEqual(builds, 0);
		}).pipe(Effect.scoped),
	);

	it.effect("a bad effected.toml is refused with the file in the hint", () =>
		Effect.gen(function* () {
			const toml = `${CWD}/effected.toml`;
			const { harness } = yield* serve({ seed: { ...workspace, [toml]: '[package.build]\nformats = ["esm"]\n' } });
			const result = resultOf(yield* harness.callTool("package_build", {}));
			assert.isTrue(result.isError);
			assert.include(textOf(result), "package.build.formats");
			assert.include(textOf(result), `Fix ${toml}`);
		}).pipe(Effect.scoped),
	);

	it.effect("a plugin that will not load is refused with its path in the hint", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({
				seed: { ...workspace, [`${CWD}/effected.toml`]: '[package.build]\nplugins = ["./nope.ts"]\n' },
				tool: { importModule: () => Promise.reject(new Error("no such module")) },
			});
			const result = resultOf(yield* harness.callTool("package_build", {}));
			assert.isTrue(result.isError);
			assert.include(textOf(result), "no such module");
			assert.include(textOf(result), `Fix ${CWD}/nope.ts`);
		}).pipe(Effect.scoped),
	);

	it.effect("a directory that is no package is refused", () =>
		Effect.gen(function* () {
			const { harness } = yield* serve({ seed: { [`${ROOT}/pnpm-workspace.yaml`]: "", [`${ROOT}/empty/.keep`]: "" } });
			const result = resultOf(yield* harness.callTool("package_build", { cwd: "empty" }));
			assert.isTrue(result.isError);
			assert.include(textOf(result), `${ROOT}/empty is not a package`);
		}).pipe(Effect.scoped),
	);

	it.effect("noExe reaches the build, and defaults to compiling", () =>
		Effect.gen(function* () {
			let compiles = 0;
			const { harness } = yield* serve({
				seed: { ...workspace, [`${CWD}/effected.toml`]: '[package.build.exe]\nfileName = "a"\n' },
				seams: {
					readPackageJson: () => ({
						name: "@scope/a",
						version: "1.0.0",
						os: ["darwin"],
						cpu: ["arm64"],
						exports: { ".": "./src/index.ts", "./bin": "./src/bin.ts" },
					}),
					runExeBuild: async () => {
						compiles++;
					},
				},
			});
			yield* harness.callTool("package_build", { noExe: true });
			assert.strictEqual(compiles, 0);
			yield* harness.callTool("package_build", {});
			assert.strictEqual(compiles, 1);
		}).pipe(Effect.scoped),
	);

	it.effect("the ci option reaches the build", () =>
		Effect.gen(function* () {
			const seen: Array<boolean> = [];
			const { harness } = yield* serve({
				seams: {
					runMetaPass: async ({ ci }) => {
						seen.push(ci);
					},
				},
				tool: { ci: true },
			});
			yield* harness.callTool("package_build", {});
			assert.deepStrictEqual(seen, [true]);
		}).pipe(Effect.scoped),
	);

	it.effect("two builds never overlap: the second waits for the lane", () =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			let started = 0;
			const { harness } = yield* serve({
				seams: {
					buildTargetGroups: () => {
						started++;
						return Effect.runPromise(Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)));
					},
				},
			});
			const first = yield* Effect.forkChild(harness.callTool("package_build", {}));
			yield* Deferred.await(entered);
			const second = yield* Effect.forkChild(harness.callTool("package_build", {}));
			for (let turn = 0; turn < 50; turn++) yield* Effect.yieldNow;
			assert.strictEqual(started, 1, "the second build started while the first held the lane");
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(first);
			yield* Fiber.join(second);
			assert.strictEqual(started, 2);
		}).pipe(Effect.scoped),
	);

	it.effect("a call is confined: the build runs under confineStdout", () =>
		Effect.gen(function* () {
			let confined = 0;
			const { harness } = yield* serve({
				tool: {
					confineStdout: (self) =>
						Effect.suspend(() => {
							confined++;
							return self;
						}),
				},
			});
			yield* harness.callTool("package_build", {});
			assert.strictEqual(confined, 1);
		}).pipe(Effect.scoped),
	);
});
