import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { sameBytes } from "../../src/action/tree.js";
import {
	ActionBuildResult,
	ActionBuilder,
	ActionBundle,
	ActionYmlPathError,
	BuildFailed,
	BundleFailed,
	PersistPathError,
	ValidationFailed,
} from "../../src/index.js";
import { configOf, withFiles } from "../e2e/action-fixture.js";

const Live = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const ACTION = {
	"src/main.ts": 'console.log("main");\n',
	"action.yml": `name: test
description: A test action
runs:
  using: node24
  main: dist/main.js
branding:
  icon: zap
  color: blue
`,
};

const options = { validate: true, persist: true, ci: false } as const;

describe("ActionBuilder.build", () => {
	it.live("validates, bundles and persists", () =>
		withFiles(ACTION, (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf() });
				assert.instanceOf(result, ActionBuildResult);
				assert.isTrue(result.validation.valid);
				assert.isTrue(result.build.success);
				assert.isTrue(result.persisted);
				assert.isTrue(existsSync(join(cwd, "dist", "main.js")));
				assert.strictEqual(
					readFileSync(join(cwd, ".github/actions/local/dist/main.js"), "utf8"),
					readFileSync(join(cwd, "dist", "main.js"), "utf8"),
				);
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("stops at a validation error, before dist is touched", () =>
		withFiles({ ...ACTION, "src/main.ts": "", "dist/old.js": "old\n", "action.yml": "name: [unclosed\n" }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf() }).pipe(Effect.flip);
				assert.instanceOf(error, ValidationFailed);
				if (error instanceof ValidationFailed) {
					assert.strictEqual(error.errorCount, 1);
					assert.strictEqual(error.warningCount, 0);
					assert.strictEqual(error.validation.errors[0]?.code, "ACTION_YML_SYNTAX_ERROR");
					assert.isUndefined(error.build);
				}
				assert.isTrue(existsSync(join(cwd, "dist", "old.js")));
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("stops at a warning in strict mode, and goes on outside it", () =>
		withFiles({ "src/main.ts": 'console.log("main");\n' }, (cwd) =>
			Effect.gen(function* () {
				const strict = yield* ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf(), ci: true }).pipe(
					Effect.flip,
				);
				assert.instanceOf(strict, ValidationFailed);
				assert.isFalse(existsSync(join(cwd, "dist")));

				const relaxed = yield* ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf() });
				assert.isTrue(relaxed.validation.valid);
				assert.strictEqual(relaxed.validation.warnings[0]?.code, "ACTION_YML_MISSING");
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("skips validation when told to, and reports nothing for it", () =>
		withFiles({ "src/main.ts": 'console.log("main");\n', "action.yml": "name: [unclosed\n" }, (cwd) =>
			Effect.gen(function* () {
				const result = yield* ActionBuilder.build({
					cwd,
					root: cwd,
					config: configOf({ persistLocal: { enabled: false } }),
					validate: false,
					persist: false,
					ci: false,
				});
				assert.isTrue(result.validation.valid);
				assert.deepStrictEqual(result.validation.errors, []);
				assert.deepStrictEqual(result.validation.warnings, []);
				assert.isTrue(result.build.success);
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("does not persist when told not to, or when the config disables it", () =>
		withFiles(ACTION, (cwd) =>
			Effect.gen(function* () {
				const off = yield* ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf(), persist: false });
				assert.isFalse(off.persisted);
				assert.isFalse(existsSync(join(cwd, ".github")));

				const disabled = yield* ActionBuilder.build({
					...options,
					cwd,
					root: cwd,
					config: configOf({ persistLocal: { enabled: false } }),
				});
				assert.isFalse(disabled.persisted);
				assert.isFalse(existsSync(join(cwd, ".github")));
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("warns on a bundle past maxBundleSize, and fails on it in strict mode", () =>
		withFiles(ACTION, (cwd) =>
			Effect.gen(function* () {
				const relaxed = yield* ActionBuilder.build({
					...options,
					cwd,
					root: cwd,
					config: configOf({ validation: { maxBundleSize: "1b" } }),
				});
				assert.isTrue(relaxed.validation.valid);
				assert.deepStrictEqual(
					relaxed.validation.warnings.map((warning) => warning.code),
					["MAX_BUNDLE_SIZE_EXCEEDED"],
				);
				assert.isTrue(relaxed.persisted);

				const strict = yield* ActionBuilder.build({
					...options,
					cwd,
					root: cwd,
					config: configOf({ validation: { maxBundleSize: "1b", strict: true }, persistLocal: { path: ".strict" } }),
				}).pipe(Effect.flip);
				assert.instanceOf(strict, ValidationFailed);
				if (strict instanceof ValidationFailed) assert.isTrue(strict.build?.success);
				assert.isFalse(existsSync(join(cwd, ".strict")), "a failed size check does not persist");

				const roomy = yield* ActionBuilder.build({
					...options,
					cwd,
					root: cwd,
					config: configOf({ validation: { maxBundleSize: `${statSync(join(cwd, "dist", "main.js")).size}b` } }),
				});
				assert.deepStrictEqual(roomy.validation.warnings, []);
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("fails BuildFailed, carrying the build, when an entry does not load", () =>
		withFiles({ ...ACTION, "src/main.ts": 'throw new TypeError("broken at load");\n' }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf() }).pipe(Effect.flip);
				assert.instanceOf(error, BuildFailed);
				if (error instanceof BuildFailed) {
					assert.strictEqual(error.failedEntries, 1);
					assert.include(error.build.entries[0]?.error ?? "", "broken at load");
					assert.isTrue(error.validation.valid);
				}
				assert.isFalse(existsSync(join(cwd, ".github")), "a failed build does not persist");
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("fails with what bundling and persisting raise", () =>
		Effect.gen(function* () {
			const missing = yield* withFiles({}, (cwd) =>
				ActionBuilder.build({ cwd, root: cwd, config: configOf(), validate: false, persist: false, ci: false }).pipe(
					Effect.flip,
				),
			);
			assert.instanceOf(missing, BundleFailed);

			const unresolved = yield* withFiles(
				{ ...ACTION, "action.yml": ACTION["action.yml"].replace("dist/main.js", "dist/elsewhere.js") },
				(cwd) => ActionBuilder.build({ ...options, cwd, root: cwd, config: configOf() }).pipe(Effect.flip),
			);
			assert.instanceOf(unresolved, ActionYmlPathError);
		}).pipe(Effect.provide(Live)),
	);
});

describe("ActionBuilder.build under the workspace base", () => {
	const workspace = (extra: Record<string, unknown> = {}) =>
		configOf({ persistLocal: { base: "workspace", dist: false, ...extra } });
	const ws = (files: Readonly<Record<string, string>>) =>
		Object.fromEntries(Object.entries(files).map(([name, source]) => [`actions/one/${name}`, source]));

	it.live("dist = false leaves no package dist", () =>
		withFiles({ ...ws(ACTION), "package.json": "{}" }, (root) =>
			Effect.gen(function* () {
				const cwd = join(root, "actions/one");
				const result = yield* ActionBuilder.build({ ...options, cwd, root, config: workspace() });
				assert.isTrue(result.persisted);
				assert.isFalse(existsSync(join(cwd, "dist")));
				assert.isFalse(existsSync(join(cwd, ".action-staging")));
				assert.isTrue(existsSync(join(root, ".github/actions/one/dist/main.js")));
				assert.isTrue(existsSync(join(root, ".github/actions/one/action.yml")));
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("a path outside the workspace fails before bundling", () =>
		withFiles({ ...ws(ACTION), "package.json": "{}" }, (root) =>
			Effect.gen(function* () {
				const cwd = join(root, "actions/one");
				const error = yield* ActionBuilder.build({
					...options,
					cwd,
					root,
					config: workspace({ path: "../outside" }),
				}).pipe(Effect.flip);
				assert.instanceOf(error, PersistPathError);
				assert.isFalse(existsSync(join(cwd, ".action-staging")));
				assert.isFalse(existsSync(join(cwd, "dist")));
			}).pipe(Effect.provide(Live)),
		),
	);
});

describe("ActionBundle.build outDir", () => {
	const files = { "src/main.ts": 'console.log("main");\n' };
	const filesIn = (directory: string) => readdirSync(directory).sort();
	/** `outDir` is absolute and under the real `cwd`, as `ResolvedPersist.stagingDir` is: the temp directory is a symlink on macOS. */
	const stage = (cwd: string, name: string) => join(realpathSync(cwd), name);

	it.live("bundles into outDir and leaves dist alone", () =>
		withFiles({ ...files, "dist/keep.txt": "keep\n" }, (cwd) =>
			Effect.gen(function* () {
				const outDir = stage(cwd, ".action-staging");
				const result = yield* ActionBundle.build(configOf(), { cwd, clean: true, outDir });
				assert.isTrue(result.success);
				assert.isTrue(existsSync(join(outDir, "main.js")));
				assert.isTrue(existsSync(join(outDir, "package.json")));
				assert.strictEqual(result.entries[0]?.stats?.outputPath, "dist/main.js");
				assert.deepStrictEqual(filesIn(join(cwd, "dist")), ["keep.txt"]);
			}),
		),
	);

	it.live("clean clears a stale staging dir", () =>
		withFiles({ ...files, ".action-staging/old.js": "old\n" }, (cwd) =>
			Effect.gen(function* () {
				const outDir = stage(cwd, ".action-staging");
				yield* ActionBundle.build(configOf(), { cwd, clean: true, outDir });
				assert.isFalse(existsSync(join(outDir, "old.js")));
				assert.isTrue(existsSync(join(outDir, "main.js")));
			}),
		),
	);

	it.live("staged and real builds match", () =>
		withFiles(files, (cwd) =>
			Effect.gen(function* () {
				const config = configOf({ build: { sourceMap: true, minify: false } });
				const staged = stage(cwd, ".action-staging");
				yield* ActionBundle.build(config, { cwd, clean: true, outDir: staged });
				yield* ActionBundle.build(config, { cwd, clean: true });
				const names = filesIn(staged);
				assert.deepStrictEqual(names, filesIn(join(cwd, "dist")));
				assert.include(names, "main.js.map");
				for (const name of names) {
					assert.isTrue(sameBytes(readFileSync(join(staged, name)), readFileSync(join(cwd, "dist", name))), name);
				}
			}),
		),
	);

	it.live("two builds are byte-identical", () =>
		withFiles(files, (cwd) =>
			Effect.gen(function* () {
				const config = configOf({ build: { sourceMap: true, minify: false } });
				const one = stage(cwd, ".stage-one");
				const two = stage(cwd, ".stage-two");
				yield* ActionBundle.build(config, { cwd, clean: true, outDir: one });
				yield* ActionBundle.build(config, { cwd, clean: true, outDir: two });
				const names = filesIn(one);
				assert.deepStrictEqual(names, filesIn(two));
				for (const name of names) {
					assert.isTrue(sameBytes(readFileSync(join(one, name)), readFileSync(join(two, name))), name);
				}
			}),
		),
	);

	it.live("an external resolves from staging in the import check", () =>
		withFiles(
			{
				"src/main.ts": 'import { value } from "ext-pkg";\nconsole.log(value);\n',
				"node_modules/ext-pkg/package.json":
					'{ "name": "ext-pkg", "version": "1.0.0", "type": "module", "main": "index.js" }',
				"node_modules/ext-pkg/index.js": "export const value = 1;\n",
			},
			(cwd) =>
				Effect.gen(function* () {
					const outDir = stage(cwd, ".action-staging");
					const result = yield* ActionBundle.build(configOf({ build: { externals: ["ext-pkg"] } }), {
						cwd,
						clean: true,
						outDir,
					});
					assert.isTrue(result.success, result.entries[0]?.error);
					assert.isUndefined(result.entries[0]?.warnings);
					assert.isTrue(existsSync(join(outDir, "main.js")));
				}),
		),
	);
});
