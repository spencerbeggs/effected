// `ActionRun.run` over real temporary directories, because rolldown bundles on the real disk.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { ActionRun, ActionRunResult, NotAPackageError, NotAnActionError } from "../../src/build/index.js";

const Live = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

const ACTION_YML = `name: test
description: A test action
runs:
  using: node24
  main: dist/main.js
branding:
  icon: zap
  color: blue
`;

const GOOD: Readonly<Record<string, string>> = {
	"package.json": JSON.stringify({ name: "action", version: "1.0.0" }),
	"effected.toml": '[action.entries]\nmain = "src/main.ts"\n',
	"action.yml": ACTION_YML,
	"src/main.ts": 'console.log("main");\n',
};

const withAction = <A, E>(files: Readonly<Record<string, string | null>>, use: (cwd: string) => Effect.Effect<A, E>) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const cwd = mkdtempSync(join(tmpdir(), "effected-action-run-"));
			for (const [name, source] of Object.entries(files)) {
				if (source === null) continue;
				mkdirSync(dirname(join(cwd, name)), { recursive: true });
				writeFileSync(join(cwd, name), source);
			}
			return cwd;
		}),
		use,
		(cwd) => Effect.sync(() => rmSync(cwd, { recursive: true, force: true })),
	);

const run = (cwd: string, input: { readonly validate?: boolean; readonly persist?: boolean } = {}) =>
	ActionRun.run({ validate: input.validate ?? true, persist: input.persist ?? false }, { cwd, ci: false }).pipe(
		Effect.provide(Live),
	);

describe("ActionRun.run", () => {
	it.live("answers ok with the whole result", () =>
		withAction(GOOD, (cwd) =>
			Effect.gen(function* () {
				const answer = yield* run(cwd);
				assert.instanceOf(answer, ActionRunResult);
				assert.strictEqual(answer.verdict, "ok");
				assert.isTrue(answer.result.build.success);
				assert.strictEqual(answer.result.build.entries[0]?.stats?.outputPath, "dist/main.js");
				assert.isFalse(answer.result.persisted);
				assert.sameMembers(readdirSync(join(cwd, "dist")), ["main.js", "package.json"]);
			}),
		),
	);

	it.live("persists when asked", () =>
		withAction(GOOD, (cwd) =>
			Effect.gen(function* () {
				const answer = yield* run(cwd, { persist: true });
				assert.isTrue(answer.result.persisted);
				assert.include(readdirSync(join(cwd, ".github/actions/local/dist")), "main.js");
			}),
		),
	);

	it.live("answers a validation failure as a failed verdict with what it found and no bundle", () =>
		withAction({ ...GOOD, "action.yml": "name: [unclosed\n" }, (cwd) =>
			Effect.gen(function* () {
				const answer = yield* run(cwd);
				assert.strictEqual(answer.verdict, "failed");
				assert.strictEqual(answer.result.validation.errors[0]?.code, "ACTION_YML_SYNTAX_ERROR");
				assert.deepStrictEqual(answer.result.build.entries, []);
				assert.isFalse(answer.result.build.success);
				assert.isFalse(answer.result.persisted);
			}),
		),
	);

	it.live("answers a size failure in strict mode as failed, keeping the build it stopped after", () =>
		withAction({ ...GOOD, "effected.toml": '[action.validation]\nmaxBundleSize = "1b"\nstrict = true\n' }, (cwd) =>
			Effect.gen(function* () {
				const answer = yield* run(cwd);
				assert.strictEqual(answer.verdict, "failed");
				assert.strictEqual(answer.result.validation.warnings[0]?.code, "MAX_BUNDLE_SIZE_EXCEEDED");
				assert.isTrue(answer.result.build.success);
			}),
		),
	);

	it.live("answers an entry that does not load as failed, keeping validation's warnings", () =>
		withAction(
			{
				...GOOD,
				"action.yml": ACTION_YML.replace("branding:\n  icon: zap\n  color: blue\n", ""),
				"src/main.ts": 'throw new TypeError("broken at load");\n',
			},
			(cwd) =>
				Effect.gen(function* () {
					const answer = yield* run(cwd);
					assert.strictEqual(answer.verdict, "failed");
					assert.strictEqual(answer.result.validation.warnings[0]?.code, "ACTION_YML_NO_BRANDING");
					assert.include(answer.result.build.entries[0]?.error ?? "", "broken at load");
				}),
		),
	);

	it.live("uses ci for strict mode", () =>
		withAction({ ...GOOD, "action.yml": null }, (cwd) =>
			Effect.gen(function* () {
				const local = yield* ActionRun.run({ validate: true, persist: false }, { cwd, ci: false }).pipe(
					Effect.provide(Live),
				);
				assert.strictEqual(local.verdict, "ok");
				const inCi = yield* ActionRun.run({ validate: true, persist: false }, { cwd, ci: true }).pipe(
					Effect.provide(Live),
				);
				assert.strictEqual(inCi.verdict, "failed");
			}),
		),
	);

	it.live("fails NotAnActionError when no [action] table was written", () =>
		withAction({ ...GOOD, "effected.toml": "[package.build]\nminify = false\n" }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* run(cwd).pipe(Effect.flip);
				assert.instanceOf(error, NotAnActionError);
				assert.include(error.message, cwd);
				assert.notInclude(readdirSync(cwd), "dist");
			}),
		),
	);

	it.live("fails NotAPackageError with no package.json", () =>
		withAction({ ...GOOD, "package.json": null }, (cwd) =>
			Effect.gen(function* () {
				assert.instanceOf(yield* run(cwd).pipe(Effect.flip), NotAPackageError);
			}),
		),
	);

	it.live("fails EffectedConfigError on a removed key, naming it", () =>
		withAction({ ...GOOD, "effected.toml": '[action.build]\nnativeDynamicImports = ["x"]\n' }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* run(cwd).pipe(Effect.flip);
				assert.strictEqual(error._tag, "EffectedConfigError");
				assert.include(error.message, "action.build.nativeDynamicImports");
			}),
		),
	);

	it.live("fails with what the builder could not get past, such as a missing entry when not validating", () =>
		withAction({ ...GOOD, "src/main.ts": null }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* run(cwd, { validate: false }).pipe(Effect.flip);
				assert.strictEqual(error._tag, "BundleFailed");
			}),
		),
	);

	it.live("fails with a runs path the persisted copy cannot resolve", () =>
		withAction({ ...GOOD, "action.yml": ACTION_YML.replace("dist/main.js", "dist/elsewhere.js") }, (cwd) =>
			Effect.gen(function* () {
				const error = yield* run(cwd, { persist: true }).pipe(Effect.flip);
				assert.strictEqual(error._tag, "ActionYmlPathError");
			}),
		),
	);
});
