import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
	ActionBuildResult,
	ActionBuilder,
	ActionYmlPathError,
	BuildFailed,
	BundleFailed,
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
				const result = yield* ActionBuilder.build({ ...options, cwd, config: configOf() });
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
				const error = yield* ActionBuilder.build({ ...options, cwd, config: configOf() }).pipe(Effect.flip);
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
				const strict = yield* ActionBuilder.build({ ...options, cwd, config: configOf(), ci: true }).pipe(Effect.flip);
				assert.instanceOf(strict, ValidationFailed);
				assert.isFalse(existsSync(join(cwd, "dist")));

				const relaxed = yield* ActionBuilder.build({ ...options, cwd, config: configOf() });
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
				const off = yield* ActionBuilder.build({ ...options, cwd, config: configOf(), persist: false });
				assert.isFalse(off.persisted);
				assert.isFalse(existsSync(join(cwd, ".github")));

				const disabled = yield* ActionBuilder.build({
					...options,
					cwd,
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
					config: configOf({ validation: { maxBundleSize: "1b", strict: true }, persistLocal: { path: ".strict" } }),
				}).pipe(Effect.flip);
				assert.instanceOf(strict, ValidationFailed);
				if (strict instanceof ValidationFailed) assert.isTrue(strict.build?.success);
				assert.isFalse(existsSync(join(cwd, ".strict")), "a failed size check does not persist");

				const roomy = yield* ActionBuilder.build({
					...options,
					cwd,
					config: configOf({ validation: { maxBundleSize: `${statSync(join(cwd, "dist", "main.js")).size}b` } }),
				});
				assert.deepStrictEqual(roomy.validation.warnings, []);
			}).pipe(Effect.provide(Live)),
		),
	);

	it.live("fails BuildFailed, carrying the build, when an entry does not load", () =>
		withFiles({ ...ACTION, "src/main.ts": 'throw new TypeError("broken at load");\n' }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* ActionBuilder.build({ ...options, cwd, config: configOf() }).pipe(Effect.flip);
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
				ActionBuilder.build({ cwd, config: configOf(), validate: false, persist: false, ci: false }).pipe(Effect.flip),
			);
			assert.instanceOf(missing, BundleFailed);

			const unresolved = yield* withFiles(
				{ ...ACTION, "action.yml": ACTION["action.yml"].replace("dist/main.js", "dist/elsewhere.js") },
				(cwd) => ActionBuilder.build({ ...options, cwd, config: configOf() }).pipe(Effect.flip),
			);
			assert.instanceOf(unresolved, ActionYmlPathError);
		}).pipe(Effect.provide(Live)),
	);
});
