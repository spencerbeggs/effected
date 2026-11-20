import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem, Path } from "effect";
import { Effect, Result, Schema } from "effect";
import { ActionConfig, PersistPathError, PersistTarget, ResolvedPersist } from "../../src/index.js";

const CWD = "/ws/actions/one";
const ROOT = "/ws";

const configOf = (persistLocal: unknown = {}) => Schema.decodeUnknownSync(ActionConfig)({ persistLocal });

const inVolume = <A, E>(program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	program.pipe(
		Effect.provide(
			MemoryFileSystem.layerWithPath({
				"/ws/pnpm-workspace.yaml": "",
				"/ws/actions/one/package.json": "{}",
				"/ws/actions/two/package.json": "{}",
				"/link": MemoryFileSystem.symlink("/ws/actions/one"),
			}),
		),
	);

const resolve = (persistLocal?: unknown, cwd = CWD) =>
	inVolume(PersistTarget.resolve(configOf(persistLocal), { cwd, root: ROOT }));

describe("PersistTarget.resolve", () => {
	it.effect("defaults under package base", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve();
			assert.instanceOf(resolved, ResolvedPersist);
			assert.strictEqual(resolved.outputPath, "/ws/actions/one/.github/actions/local");
			assert.isTrue(resolved.keepDist);
			assert.isTrue(resolved.actTemplate);
			assert.strictEqual(resolved.actRoot, "/ws/actions/one");
			assert.strictEqual(resolved.stagingDir, "/ws/actions/one/.action-staging");
		}),
	);

	it.effect("defaults under workspace base", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve({ base: "workspace" });
			assert.strictEqual(resolved.outputPath, "/ws/.github/actions/one");
			assert.isFalse(resolved.actTemplate);
			assert.strictEqual(resolved.actRoot, "/ws");
		}),
	);

	it.effect("explicit path under workspace base resolves against root", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve({ base: "workspace", path: "tools/x" });
			assert.strictEqual(resolved.outputPath, "/ws/tools/x");
		}),
	);

	it.effect("absolute path inside the workspace is accepted", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve({ base: "workspace", path: "/ws/other/y" });
			assert.strictEqual(resolved.outputPath, "/ws/other/y");
		}),
	);

	it.effect("escaping path is refused", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(resolve({ path: "../../../tmp/x" }));
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) {
				assert.instanceOf(result.failure, PersistPathError);
				assert.strictEqual(result.failure.reason, "outside-workspace");
			}
		}),
	);

	it.effect("workspace path inside the package is refused", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(resolve({ base: "workspace", path: "actions/one/out" }));
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "inside-package");
		}),
	);

	it.effect("workspace root and ancestors of the package are refused", () =>
		Effect.gen(function* () {
			for (const path of [".", "actions"]) {
				const result = yield* Effect.result(resolve({ base: "workspace", path }));
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "contains-package");
			}
		}),
	);

	it.effect("a sibling path is accepted", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve({ base: "workspace", path: "actions-out" });
			assert.strictEqual(resolved.outputPath, "/ws/actions-out");
		}),
	);

	it.effect("a path at or under another package is refused, naming it", () =>
		Effect.gen(function* () {
			for (const path of ["actions/two", "actions/two/out"]) {
				const result = yield* Effect.result(resolve({ base: "workspace", path }));
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) {
					assert.strictEqual(result.failure.reason, "inside-other-package");
					assert.strictEqual(result.failure.packageDir, "/ws/actions/two");
					assert.include(result.failure.message, "/ws/actions/two");
				}
			}
		}),
	);

	it.effect("a path merely named after another package is accepted", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve({ base: "workspace", path: ".github/actions/two" });
			assert.strictEqual(resolved.outputPath, "/ws/.github/actions/two");
		}),
	);

	it.effect("a package-based path in the package dist or staging directory is refused", () =>
		Effect.gen(function* () {
			for (const path of ["dist", "dist/action", ".action-staging", ".action-staging/x"]) {
				const result = yield* Effect.result(resolve({ dist: false, path }));
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "inside-package");
			}
		}),
	);

	it.effect("dist = false with enabled = false is refused", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(resolve({ dist: false, enabled: false }));
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "dist-without-persist");
		}),
	);

	it.effect("symlinked package resolves", () =>
		Effect.gen(function* () {
			const resolved = yield* resolve({ base: "workspace" }, "/link");
			assert.strictEqual(resolved.outputPath, "/ws/.github/actions/one");
		}),
	);
});
