// `effected package build` as `bin.ts` runs it, under `CliRuntime.main`, with the bundler's side effects replaced
// through `PackageCommandDeps.seams` and `issues.json` landing in the memfs volume the engine reads it back from.
import { assert, describe, it } from "@effect/vitest";
import { JournalWatcher } from "@effected/jsonl";
import type { MemoryFileSystemHandle, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, ConfigProvider, Effect, Exit, Layer, Runtime, Stream } from "effect";
import { TestConsole } from "effect/testing";
import type { PackageCommandDeps } from "../src/commands/package/execute.js";
import { run } from "../src/main.js";
import { environment } from "./schema/harness.js";

const CWD = "/repo/packages/a";
const CONFIG = `${CWD}/effected.toml`;
const SUMMARY = "/summary.md";

const idleWatcher = Layer.succeed(JournalWatcher, { watch: () => Effect.succeed(Stream.never) });

const workspace: MemoryFileSystemSeed = {
	"/repo/package.json": JSON.stringify({ name: "root" }),
	"/repo/pnpm-workspace.yaml": 'packages:\n  - "packages/*"\n',
	[`${CWD}/package.json`]: JSON.stringify({ name: "@scope/a", version: "1.0.0" }),
};

type Seams = NonNullable<PackageCommandDeps["seams"]>;
type BuildTargetGroups = NonNullable<Seams["buildTargetGroups"]>;
type RunMetaPass = NonNullable<Seams["runMetaPass"]>;
type Diagnostics = (collector: NonNullable<Parameters<BuildTargetGroups>[0]["collector"]>) => void;

/** What the bundler's `writeIssues` writes, from the same reports, without reaching past the engine for it. */
const issuesOf = (
	reports: Parameters<NonNullable<Seams["writeIssues"]>>[0]["reports"],
	buildOk: boolean,
	failure: { readonly name?: string | undefined; readonly message: string } | undefined,
) => {
	const groups = reports.flatMap((report) => report.targetGroups);
	return JSON.stringify({
		generatedAt: "2026-11-06T12:00:00.000Z",
		package: reports[0]?.package ?? "unknown",
		target: "prod",
		buildOk,
		...(failure !== undefined ? { failure } : {}),
		warnings: groups.flatMap((group) => group.warnings),
		errors: groups.flatMap((group) => group.errors),
		suppressed: groups.flatMap((group) => group.suppressed),
	});
};

/** Every bundler side effect replaced; `diagnose` plays what the JS pass records. */
const seamsFor = (handle: MemoryFileSystemHandle, diagnose: Diagnostics = () => {}, overrides: Seams = {}): Seams => ({
	readPackageJson: () => ({ name: "@scope/a", version: "1.0.0", exports: { ".": "./src/index.ts" } }),
	readTsconfigJsx: () => ({}),
	writeTsconfig: () => "/fake/tsconfig.json",
	buildTargetGroups: async ({ collector }) => {
		if (collector !== undefined) diagnose(collector);
	},
	writeTargetsBinding: (cwd) => `${cwd}/dist/prod/targets.json`,
	runMetaPass: async () => {},
	writeIssues: ({ cwd, reports, buildOk, failure }) => {
		const path = `${cwd}/dist/prod/issues.json`;
		handle.write(path, issuesOf(reports, buildOk, failure));
		return path;
	},
	...overrides,
});

const cli = (
	args: ReadonlyArray<string>,
	options: {
		readonly seed?: MemoryFileSystemSeed;
		readonly env?: Record<string, string>;
		readonly diagnose?: Diagnostics;
		readonly seams?: Seams;
		readonly deps?: Partial<PackageCommandDeps>;
	} = {},
) =>
	Effect.gen(function* () {
		const handle = yield* MemoryFileSystem.makeHandle(options.seed ?? workspace);
		const exit = yield* Effect.exit(
			run(
				{},
				{
					cwd: CWD,
					ci: false,
					journalWatcher: idleWatcher,
					seams: seamsFor(handle, options.diagnose, options.seams),
					...options.deps,
				},
				environment(["package", "build", ...args], handle.layer),
			).pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: options.env ?? {} })))),
		);
		const code = Exit.isFailure(exit) ? Runtime.getErrorExitCode(Cause.squash(exit.cause)) : 0;
		// One line per entry: a `Doc.print` is one call with its breaks embedded.
		const outText = (yield* TestConsole.logLines).map(String).join("\n");
		const errText = (yield* TestConsole.errorLines).map(String).join("\n");
		return { code, out: outText === "" ? [] : outText.split("\n"), outText, errText, volume: handle.volume };
	});

const failing: Diagnostics = (collector) => {
	collector.recordError("npm", {
		source: "api-extractor",
		level: "error",
		code: "ae-missing-release-tag",
		text: "no tag",
		file: "src/a.ts",
		line: 3,
		column: 7,
	});
	collector.recordWarning("npm", { source: "tsdown", level: "warn", text: "a warning" });
	collector.recordSuppressed("npm", { source: "api-extractor", level: "warn", text: "hidden" });
};

describe("effected package build", () => {
	it.effect("a clean build exits 0 and ends on the summary line", () =>
		Effect.gen(function* () {
			const { code, out, errText, volume } = yield* cli([]);
			assert.strictEqual(code, 0, errText);
			assert.strictEqual(out.at(-1), "built @scope/a: 0 errors, 0 warnings, 0 suppressed");
			assert.isDefined(volume.text("/repo/.cache/effected/build.jsonl"));
		}),
	);

	it.effect("errors print before warnings, each with its location and code, and exit 1 says why", () =>
		Effect.gen(function* () {
			const { code, outText, errText } = yield* cli([], { diagnose: failing });
			assert.strictEqual(code, 1);
			const error = outText.indexOf("src/a.ts:3:7 ae-missing-release-tag no tag");
			const warning = outText.indexOf("a warning");
			assert.isAtLeast(error, 0, outText);
			assert.isAbove(warning, error);
			assert.include(outText, "built @scope/a: 1 errors, 1 warnings, 1 suppressed");
			assert.notInclude(outText, "hidden");
			assert.include(errText, "1 error");
		}),
	);

	it.effect("a crash is exit 1 carrying the failure's message", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], {
				seams: {
					buildTargetGroups: async () => {
						throw new Error("tsdown exploded");
					},
				},
			});
			assert.strictEqual(code, 1);
			assert.include(errText, "tsdown exploded");
		}),
	);

	it.effect("a config with an unknown key exits 2 naming the file and the key", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], {
				seed: { ...workspace, [CONFIG]: '[package.build]\nformats = ["esm"]\n' },
			});
			assert.strictEqual(code, 2);
			assert.include(errText, CONFIG);
			assert.include(errText, "package.build.formats");
		}),
	);

	it.effect("TOML that does not parse exits 2 naming the file", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], { seed: { ...workspace, [CONFIG]: "not = [valid" } });
			assert.strictEqual(code, 2);
			assert.include(errText, CONFIG);
		}),
	);

	it.effect("a plugin that will not load exits 2 naming its path", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], {
				seed: { ...workspace, [CONFIG]: '[package.build]\nplugins = ["./nope.ts"]\n' },
				deps: { importModule: () => Promise.reject(new Error("no such module")) },
			});
			assert.strictEqual(code, 2);
			assert.include(errText, `${CWD}/nope.ts`);
		}),
	);

	it.effect("a directory with no package.json exits 2 naming it", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], { seed: { "/repo/pnpm-workspace.yaml": "" } });
			assert.strictEqual(code, 2);
			assert.include(errText, CWD);
		}),
	);

	it.effect("a config the bundler rejects exits 2", () =>
		Effect.gen(function* () {
			const { code, errText } = yield* cli([], {
				seed: { ...workspace, [CONFIG]: '[[package.build.overrides]]\nentries = ["nope"]\n' },
			});
			assert.strictEqual(code, 2);
			assert.include(errText, "overrides");
		}),
	);

	it.effect("an IO failure is the infrastructure tier: exit 3", () =>
		Effect.gen(function* () {
			const { code } = yield* cli([], {
				// Parents as files: the journal's directory cannot be made.
				seed: { ...workspace, "/repo/.cache": "a file" },
			});
			assert.strictEqual(code, 3);
		}),
	);

	it.effect("an unknown flag is usage: exit 64", () =>
		Effect.gen(function* () {
			const { code } = yield* cli(["--no-such-flag"]);
			assert.strictEqual(code, 64);
		}),
	);

	it.effect("--format json writes exactly one parseable document, with the human lines on stderr", () =>
		Effect.gen(function* () {
			const { code, out, errText } = yield* cli(["--format", "json"], { diagnose: failing });
			assert.strictEqual(code, 1);
			assert.lengthOf(out, 1);
			const document = JSON.parse(out[0] as string) as {
				readonly package: string;
				readonly verdict: string;
				readonly issues: { readonly errors: ReadonlyArray<unknown> };
				readonly report: { readonly package: string };
			};
			assert.strictEqual(document.package, "@scope/a");
			assert.strictEqual(document.verdict, "failed");
			assert.lengthOf(document.issues.errors, 1);
			assert.strictEqual(document.report.package, "@scope/a");
			assert.include(errText, "built @scope/a");
		}),
	);

	it.effect("an agent gets JSON without asking, and an explicit human wins", () =>
		Effect.gen(function* () {
			const agent = yield* cli(["--agent"]);
			assert.doesNotThrow(() => JSON.parse(agent.out.at(-1) as string));
			const human = yield* cli(["--agent", "--format", "human"]);
			assert.include(human.outText, "built @scope/a");
		}),
	);

	it.effect("--no-exe skips the compile, and it runs without the flag", () =>
		Effect.gen(function* () {
			const exe = {
				readPackageJson: () => ({
					name: "@scope/a",
					version: "1.0.0",
					os: ["darwin"],
					cpu: ["arm64"],
					exports: { ".": "./src/index.ts", "./bin": "./src/bin.ts" },
				}),
			};
			const seed = { ...workspace, [CONFIG]: '[package.build.exe]\nfileName = "a"\n' };
			let compiles = 0;
			const runExeBuild = async () => {
				compiles++;
			};
			const skipped = yield* cli(["--no-exe"], { seed, seams: { ...exe, runExeBuild } });
			assert.strictEqual(skipped.code, 0, skipped.errText);
			assert.strictEqual(compiles, 0);
			const built = yield* cli([], { seed, seams: { ...exe, runExeBuild } });
			assert.strictEqual(built.code, 0, built.errText);
			assert.strictEqual(compiles, 1);
		}),
	);

	it.effect("--verbose reaches the passes, and is off by default", () =>
		Effect.gen(function* () {
			const seen: Array<boolean | undefined> = [];
			const buildTargetGroups: BuildTargetGroups = async ({ verbose }) => {
				seen.push(verbose);
			};
			yield* cli([], { seams: { buildTargetGroups } });
			yield* cli(["--verbose"], { seams: { buildTargetGroups } });
			assert.deepStrictEqual(seen, [false, true]);
		}),
	);

	it.effect("deps.ci reaches the build: it resolves an optimistic auto", () =>
		Effect.gen(function* () {
			const seen: Array<boolean> = [];
			const runMetaPass: RunMetaPass = async ({ ci }) => {
				seen.push(ci);
			};
			yield* cli([], { seams: { runMetaPass }, deps: { ci: true } });
			assert.deepStrictEqual(seen, [true]);
		}),
	);

	it.effect("under CI the annotations follow the document on stdout", () =>
		Effect.gen(function* () {
			const { out } = yield* cli(["--ci"], { diagnose: failing });
			const summary = out.findIndex((line) => line.includes("built @scope/a"));
			const annotation = out.findIndex((line) => line.startsWith("::error "));
			assert.isAtLeast(summary, 0);
			assert.isAbove(annotation, summary);
			assert.isTrue(out.some((line) => line.startsWith("::warning ")));
		}),
	);

	it.effect("nobody but CI gets annotations", () =>
		Effect.gen(function* () {
			const { outText, errText } = yield* cli([], { diagnose: failing });
			assert.notInclude(outText, "::error");
			assert.notInclude(errText, "::error");
		}),
	);

	it.effect("under CI with --format json, stdout stays one document and the annotations go to stderr", () =>
		Effect.gen(function* () {
			const { out, errText } = yield* cli(["--ci", "--format", "json"], { diagnose: failing });
			assert.lengthOf(out, 1);
			assert.doesNotThrow(() => JSON.parse(out[0] as string));
			assert.include(errText, "::error ");
		}),
	);

	it.effect("the step summary is appended when the environment names one", () =>
		Effect.gen(function* () {
			const { volume } = yield* cli([], { diagnose: failing, env: { GITHUB_STEP_SUMMARY: SUMMARY } });
			const summary = volume.text(SUMMARY) ?? "";
			assert.include(summary, "### effected package build");
			assert.include(summary, "built @scope/a: 1 errors, 1 warnings, 1 suppressed");
			assert.include(summary, "src/a.ts:3:7 ae-missing-release-tag no tag");
		}),
	);

	it.effect("a diagnostic cannot repaint the terminal", () =>
		Effect.gen(function* () {
			const { outText } = yield* cli([], {
				diagnose: (collector) =>
					collector.recordWarning("npm", { source: "tsdown", level: "warn", text: "bad\u001b[2Jtext" }),
			});
			assert.notInclude(outText, "\u001b[2J");
			assert.include(outText, "built @scope/a");
		}),
	);
});
