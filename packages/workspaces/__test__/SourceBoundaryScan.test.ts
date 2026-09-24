import { assert, describe, layer } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";
import { SourceBoundary } from "../src/testing.js";

const SEED = {
	"/repo/src/index.ts": 'export { a } from "./a.js";\n',
	"/repo/src/a.ts": "export const a = process.cwd();\n",
	"/repo/src/version.ts": "export const version = process.env.__PACKAGE_VERSION__;\n",
	"/repo/src/nested/b.mts": 'import { env } from "node:process";\nexport const b = env;\n',
	"/repo/src/nested/types.d.ts": "declare const process: { env: Record<string, string> };\n",
	"/repo/src/notes.md": "process everywhere\n",
	"/repo/src/node_modules/dep/index.js": "process.exit(1);\n",
	"/repo/src/loop": MemoryFileSystem.symlink("/repo/src"),
};
const RULES = ["process", "node:process"] as const;

/** A `Path` that reports backslash separators, standing in for win32. */
const BackslashPath = Layer.effect(
	Path.Path,
	Effect.gen(function* () {
		const posix = yield* Path.Path;
		return {
			...posix,
			sep: "\\",
			relative: (from: string, to: string) => posix.relative(from, to).split("/").join("\\"),
		};
	}),
).pipe(Layer.provide(Path.layer));

/**
 * A layer's `it` has no `it.live`, so the suites run without the test services
 * instead: the 3-second `Effect.timeout` guards then run on the real clock and
 * fail as a `TimeoutException` when a walk never ends.
 */
const LIVE_CLOCK = { excludeTestServices: true } as const;

describe("SourceBoundary.scan over a virtual tree", () => {
	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(SEED), Path.layer),
		LIVE_CLOCK,
	)((it) => {
		it.effect("the loop seed really is a symlink to a directory, so the loop test exercises a loop", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual((yield* fs.stat("/repo/src/loop")).type, "Directory");
				assert.strictEqual(yield* fs.realPath("/repo/src/loop"), "/repo/src");
			}),
		);

		it.effect(
			"scans every source file once, skipping declarations, non-sources and node_modules, and survives a symlink loop",
			() =>
				Effect.gen(function* () {
					const scan = yield* SourceBoundary.scan({ root: "/repo/src", rules: RULES });
					assert.deepStrictEqual(scan.files, ["a.ts", "index.ts", "nested/b.mts", "version.ts"]);
					assert.deepStrictEqual(scan.violations, [
						"a.ts:1:18 process process",
						"nested/b.mts:1:21 node:process node:process",
					]);
					assert.deepStrictEqual(scan.allowed, []);
				}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("an allow glob exempts matching files and reports which it exempted", () =>
			Effect.gen(function* () {
				const scan = yield* SourceBoundary.scan({ root: "/repo/src", rules: RULES, allow: ["nested/**"] });
				assert.deepStrictEqual(scan.allowed, ["nested/b.mts"]);
				assert.deepStrictEqual(scan.violations, ["a.ts:1:18 process process"]);
			}).pipe(Effect.timeout("3 seconds")),
		);

		it.effect("a missing root fails as a PlatformError rather than scanning nothing", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(SourceBoundary.scan({ root: "/repo/nope", rules: RULES }));
				assert.strictEqual(error._tag, "PlatformError");
			}),
		);

		it.effect("an uncompilable allow glob fails typed", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					SourceBoundary.scan({ root: "/repo/src", rules: RULES, allow: ["a".repeat(65_537)] }),
				);
				assert.strictEqual(error._tag, "GlobPatternError");
			}),
		);
	});

	layer(
		Layer.mergeAll(MemoryFileSystem.layerWith(SEED), BackslashPath),
		LIVE_CLOCK,
	)((it) => {
		it.effect("reports POSIX paths, and allow globs still match, under a backslash Path", () =>
			Effect.gen(function* () {
				const scan = yield* SourceBoundary.scan({ root: "/repo/src", rules: RULES, allow: ["nested/**"] });
				assert.include(scan.files, "nested/b.mts");
				assert.deepStrictEqual(scan.allowed, ["nested/b.mts"]);
				assert.deepStrictEqual(scan.violations, ["a.ts:1:18 process process"]);
			}).pipe(Effect.timeout("3 seconds")),
		);
	});
});
