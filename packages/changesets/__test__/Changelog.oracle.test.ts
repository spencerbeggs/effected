import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applyReleasePlan } from "@changesets/apply-release-plan";
import { assembleReleasePlan } from "@changesets/assemble-release-plan";
import changelogGit from "@changesets/changelog-git";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, vi } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer, Option } from "effect";
import type { ChangelogFunctions } from "../src/Changelog.js";
import { Changelog } from "../src/Changelog.js";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { ReleasePlan } from "../src/ReleasePlan.js";
import type { Any } from "./support/oracle.js";
import { sibling } from "./support/oracle.js";

/**
 * `@changesets/apply-release-plan`'s written `CHANGELOG.md` files, with
 * `@changesets/changelog-git` as the module, against {@link Changelog.entry}
 * and {@link Changelog.insert} over the same copy. Each copy is made a git
 * repository with one commit per changeset, because the oracle asks git for
 * the commit that added each one; ours is handed the same commits.
 */
const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const changelogGitUrl = pathToFileURL(
	join(
		realpathSync(fileURLToPath(new URL("../node_modules/@changesets/changelog-git", import.meta.url))),
		"dist/index.mjs",
	),
).href;

const NOW = new Date("2026-11-09T12:34:56.789Z");

const git = (root: string, ...args: ReadonlyArray<string>): string =>
	execFileSync("git", [...args], {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "t",
			GIT_AUTHOR_EMAIL: "t@example.com",
			GIT_COMMITTER_NAME: "t",
			GIT_COMMITTER_EMAIL: "t@example.com",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
		},
	}).trim();

const changesetFiles = (root: string): ReadonlyArray<string> => {
	const dir = join(root, ".changeset");
	const top = readdirSync(dir).filter((f) => f.endsWith(".md"));
	const pre = existsSync(join(dir, "pre"))
		? readdirSync(join(dir, "pre"))
				.filter((f) => f.endsWith(".md"))
				.map((f) => `pre/${f}`)
		: [];
	return [...top, ...pre];
};

/** Every `CHANGELOG.md` under `root`, relative, with its text. */
const changelogs = (root: string): Record<string, string> => {
	const found: Record<string, string> = {};
	const walk = (dir: string, rel: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			if (entry.isDirectory()) walk(join(dir, entry.name), join(rel, entry.name));
			else if (entry.name === "CHANGELOG.md")
				found[join(rel, entry.name)] = readFileSync(join(dir, entry.name), "utf8");
		}
	};
	walk(root, "");
	return found;
};

/**
 * A changelog module that writes into each line what it was given: the
 * options, and each updated dependency's `dir` and `packageJson`. It is written into the copy
 * and loaded by both sides, so `changelogOpts`, `dir` and the manifest are compared too,
 * which `@changesets/changelog-git` never prints.
 */
const ECHO_MODULE = `export default {
	getReleaseLine: (changeset, type, opts) => "- " + type + " " + changeset.id + " opts=" + JSON.stringify(opts),
	getDependencyReleaseLine: (changesets, deps, opts) =>
		deps.map((d) => "- dep " + d.name + "@" + d.newVersion + " dir=" + d.dir + " relativeDir=" + d.relativeDir + " opts=" + JSON.stringify(opts) + " packageJson=" + JSON.stringify(d.packageJson)).join("\\n"),
};
`;

type Module = "git" | "echo";

const echoPath = (root: string): string => join(root, ".echo-changelog.mjs");

/**
 * A git repository copy of the fixture: everything committed, then each
 * changeset in a commit of its own. `seed` writes CHANGELOG files first, and
 * `module` picks the changelog module both sides use.
 */
const withRepo = <A, E, R>(
	name: string,
	seed: Record<string, string>,
	use: (root: string) => Effect.Effect<A, E, R>,
	module: Module = "git",
) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const root = realpathSync(mkdtempSync(join(tmpdir(), "changelog-")));
			cpSync(fixture(name), root, { recursive: true });
			if (module === "echo") writeFileSync(echoPath(root), ECHO_MODULE);
			const configPath = join(root, ".changeset", "config.json");
			const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
			writeFileSync(
				configPath,
				`${JSON.stringify({ ...config, changelog: module === "echo" ? pathToFileURL(echoPath(root)).href : changelogGitUrl, format: false }, null, 2)}\n`,
			);
			for (const [file, text] of Object.entries(seed)) writeFileSync(join(root, file), text);
			git(root, "init", "-q");
			const changesets = changesetFiles(root);
			git(root, "add", "-A", "--", ".", ...changesets.map((f) => `:!.changeset/${f}`));
			git(root, "commit", "-q", "--allow-empty", "-m", "base");
			for (const file of changesets) {
				git(root, "add", "--", `.changeset/${file}`);
				git(root, "commit", "-q", "-m", file);
			}
			return root;
		}),
		use,
		(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
	);

const runOracle = (root: string) =>
	Effect.promise(async () => {
		const { readConfig } = await sibling<Any>("@changesets/config");
		const { readPreState } = await sibling<Any>("@changesets/pre");
		const { readChangesets } = await sibling<Any>("@changesets/read");
		const { getPackages } = await sibling<Any>("@manypkg/get-packages");
		const original = console.error;
		console.error = () => {};
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		try {
			const packages = await getPackages(root);
			const { config, errors } = await readConfig(packages.rootDir, packages);
			if (config === undefined) throw new Error(errors.join("\n"));
			const plan = assembleReleasePlan(
				await readChangesets(packages.rootDir),
				packages,
				config,
				await readPreState(packages.rootDir),
			);
			await applyReleasePlan(plan, packages, config);
		} finally {
			vi.useRealTimers();
			console.error = original;
		}
	});

const discovery = (cwd: string) =>
	WorkspaceDiscovery.layer({ cwd }).pipe(
		Layer.provide(WorkspaceRoot.layer),
		Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
	);

/** Our CHANGELOG files: each release's entry inserted into the file as it was. */
const runOurs = (root: string, module: Module) =>
	Effect.gen(function* () {
		const functions =
			module === "echo"
				? ((yield* Effect.promise(() => import(pathToFileURL(echoPath(root)).href))).default as ChangelogFunctions)
				: changelogGit;
		const plan = yield* ReleasePlan.read(root);
		const packages = yield* (yield* WorkspaceDiscovery).listPackagesIn(root);
		const config = yield* ChangesetConfig.read(root);
		const commits = new Map(
			plan.changesets.map((c) => [
				c.file,
				git(root, "log", "--diff-filter=AC", "--max-count=1", "--format=%H", "--", `.changeset/${c.file}`),
			]),
		);
		const files: Record<string, string> = { ...changelogs(root) };
		for (const release of plan.releases) {
			const block = yield* Changelog.entry(plan, release, functions, { packages, config, commits });
			if (Option.isNone(block)) continue;
			const pkg = packages.find((p) => p.name === release.name);
			const file = join(pkg?.relativePath ?? ".", "CHANGELOG.md");
			files[file] = Changelog.insert(files[file] ?? "", block.value, release.name);
		}
		return files;
	}).pipe(Effect.provide(discovery(root)));

const compare = (name: string, seed: Record<string, string> = {}, module: Module = "git") =>
	withRepo(
		name,
		seed,
		(root) =>
			Effect.gen(function* () {
				const mine = yield* runOurs(root, module);
				yield* runOracle(root);
				return { mine, theirs: changelogs(root), root };
			}),
		module,
	);

const fixtures = [
	"single-patch",
	"minor-ripple-0x",
	"workspace-star-pin",
	"dev-dependent-none",
	"ignored-package",
	"two-changesets-max",
	"update-internal-minor",
	"specifier-forms",
	"kinds",
	"update-always",
	"explicit-none",
	"explicit-none-rippled",
	"prerelease-versions",
	"fixed-group",
	"fixed-ripple",
	"linked-group",
	"linked-none",
	"pre-mode",
	"pre-exit",
	"pre-groups",
	"range-edits",
	"range-edits-gated",
	"changelog-gates",
	"changelog-gates-pre",
];

describe("Changelog against @changesets/apply-release-plan with @changesets/changelog-git", () => {
	for (const name of fixtures) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const { mine, theirs } = yield* compare(name);
				assert.isAbove(Object.keys(theirs).length, 0, "the oracle should write a changelog");
				assert.deepStrictEqual(mine, theirs);
			}),
		);
	}

	it.effect("a dependent bumped only through its dependency gets the dependency lines, with the commit", () =>
		Effect.gen(function* () {
			const { mine, theirs } = yield* compare("minor-ripple-0x");
			assert.deepStrictEqual(mine, theirs);
			const b = theirs["packages/b/CHANGELOG.md"] ?? "";
			assert.match(
				b,
				/^# b\n\n## 1\.0\.1\n\n### Patch Changes\n\n- Updated dependencies \[[0-9a-f]{7}\]\n {2}- a@0\.24\.0\n$/,
			);
		}),
	);

	it.effect(
		"inserts into existing files as the oracle does: before the first version, after a first line, into an empty one",
		() =>
			Effect.gen(function* () {
				const seed = {
					"packages/a/CHANGELOG.md": "# a\n\nIntro.\n\n## 0.23.1\n\n### Patch Changes\n\n- Old.\n",
					"packages/b/CHANGELOG.md": "",
				};
				const { mine, theirs } = yield* compare("minor-ripple-0x", seed);
				assert.deepStrictEqual(mine, theirs);
				const unheaded = yield* compare("single-patch", { "packages/a/CHANGELOG.md": "Notes for a\nsecond line\n" });
				assert.deepStrictEqual(unheaded.mine, unheaded.theirs);
				const oneLine = yield* compare("single-patch", { "packages/a/CHANGELOG.md": "# a" });
				assert.deepStrictEqual(oneLine.mine, oneLine.theirs);
			}),
	);

	it.effect(
		"changelog-gates: workspace:* lists a patch under a minor minimum, and dependencies decides over peerDependencies",
		() =>
			Effect.gen(function* () {
				const { mine, theirs } = yield* compare("changelog-gates");
				assert.deepStrictEqual(mine, theirs);
				// Copied from the oracle's written files.
				assert.include(theirs["packages/star/CHANGELOG.md"] ?? "", "  - a@1.0.1");
				assert.notInclude(theirs["packages/both/CHANGELOG.md"] ?? "", "a@1.0.1");
			}),
	);

	it.effect("changelog-gates-pre: workspace:^ is checked against the current version, which a prerelease leaves", () =>
		Effect.gen(function* () {
			const { mine, theirs } = yield* compare("changelog-gates-pre");
			assert.deepStrictEqual(mine, theirs);
			assert.include(theirs["packages/caret/CHANGELOG.md"] ?? "", "  - a@1.0.1-next.0");
		}),
	);

	it.effect("a bare module id passes null options, and each updated dependency's dir is its absolute directory", () =>
		Effect.gen(function* () {
			const { mine, theirs, root } = yield* compare("minor-ripple-0x", {}, "echo");
			assert.deepStrictEqual(mine, theirs);
			// Copied from the oracle's run with the echo module.
			assert.include(theirs["packages/a/CHANGELOG.md"] ?? "", "- minor one opts=null");
			assert.include(
				theirs["packages/b/CHANGELOG.md"] ?? "",
				`- dep a@0.24.0 dir=${join(root, "packages/a")} relativeDir=packages/a opts=null`,
			);
		}),
	);

	it.effect(
		"a module's packageJson is the dependency's whole manifest, keys WorkspacePackage does not model included",
		() =>
			Effect.gen(function* () {
				const { mine, theirs } = yield* compare("changelog-gates", {}, "echo");
				assert.deepStrictEqual(mine, theirs);
				// Copied from the oracle's run with the echo module.
				assert.include(
					theirs["packages/star/CHANGELOG.md"] ?? "",
					'packageJson={"name":"a","version":"1.0.0","description":"Keys WorkspacePackage does not model reach a changelog module.","scripts":{"build":"tsc"},"keywords":["fixture"]}',
				);
			}),
	);

	it.effect("the first version heading may be any level from # to ######", () =>
		Effect.gen(function* () {
			const seed = {
				"packages/a/CHANGELOG.md": "# a\n\nIntro.\n\n### 0.23.1\n\n- Old.\n",
				"packages/b/CHANGELOG.md": "# b\n\nIntro.\n\n# 1.0.0\n\n- Old.\n",
			};
			const { mine, theirs } = yield* compare("minor-ripple-0x", seed);
			assert.deepStrictEqual(mine, theirs);
			// The oracle put each block straight before the version heading, not after the first line.
			assert.include(theirs["packages/a/CHANGELOG.md"] ?? "", "Intro.\n\n## 0.24.0");
			assert.include(theirs["packages/b/CHANGELOG.md"] ?? "", "Intro.\n\n## 1.0.1");
		}),
	);

	it.effect("the comparison can fail: another module's lines do not match", () =>
		Effect.gen(function* () {
			const result = yield* withRepo("minor-ripple-0x", {}, (root) =>
				Effect.gen(function* () {
					const { plan, packages, config } = yield* Effect.gen(function* () {
						return {
							plan: yield* ReleasePlan.read(root),
							packages: yield* (yield* WorkspaceDiscovery).listPackagesIn(root),
							config: yield* ChangesetConfig.read(root),
						};
					}).pipe(Effect.provide(discovery(root)));
					const release = plan.releases[0];
					if (release === undefined) return assert.fail("the plan should release");
					const other = {
						getReleaseLine: () => "- Something else.",
						getDependencyReleaseLine: () => "",
					};
					const block = yield* Changelog.entry(plan, release, other, { packages, config });
					yield* runOracle(root);
					return { block: Option.getOrUndefined(block), written: changelogs(root)["packages/a/CHANGELOG.md"] };
				}),
			);
			assert.isDefined(result.block);
			assert.notInclude(result.written ?? "", result.block ?? "-");
		}),
	);
});
