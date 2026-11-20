// node:path's win32 is allowed here only to build a win32 Path service, so the Windows spelling runs on any host.
import { win32 } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { FileSystem } from "effect";
import { Effect, Layer, Path, Result, Schema } from "effect";
import { ActionConfig, PersistPathError, PersistTarget, ResolvedPersist } from "../../src/index.js";

const configOf = (persistLocal: unknown = {}) => Schema.decodeUnknownSync(ActionConfig)({ persistLocal });

/** A win32 `Path` over node's win32 implementation. */
const win32Path = Path.make({
	sep: win32.sep,
	basename: win32.basename,
	dirname: win32.dirname,
	extname: win32.extname,
	format: win32.format,
	isAbsolute: win32.isAbsolute,
	join: win32.join,
	normalize: win32.normalize,
	parse: win32.parse,
	relative: win32.relative,
	resolve: win32.resolve,
	toNamespacedPath: win32.toNamespacedPath,
	fromFileUrl: () => Effect.die("fromFileUrl is not used"),
	toFileUrl: () => Effect.die("toFileUrl is not used"),
});

/** `C:\ws\x` as the volume's `/C:/ws/x`, and back. */
const toVolume = (path: string) => `/${path.replaceAll("\\", "/")}`;
const fromVolume = (path: string) => path.slice(1).replaceAll("/", "\\");

interface Platform {
	readonly name: string;
	/** A POSIX test path in this platform's spelling. */
	readonly native: (posix: string) => string;
	readonly layer: (seed: MemoryFileSystemSeed) => Layer.Layer<FileSystem.FileSystem | Path.Path>;
}

const posix: Platform = {
	name: "posix",
	native: (path) => path,
	layer: (seed) => MemoryFileSystem.layerWithPath(seed),
};

const windows: Platform = {
	name: "win32",
	native: (path) => (path.startsWith("/") ? `C:${path.replaceAll("/", "\\")}` : path.replaceAll("/", "\\")),
	// The volume is POSIX, so the members the resolver calls are respelled at the boundary.
	layer: (seed) =>
		Layer.merge(
			MemoryFileSystem.layerWith(
				Object.fromEntries(
					Object.entries(seed).map(([key, value]) => [
						`/C:${key}`,
						typeof value === "object" && "_tag" in value && value._tag === "MemoryFileSystemSeedSymlink"
							? MemoryFileSystem.symlink(`/C:${value.target}`)
							: value,
					]),
				),
				{
					faults: (base) => ({
						access: (path, options) => base.access(toVolume(path), options),
						stat: (path) => base.stat(toVolume(path)),
						lstat: (path) => base.lstat(toVolume(path)),
						realPath: (path) => base.realPath(toVolume(path)).pipe(Effect.map(fromVolume)),
					}),
				},
			),
			Layer.succeed(Path.Path, win32Path),
		),
};

const seed: MemoryFileSystemSeed = {
	"/ws/pnpm-workspace.yaml": "",
	"/ws/actions/one/package.json": "{}",
	"/ws/actions/two/package.json": "{}",
	"/link": MemoryFileSystem.symlink("/ws/actions/one"),
};

for (const platform of [posix, windows]) {
	const p = platform.native;
	const CWD = p("/ws/actions/one");
	const ROOT = p("/ws");
	const inVolume = <A, E>(program: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>, extra = {}) =>
		program.pipe(Effect.provide(platform.layer({ ...seed, ...extra })));
	const resolve = (persistLocal?: unknown, cwd = CWD) =>
		inVolume(PersistTarget.resolve(configOf(persistLocal), { cwd, root: ROOT }));

	describe(`PersistTarget.resolve (${platform.name})`, () => {
		it.effect("defaults under package base", () =>
			Effect.gen(function* () {
				const resolved = yield* resolve();
				assert.instanceOf(resolved, ResolvedPersist);
				assert.strictEqual(resolved.outputPath, p("/ws/actions/one/.github/actions/local"));
				assert.isTrue(resolved.keepDist);
				assert.isTrue(resolved.actTemplate);
				assert.strictEqual(resolved.actRoot, p("/ws/actions/one"));
				assert.strictEqual(resolved.stagingDir, p("/ws/actions/one/.action-staging"));
			}),
		);

		it.effect("defaults under workspace base", () =>
			Effect.gen(function* () {
				const resolved = yield* resolve({ base: "workspace" });
				assert.strictEqual(resolved.outputPath, p("/ws/.github/actions/one"));
				assert.isFalse(resolved.actTemplate);
				assert.strictEqual(resolved.actRoot, p("/ws"));
			}),
		);

		it.effect("explicit path under workspace base resolves against root", () =>
			Effect.gen(function* () {
				const resolved = yield* resolve({ base: "workspace", path: "tools/x" });
				assert.strictEqual(resolved.outputPath, p("/ws/tools/x"));
			}),
		);

		it.effect("absolute path inside the workspace is accepted", () =>
			Effect.gen(function* () {
				const resolved = yield* resolve({ base: "workspace", path: p("/ws/other/y") });
				assert.strictEqual(resolved.outputPath, p("/ws/other/y"));
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

		it.effect("a workspace path leaving the workspace is refused", () =>
			Effect.gen(function* () {
				const result = yield* Effect.result(resolve({ base: "workspace", path: "../elsewhere" }));
				assert.isTrue(Result.isFailure(result));
				if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "outside-workspace");
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
				assert.strictEqual(resolved.outputPath, p("/ws/actions-out"));
			}),
		);

		it.effect("a path at or under another package is refused, naming it", () =>
			Effect.gen(function* () {
				for (const path of ["actions/two", "actions/two/out"]) {
					const result = yield* Effect.result(resolve({ base: "workspace", path }));
					assert.isTrue(Result.isFailure(result));
					if (Result.isFailure(result)) {
						assert.strictEqual(result.failure.reason, "inside-other-package");
						assert.strictEqual(result.failure.packageDir, p("/ws/actions/two"));
						assert.include(result.failure.message, p("/ws/actions/two"));
					}
				}
			}),
		);

		it.effect("a path merely named after another package is accepted", () =>
			Effect.gen(function* () {
				const resolved = yield* resolve({ base: "workspace", path: ".github/actions/two" });
				assert.strictEqual(resolved.outputPath, p("/ws/.github/actions/two"));
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
				const resolved = yield* resolve({ base: "workspace" }, p("/link"));
				assert.strictEqual(resolved.outputPath, p("/ws/.github/actions/one"));
			}),
		);
	});
}

describe("PersistTarget.resolve through a symlinked ancestor", () => {
	const resolveOver = (extra: MemoryFileSystemSeed, persistLocal: unknown = { base: "workspace" }) =>
		PersistTarget.resolve(configOf(persistLocal), { cwd: "/ws/actions/one", root: "/ws" }).pipe(
			Effect.provide(posix.layer({ ...seed, ...extra })),
			Effect.result,
		);

	it.effect("an ancestor linking out of the workspace is refused", () =>
		Effect.gen(function* () {
			const result = yield* resolveOver({
				"/outside/keep.txt": "",
				"/ws/.github/actions": MemoryFileSystem.symlink("/outside"),
			});
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "outside-workspace");
		}),
	);

	it.effect("an ancestor linking into another package is refused", () =>
		Effect.gen(function* () {
			const result = yield* resolveOver({ "/ws/.github/actions": MemoryFileSystem.symlink("/ws/actions/two") });
			assert.isTrue(Result.isFailure(result));
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "inside-other-package");
		}),
	);

	it.effect("an ancestor linking inside the workspace resolves to the real directory", () =>
		Effect.gen(function* () {
			const result = yield* resolveOver({
				"/ws/tools/keep.txt": "",
				"/ws/.github/actions": MemoryFileSystem.symlink("/ws/tools"),
			});
			assert.isTrue(Result.isSuccess(result));
			if (Result.isSuccess(result)) assert.strictEqual(result.success.outputPath, "/ws/tools/one");
		}),
	);
});
