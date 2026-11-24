import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentPlugin, DefaultDiscoverStrategy } from "@vitest-agent/plugin";
import { defineConfig } from "vitest/config";

/**
 * The slow tier: CPU-heavy property and fuzz sweeps, packed-install e2e and reload tests that dominate CI time.
 *
 * @remarks
 * `EFFECTED_TEST_TIER` splits the suite. `fast` (what `ci:test` runs, with coverage and its thresholds) excludes
 * these files from discovery itself rather than through a tag filter, so the run still counts as a full run and
 * keeps its coverage thresholds. `slow` and then `timing` (what `ci:test:slow` runs in
 * `.github/workflows/slow-tests.yml`, coverage off) run only these: `slow` the files outside `TIMING_TESTS` in
 * parallel, `timing` the rest one file at a time. Unset — every local run — runs everything. A file earns a place by taking about 20 s or
 * more on a CI runner, as the heavy ones below did in the Effect 4.1.5 PR's run (#1382), or by measuring time (see
 * `TIMING_TESTS`). Paths are repo-relative,
 * and the config refuses to load when one no longer exists, so a rename cannot drop a file from both tiers.
 */
const SLOW_TESTS: ReadonlyArray<string> = [
	"packages/bundler/__test__/meta/api-extractor.int.test.ts",
	"packages/bundler/__test__/meta/generate.bundle.test.ts",
	"packages/cli/__test__/e2e/package-build.e2e.test.ts",
	"packages/commands/__test__/RunOnce.model.test.ts",
	"packages/engine/__test__/schema/ConfigLoader.reload.test.ts",
	"packages/glob/__test__/hostility.test.ts",
	"packages/lockfiles/__test__/hostile.test.ts",
	"packages/markdown-lint/__test__/hostile-inputs.test.ts",
	"packages/markdown/__test__/e2e/pathological.e2e.test.ts",
	"packages/mcp/__test__/schema-tools.reload.test.ts",
	"packages/plugin/__test__/e2e/packed-install.e2e.test.ts",
	"packages/shell/__test__/ShellScript.test.ts",
	"packages/shell/__test__/hostile.test.ts",
	"packages/walker/__test__/PatternBoundsSweep.test.ts",
	"packages/workspaces/__test__/e2e/PackedInstall.e2e.test.ts",
];

/**
 * The slow files that assert a timing ratio or a wall-clock ceiling, run alone rather than beside the rest of the slow
 * tier. A file that measures time belongs here whatever its own run time.
 *
 * @remarks
 * Each bounds a growth ratio between a small and a large input, or an absolute time, so a busy runner can push a
 * linear parse past its bound: run in parallel with the other slow files, the shell units failed two of four Slow Tests runs, each just
 * past it (#1387). `slow` skips these, and `timing` runs only these with `fileParallelism` off, so no other file
 * shares the runner while they measure. Every entry must also be in `SLOW_TESTS`, or the config refuses to load.
 */
const TIMING_TESTS: ReadonlyArray<string> = [
	"packages/markdown-lint/__test__/hostile-inputs.test.ts",
	"packages/shell/__test__/ShellScript.test.ts",
	"packages/shell/__test__/hostile.test.ts",
];

const TIERS = ["fast", "slow", "timing"] as const;
type Tier = (typeof TIERS)[number];

const testTier = (): Tier | undefined => {
	const tier = process.env.EFFECTED_TEST_TIER;
	if (tier === undefined || tier === "") return undefined;
	if ((TIERS as ReadonlyArray<string>).includes(tier)) return tier as Tier;
	throw new Error(`EFFECTED_TEST_TIER must be one of ${TIERS.join(", ")} or unset, got ${JSON.stringify(tier)}`);
};

export default async () => {
	const root = fileURLToPath(new URL(".", import.meta.url));
	const missing = SLOW_TESTS.filter((file) => !existsSync(join(root, file)));
	if (missing.length > 0) {
		throw new Error(`vitest.config.ts SLOW_TESTS names files that do not exist:\n  ${missing.join("\n  ")}`);
	}
	const strays = TIMING_TESTS.filter((file) => !SLOW_TESTS.includes(file));
	if (strays.length > 0) {
		throw new Error(`vitest.config.ts TIMING_TESTS names files missing from SLOW_TESTS:\n  ${strays.join("\n  ")}`);
	}
	const tier = testTier();
	/** The files of `list` a project owns, absolute: under its directory, or the root's own `__test__/`. */
	const ownedBy = (list: ReadonlyArray<string>, projectPath: string): ReadonlyArray<string> => {
		const rel = relative(root, projectPath);
		const prefix = rel === "" ? `__test__${sep}` : `${rel}${sep}`;
		return list.filter((file) => file.split("/").join(sep).startsWith(prefix)).map((file) => join(root, file));
	};
	const slowFilesOf = (projectPath: string): ReadonlyArray<string> => ownedBy(SLOW_TESTS, projectPath);
	/** The slow tier proper: the slow files minus the timing ones, which run alone. */
	const slowOnlyOf = (projectPath: string): ReadonlyArray<string> =>
		ownedBy(
			SLOW_TESTS.filter((file) => !TIMING_TESTS.includes(file)),
			projectPath,
		);
	const timingFilesOf = (projectPath: string): ReadonlyArray<string> => ownedBy(TIMING_TESTS, projectPath);
	// Scratchpad is a local-only probe venue: discovered as a normal project on
	// dev machines, invisible to ci:test.
	const strategy = new DefaultDiscoverStrategy().extend({
		buildProject: async (input, inherited) => {
			if (input.name === "scratchpad" && process.env.CI) return null;
			if (inherited === null) return null;
			const slow = slowFilesOf(input.path);
			const slowOnly = slowOnlyOf(input.path);
			const timing = timingFilesOf(input.path);
			if (tier === "slow" && slowOnly.length === 0) return null;
			if (tier === "timing" && timing.length === 0) return null;
			const test = {
				...inherited.test,
				...(tier === "fast" ? { exclude: [...(inherited.test?.exclude ?? []), ...slow] } : {}),
				...(tier === "slow" ? { include: [...slowOnly] } : {}),
				...(tier === "timing" ? { include: [...timing] } : {}),
				env: {
					...inherited.test?.env,
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
			// The timing tier measures growth ratios: one file at a time, so no other file shares the runner (#1387).
			...(tier === "timing" ? { fileParallelism: false } : {}),
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
