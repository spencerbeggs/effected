// `PnpmSettings.load` — the IO shell: which files it finds and reads.
//
// One read-only volume carries every scenario, so one suite-boundary layer
// serves them all; each test varies only `cwd`, `env`, `platform` and the
// overrides. Every candidate global directory holds a DIFFERENT
// `minimumReleaseAge`, so a test that resolved the wrong directory reads the
// wrong number, and the `.npmrc` / `rc` decoys hold values that would show up
// if they were ever read.

import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option, Path } from "effect";
import type { PnpmSettingsLoadOptions } from "../src/index.js";
import { PnpmSettings } from "../src/index.js";
import { manifest, platform } from "./fixtures.js";

// Each pattern compiles alone, but the members share one compile budget, so the
// set as a whole fails typed (`CompileBudgetExceeded`).
const BIG_SET = Array.from({ length: 5000 }, (_, i) => `  - '**/[[:alpha:]]*${i}.x'`).join("\n");

const tree: Readonly<Record<string, string>> = {
	"/budget/pnpm-workspace.yaml": `packages:\n${BIG_SET}\nminimumReleaseAge: 100\n`,
	"/budget/package.json": manifest("budget"),
	"/budget/sub/package.json": manifest("sub"),
	// The four global directories pnpm can pick, one value each.
	"/home/u/Library/Preferences/pnpm/config.yaml": "minimumReleaseAge: 30\nminimumReleaseAgeExclude:\n  - g-darwin\n",
	"/home/u/.config/pnpm/config.yaml": "minimumReleaseAge: 40\n",
	"/home/v/.config/pnpm/config.yaml": "minimumReleaseAge: 45\n",
	"/xdg/pnpm/config.yaml": "minimumReleaseAge: 50\n",
	"/appdata/pnpm/config/config.yaml": "minimumReleaseAge: 60\n",
	"/custom/config.yaml": "minimumReleaseAge: 70\n",
	// Decoys pnpm 11 and 12 do not read for a pnpm setting.
	"/home/u/.npmrc": "minimum-release-age=998\n",
	"/home/u/.config/pnpm/rc": "minimum-release-age=997\n",
	"/repo/.npmrc": "minimum-release-age=999\nminimum-release-age-exclude=npmrc-a\n",
	// A pnpm workspace with a member.
	"/repo/pnpm-workspace.yaml":
		"packages:\n  - 'packages/*'\nminimumReleaseAgeExclude:\n  - ws-a\n  - ws-b\nminimumReleaseAgeStrict: true\n",
	"/repo/package.json": manifest("repo"),
	"/repo/packages/a/package.json": manifest("a"),
	// A project the `packages:` patterns leave out, and a plain directory.
	"/repo/examples/demo/package.json": manifest("demo"),
	"/repo/scripts/tool.ts": "",
	// A single-package repo keeping its settings in a manifest with no
	// `packages:` key: the root is the only member.
	"/single/pnpm-workspace.yaml": "minimumReleaseAge: 100\n",
	"/single/package.json": manifest("single"),
	"/single/fixture/package.json": manifest("fixture"),
	"/single/src/deep/x.ts": "",
	// An exclusion, and the directories pnpm never counts.
	"/excl/pnpm-workspace.yaml": "packages:\n  - '**'\n  - '!examples/**'\nminimumReleaseAge: 100\n",
	"/excl/package.json": manifest("excl"),
	"/excl/lib/package.json": manifest("lib"),
	"/excl/examples/package.json": manifest("examples"),
	"/excl/examples/x/package.json": manifest("x"),
	"/excl/node_modules/dep/package.json": manifest("dep"),
	// A pattern starting with `/` is skipped, not read as relative.
	"/slash/pnpm-workspace.yaml": "packages:\n  - '/abs'\nminimumReleaseAge: 100\n",
	"/slash/abs/package.json": manifest("abs"),
	// Misnamed manifests, which pnpm 12 passes over.
	"/misnamed/pnpm-workspace.yml": "minimumReleaseAge: 1\n",
	"/misnamed/sub/x.ts": "",
	"/outer/pnpm-workspace.yaml": "minimumReleaseAge: 7\n",
	"/outer/inner/.pnpm-workspace.yaml": "minimumReleaseAge: 1\n",
	// A project manifest whose existence probe fails.
	"/probe/pnpm-workspace.yaml": "minimumReleaseAge: 100\n",
	"/probe/sub/package.json": manifest("sub"),
	// A second workspace, reached only through the workspace-dir override.
	"/other/pnpm-workspace.yaml": "packages: []\nminimumReleaseAge: 5\n",
	// No workspace at all.
	"/bare/x/package.json": manifest("x"),
	// Damaged workspace files.
	"/broken/pnpm-workspace.yaml": "a: [\n",
	"/listdoc/pnpm-workspace.yaml": "- a\n",
	"/locked/pnpm-workspace.yaml": "minimumReleaseAge: 1\n",
	"/empty/pnpm-workspace.yaml": "",
};

const Platform = platform(tree, {
	unreadableFiles: new Set(["/locked/pnpm-workspace.yaml"]),
	unreadableExists: new Set(["/probe/sub/package.json"]),
});

const darwin = (overrides: Partial<PnpmSettingsLoadOptions> = {}): PnpmSettingsLoadOptions => ({
	cwd: "/repo/packages/a",
	env: { HOME: "/home/u" },
	platform: "darwin",
	...overrides,
});

layer(Platform)("PnpmSettings.load", (it) => {
	describe("finding the files", () => {
		it.effect("reads the nearest pnpm-workspace.yaml and the darwin global config, nothing else", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin());
				assert.deepStrictEqual(settings.files, [
					"/home/u/Library/Preferences/pnpm/config.yaml",
					"/repo/pnpm-workspace.yaml",
				]);
				// 30 is the global file's; the .npmrc decoys (999, 998) never surface.
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(30));
				assert.deepStrictEqual(settings.origin("minimumReleaseAge"), Option.some("global"));
				// The workspace list replaces the global one.
				assert.deepStrictEqual(settings.minimumReleaseAgeExclude, ["ws-a", "ws-b"]);
				assert.deepStrictEqual(settings.getBoolean("minimum-release-age-strict"), Option.some(true));
			}),
		);

		it.effect("uses ~/.config/pnpm on Linux", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ platform: "linux" }));
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(40));
				assert.deepStrictEqual(settings.files[0], "/home/u/.config/pnpm/config.yaml");
			}),
		);

		it.effect("XDG_CONFIG_HOME wins over the platform default", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ env: { HOME: "/home/u", XDG_CONFIG_HOME: "/xdg" } }));
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(50));
			}),
		);

		it.effect("uses LOCALAPPDATA/pnpm/config on win32, and the home fallback without it", () =>
			Effect.gen(function* () {
				const withAppData = yield* PnpmSettings.load(
					darwin({ platform: "win32", env: { USERPROFILE: "/home/u", LOCALAPPDATA: "/appdata" } }),
				);
				assert.deepStrictEqual(withAppData.minimumReleaseAge, Option.some(60));
				const without = yield* PnpmSettings.load(darwin({ platform: "win32", env: { USERPROFILE: "/home/u" } }));
				assert.deepStrictEqual(without.minimumReleaseAge, Option.some(40));
			}),
		);

		it.effect("globalConfigDir and home override what the environment says", () =>
			Effect.gen(function* () {
				const custom = yield* PnpmSettings.load(
					darwin({ globalConfigDir: "/custom", env: { XDG_CONFIG_HOME: "/xdg" } }),
				);
				assert.deepStrictEqual(custom.minimumReleaseAge, Option.some(70));
				const home = yield* PnpmSettings.load(darwin({ platform: "linux", home: "/home/v" }));
				assert.deepStrictEqual(home.minimumReleaseAge, Option.some(45));
			}),
		);

		it.effect("with no home and no XDG_CONFIG_HOME reads no global file", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ env: {} }));
				assert.deepStrictEqual(settings.files, ["/repo/pnpm-workspace.yaml"]);
				assert.isTrue(Option.isNone(settings.minimumReleaseAge));
			}),
		);

		it.effect("outside any workspace reads only the global file", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ cwd: "/bare/x" }));
				assert.deepStrictEqual(settings.files, ["/home/u/Library/Preferences/pnpm/config.yaml"]);
				assert.deepStrictEqual(settings.minimumReleaseAgeExclude, ["g-darwin"]);
			}),
		);

		it.effect("a workspace-dir variable names the workspace file instead of the ascent", () =>
			Effect.gen(function* () {
				for (const name of ["PNPM_CONFIG_WORKSPACE_DIR", "pnpm_config_workspace_dir", "NPM_CONFIG_WORKSPACE_DIR"]) {
					const settings = yield* PnpmSettings.load(darwin({ env: { HOME: "/home/u", [name]: "/other" } }));
					assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(5), name);
					assert.deepStrictEqual(settings.files[1], "/other/pnpm-workspace.yaml", name);
				}
				// Resolved against cwd.
				const relative = yield* PnpmSettings.load(
					darwin({ cwd: "/repo", env: { HOME: "/home/u", PNPM_CONFIG_WORKSPACE_DIR: "../other" } }),
				);
				assert.deepStrictEqual(relative.minimumReleaseAge, Option.some(5));
			}),
		);
	});

	// pnpm 11 and 12 agree on every row (probed with `pnpm config get`): from
	// a directory that holds a project manifest and is not the workspace root,
	// the workspace file applies only when the directory matches `packages:`.
	describe("workspace membership", () => {
		const ageFrom = (cwd: string) =>
			PnpmSettings.load(darwin({ cwd })).pipe(
				Effect.map((settings) => ({ age: settings.minimumReleaseAge, files: settings.files.length })),
			);
		const workspaceAge = (age: number) => ({ age: Option.some(age), files: 2 });
		const globalOnly = { age: Option.some(30), files: 1 };

		it.effect("a project the patterns leave out reads no workspace file; a member does", () =>
			Effect.gen(function* () {
				const demo = yield* PnpmSettings.load(darwin({ cwd: "/repo/examples/demo" }));
				assert.deepStrictEqual(demo.files, ["/home/u/Library/Preferences/pnpm/config.yaml"]);
				assert.deepStrictEqual(demo.minimumReleaseAgeExclude, ["g-darwin"]);
				assert.isTrue(Option.isNone(demo.getBoolean("minimumReleaseAgeStrict")));
				// The member control, and a directory with no project manifest.
				const member = yield* PnpmSettings.load(darwin({ cwd: "/repo/packages/a" }));
				assert.deepStrictEqual(member.minimumReleaseAgeExclude, ["ws-a", "ws-b"]);
				const plain = yield* PnpmSettings.load(darwin({ cwd: "/repo/scripts" }));
				assert.deepStrictEqual(plain.minimumReleaseAgeExclude, ["ws-a", "ws-b"]);
			}),
		);

		it.effect("with no packages key the root is the only member", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* ageFrom("/single"), workspaceAge(100));
				assert.deepStrictEqual(yield* ageFrom("/single/src/deep"), workspaceAge(100));
				assert.deepStrictEqual(yield* ageFrom("/single/fixture"), globalOnly);
			}),
		);

		it.effect("an exclusion and node_modules keep a project out", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* ageFrom("/excl/lib"), workspaceAge(100));
				assert.deepStrictEqual(yield* ageFrom("/excl/examples"), globalOnly);
				assert.deepStrictEqual(yield* ageFrom("/excl/examples/x"), globalOnly);
				assert.deepStrictEqual(yield* ageFrom("/excl/node_modules/dep"), globalOnly);
				assert.deepStrictEqual(yield* ageFrom("/slash/abs"), globalOnly);
			}),
		);

		it.effect("the workspace-dir variable applies the file to a non-member too", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(
					darwin({ cwd: "/single/fixture", env: { HOME: "/home/u", PNPM_CONFIG_WORKSPACE_DIR: "/single" } }),
				);
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(100));
			}),
		);

		it.effect("a project manifest probe that fails is a read failure, not an absence", () =>
			Effect.gen(function* () {
				const error = yield* PnpmSettings.load(darwin({ cwd: "/probe/sub" })).pipe(Effect.flip);
				assert.strictEqual(error.reason, "read");
				assert.strictEqual(error.path, "/probe/sub/package.json");
			}),
		);
	});

	describe("a pattern set that fails as a whole", () => {
		it.effect(
			'fails "membership" instead of answering not-a-member',
			() =>
				Effect.gen(function* () {
					const error = yield* PnpmSettings.load(darwin({ cwd: "/budget/sub" })).pipe(Effect.flip);
					assert.strictEqual(error.reason, "membership");
				}),
			// The set is built to exhaust glob's compile budget, which takes real CPU.
			{ timeout: 60_000 },
		);
	});

	// pnpm 12 passes a misnamed manifest and keeps ascending (probed: a
	// `pnpm-workspace.yml` below a valid manifest reads the valid one's value);
	// pnpm 11 fails with ERR_PNPM_BAD_WORKSPACE_MANIFEST_NAME instead.
	describe("misnamed manifests", () => {
		it.effect("a misnamed manifest is not a workspace file", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ cwd: "/misnamed/sub" }));
				assert.deepStrictEqual(settings.files, ["/home/u/Library/Preferences/pnpm/config.yaml"]);
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(30));
			}),
		);

		it.effect("the ascent passes a misnamed manifest to the valid one above it", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ cwd: "/outer/inner" }));
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(7));
				assert.deepStrictEqual(settings.files[1], "/outer/pnpm-workspace.yaml");
			}),
		);
	});

	describe("precedence over the files", () => {
		it.effect("a PNPM_CONFIG_* variable wins; an npm_config_* one is not read", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(
					darwin({
						env: {
							HOME: "/home/u",
							PNPM_CONFIG_MINIMUM_RELEASE_AGE: "7",
							npm_config_minimum_release_age_exclude: '["npm-a"]',
						},
					}),
				);
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(7));
				assert.deepStrictEqual(settings.origin("minimumReleaseAge"), Option.some("environment"));
				assert.deepStrictEqual(settings.minimumReleaseAgeExclude, ["ws-a", "ws-b"]);
			}),
		);
	});

	describe("failures", () => {
		const reasonOf = (cwd: string) =>
			PnpmSettings.load(darwin({ cwd })).pipe(
				Effect.flip,
				Effect.map((error) => ({ tag: error._tag, reason: error.reason, path: error.path })),
			);

		it.effect("a workspace file that is not YAML fails parse", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* reasonOf("/broken"), {
					tag: "PnpmSettingsError",
					reason: "parse",
					path: "/broken/pnpm-workspace.yaml",
				});
			}),
		);

		it.effect("a workspace document that is not a mapping fails shape", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* reasonOf("/listdoc"), {
					tag: "PnpmSettingsError",
					reason: "shape",
					path: "/listdoc/pnpm-workspace.yaml",
				});
			}),
		);

		it.effect("a workspace file that exists but cannot be read fails read", () =>
			Effect.gen(function* () {
				const error = yield* PnpmSettings.load(darwin({ cwd: "/locked" })).pipe(Effect.flip);
				assert.strictEqual(error.reason, "read");
				assert.strictEqual(error.path, "/locked/pnpm-workspace.yaml");
				assert.isDefined(error.cause);
			}),
		);

		it.effect("an empty workspace file is no settings, not an error", () =>
			Effect.gen(function* () {
				const settings = yield* PnpmSettings.load(darwin({ cwd: "/empty" }));
				assert.deepStrictEqual(settings.files, [
					"/home/u/Library/Preferences/pnpm/config.yaml",
					"/empty/pnpm-workspace.yaml",
				]);
				assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(30));
			}),
		);
	});
});

// The ascent starts from the real path of `cwd`, as pnpm's does: through a
// symlinked directory the lexical parents hold a different workspace file.
const linked = Layer.mergeAll(
	MemoryFileSystem.layerWith({
		"/real/ws/pnpm-workspace.yaml": "minimumReleaseAge: 100\n",
		"/real/ws/sub/x.ts": "",
		"/links/pnpm-workspace.yaml": "minimumReleaseAge: 5\n",
		"/links/sub": MemoryFileSystem.symlink("/real/ws/sub"),
	}),
	Path.layer,
);

layer(linked)("PnpmSettings.load through a symlink", (it) => {
	it.effect("finds the workspace above the real directory, not the link", () =>
		Effect.gen(function* () {
			const settings = yield* PnpmSettings.load({ cwd: "/links/sub", env: {}, platform: "linux" });
			assert.deepStrictEqual(settings.files, ["/real/ws/pnpm-workspace.yaml"]);
			assert.deepStrictEqual(settings.minimumReleaseAge, Option.some(100));
		}),
	);
});
