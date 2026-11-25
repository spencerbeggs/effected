import { existsSync, globSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentPlugin, DefaultDiscoverStrategy, Tag } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";
import {
	DEPTH_SUFFIXES,
	isHostile,
	parseDepth,
	parseTier,
	projectSelection,
	validateLists,
} from "./lib/scripts/test-tiers.js";

/**
 * The slow tier: packed-install e2es, reload tests, bundle tests and sweeps that dominate CI time by their nature.
 *
 * @remarks
 * `EFFECTED_TEST_TIER` splits the suite, and `lib/scripts/test-tiers.ts` holds the rules. `fast` (what `ci:test`
 * runs, with coverage and its thresholds) excludes these files and the hostile ones from discovery itself rather
 * than through a tag filter, so the run still counts as a full run and keeps its coverage thresholds. `slow` and
 * then `hostile` (what `ci:test:slow` runs in `.github/workflows/slow-tests.yml`, coverage off) run only these and
 * only the hostile files. `full` (`ci:test:full`) runs only the depth-aware files at full depth. Unset, every local
 * run, runs everything but the hostile files.
 *
 * A file earns a place here by taking about 20 s or more on a CI runner, as the heavy ones below did in the Effect
 * 4.1.5 PR's run (#1382). A hostile file never belongs here: its `.hostile.test.ts` suffix already places it.
 * Paths are repo-relative, and the config refuses to load when one no longer exists, so a rename cannot drop a file
 * from both tiers.
 */
const SLOW_TESTS: ReadonlyArray<string> = [
	"packages/bundler/__test__/meta/api-extractor.int.test.ts",
	"packages/bundler/__test__/meta/generate.bundle.test.ts",
	"packages/cli/__test__/e2e/package-build.e2e.test.ts",
	"packages/commands/__test__/RunOnce.model.test.ts",
	"packages/engine/__test__/schema/ConfigLoader.reload.test.ts",
	"packages/lockfiles/__test__/hostile.test.ts",
	"packages/mcp/__test__/schema-tools.reload.test.ts",
	"packages/plugin/__test__/e2e/packed-install.e2e.test.ts",
	"packages/walker/__test__/PatternBoundsSweep.test.ts",
	"packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts",
];

/**
 * The legacy timing list, being drained: slow files that measure time and are not yet renamed to
 * `.hostile.test.ts`. They run in the `hostile` tier beside the files that suffix selects, one file at a time
 * (#1387), and nowhere else.
 *
 * @remarks
 * A file that measures time takes the suffix instead of an entry here (#1415). Every entry must also be in
 * `SLOW_TESTS`, or the config refuses to load. The list is deleted when it is empty.
 */
const TIMING_TESTS: ReadonlyArray<string> = [];

export default async () => {
	const root = fileURLToPath(new URL(".", import.meta.url));
	validateLists({
		slow: SLOW_TESTS,
		legacyTiming: TIMING_TESTS,
		exists: (file) => existsSync(join(root, file)),
	});
	// Read here so a mistyped depth stops every run, including one whose files never read it.
	parseDepth(process.env.EFFECTED_TEST_DEPTH);
	const tier = parseTier(process.env.EFFECTED_TEST_TIER);
	/** The files of `list` a project owns, absolute: under its directory, or the root's own `__test__/`. */
	const ownedBy = (list: ReadonlyArray<string>, projectPath: string): ReadonlyArray<string> => {
		const rel = relative(root, projectPath);
		const prefix = rel === "" ? `__test__${sep}` : `${rel}${sep}`;
		return list.filter((file) => file.split("/").join(sep).startsWith(prefix)).map((file) => join(root, file));
	};
	/** Every test file a project has, absolute. Tests live in `__test__/`, in a package and at the root alike. */
	const testFilesOf = (projectPath: string): ReadonlyArray<string> =>
		globSync("__test__/**/*.test.{ts,tsx}", { cwd: projectPath }).map((file) => join(projectPath, file));
	/** The tag a file's name gives it, beside whatever the plugin's own classifier gave. */
	const kindOf = (filename: string): ReadonlyArray<string> => {
		if (isHostile(filename)) return ["hostile"];
		const suffix = DEPTH_SUFFIXES.find((each) => filename.endsWith(each) || filename.endsWith(`${each}x`));
		return suffix === undefined ? [] : [suffix.split(".")[1] as string];
	};
	// Scratchpad is a local-only probe venue: discovered as a normal project on
	// dev machines, invisible to ci:test.
	const strategy = new DefaultDiscoverStrategy().extend({
		// A hostile file's growth checks repeat a workload until it can be timed, so the tag gives each test a minute:
		// the bound is the ratio, and the timeout only stops a reintroduced exponential from hanging the run.
		additionalTags: [
			Tag.make("hostile", { timeout: 60_000 }),
			Tag.make("parity"),
			Tag.make("corpus"),
			Tag.make("property"),
		],
		classify: (ctx) => [...ctx.inherited, ...kindOf(ctx.module.filename)],
		buildProject: async (input, inherited) => {
			if (input.name === "scratchpad" && process.env.CI) return null;
			if (inherited === null) return null;
			const selection = projectSelection({
				tier,
				slow: ownedBy(
					SLOW_TESTS.filter((file) => !TIMING_TESTS.includes(file)),
					input.path,
				),
				legacyTiming: ownedBy(TIMING_TESTS, input.path),
				files: testFilesOf(input.path),
			});
			if (selection === null) return null;
			const test = {
				...inherited.test,
				...(selection.exclude ? { exclude: [...(inherited.test?.exclude ?? []), ...selection.exclude] } : {}),
				...(selection.include ? { include: [...selection.include] } : {}),
				env: {
					...inherited.test?.env,
					...selection.env,
					// pnpm sets this for the bootstrap, resolved from each process's cwd, so a child a test starts in a scratch
					// directory dies on it. A test that runs sibling source in a child loads tsx itself.
					NODE_OPTIONS: "",
					// Linked source has no bundler define, and its 0.0.0 fallback makes the version comparison skip itself.
					__PACKAGE_VERSION__: "0.0.0-source",
				},
			};
			// @effected/cli-kit registers its own snapshot serializer the way a consumer does: through the config, by the
			// module whose default export it is, never with expect.addSnapshotSerializer (effected#909).
			if (input.name === "@effected/cli-kit") {
				return {
					...inherited,
					test: {
						...test,
						snapshotSerializers: [
							fileURLToPath(new URL("packages/cli-kit/src/ui-testing-serializer.ts", import.meta.url)),
						],
					},
				};
			}
			return { ...inherited, test };
		},
	});
	const { projects, tags } = await AgentPlugin.discover(strategy);
	return defineConfig({
		plugins: [
			AgentPlugin({
				console: {
					human: "stream",
					agent: "agent",
				},
				coverageTargets: AgentPlugin.COVERAGE_LEVELS.basic.coverageTargets,
				// The same strategy discovery used, so the transform that tags each test file knows the kinds a file's
				// name gives it: left out, the plugin tags with its own default strategy, and a hostile file never gets
				// the `hostile` tag or its timeout.
				discoverStrategy: strategy,
				// CI runners are ephemeral: nothing reads the SQLite history there, and persisting it plus the
				// follow-on scan cost about 24 s per run (vitest-agent#568). `persist` is opt-out by design and
				// never reads CI itself, so the decision lives here. Console summary, job summary, coverage
				// analysis and the exit code are unchanged; VITEST_AGENT_PERSIST still overrides either way.
				...(process.env.CI ? { persist: false } : {}),
			}),
		],
		test: {
			...(projects ? { projects } : {}),
			tags,
			pool: "forks",
			// The hostile tier measures growth ratios: one file at a time, so no other file shares the runner (#1387).
			...(tier === "hostile" ? { fileParallelism: false } : {}),
			// Resolved against THIS file, not the cwd. A bare relative path here
			// resolves against wherever vitest was invoked, so a run from inside a
			// package that points `--config` here dies with
			// `Failed to load url .../packages/<pkg>/vitest.setup.ts`
			// — an error that reads as a missing file you were meant to create,
			// whose tempting "fix" is to create a per-package setup and fork it
			// permanently (effected#455).
			//
			// Vitest does NOT walk up to this config: run from inside a package it
			// uses that directory as its root with no repo config. Measured from
			// inside `packages/lockfiles`:
			//   vitest run                               -> that package only, default reporter, exit 0
			//   vitest run --project @effected/lockfiles -> "No projects matched the filter", exit 1
			//   vitest run packages/lockfiles            -> "No test files found", exit 1
			// From the repo root, `--project <name>` selects one project, and a
			// POSITIONAL filter is a substring of each test file's path (`ckfiles`
			// selects lockfiles). Run from the root; prefer `--project <name>`.
			globalSetup: [fileURLToPath(new URL("vitest.setup.ts", import.meta.url))],
			coverage: {
				enabled: true,
				provider: "v8",
				thresholds: AgentPlugin.COVERAGE_LEVELS.basic.thresholds,
				// Our own sources only. Without an include, the coverage-target scan listed dependency files
				// (node_modules/.pnpm/...) as "below target" (effected#945).
				include: ["packages/*/src/**/*.{ts,tsx,mts,cts}", "lib/scripts/**/*.ts"],
				// The catalog plugin's source imports rolldown-pnpm-config's build-only virtual modules,
				// so no test can load it; its suite exercises the built pnpmfile instead.
				exclude: ["scratchpad/**", "packages/pnpm-plugin-effected/src/**"],
			},
		},
	});
};
