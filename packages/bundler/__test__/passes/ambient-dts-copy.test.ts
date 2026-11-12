// Ported from savvy-web/systems packages/tsdown-plugins/__test__/build/ambient-dts-copy.test.ts on 2026-11-06
// packages/bundler/__test__/build/ambient-dts-copy.test.ts
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
import { ConfigValidationError } from "../../src/errors.js";
import type { CopyAmbientDtsOptions } from "../../src/passes/sync-public.js";
import { copyAmbientDts } from "../../src/passes/sync-public.js";

const dir = "/ws/pkg";

/** The package fixture: one ambient source under a long path and an existing out dir. */
const fixture = (extra: MemoryFileSystemSeed = {}) =>
	MemoryFileSystem.makeSync({
		[join(dir, "src/long/path/input-file.d.ts")]: `declare module "pkg/virtual/x" {\n  export const y: number;\n}\n`,
		[join(dir, "out")]: MemoryFileSystem.directory(),
		...extra,
	});

const copyIn = (handle: ReturnType<typeof fixture>, options: CopyAmbientDtsOptions) =>
	copyAmbientDts(options).pipe(Effect.provide(handle.layer));

describe("copyAmbientDts", () => {
	it.effect("copies the source verbatim to outDir/<outName>", () =>
		Effect.gen(function* () {
			const handle = fixture();
			yield* copyIn(handle, {
				ambient: [{ exportKey: "./virtual", source: "./src/long/path/input-file.d.ts", outName: "virtual.d.ts" }],
				srcCwd: dir,
				outDir: join(dir, "out"),
			});
			const dst = join(dir, "out/virtual.d.ts");
			assert.strictEqual(handle.volume.has(dst), true);
			assert.include(handle.volume.text(dst), `declare module "pkg/virtual/x"`);
		}),
	);

	it.effect("creates the subdir for an exportsAsIndexes outName", () =>
		Effect.gen(function* () {
			const handle = fixture();
			yield* copyIn(handle, {
				ambient: [{ exportKey: "./css", source: "./src/long/path/input-file.d.ts", outName: "css/index.d.ts" }],
				srcCwd: dir,
				outDir: join(dir, "out"),
			});
			assert.strictEqual(handle.volume.has(join(dir, "out/css/index.d.ts")), true);
		}),
	);

	it.effect("is byte-stable: an unchanged file is not rewritten", () =>
		Effect.gen(function* () {
			const dst = join(dir, "out/virtual.d.ts");
			// The prior copy carries an old mtime, so a rewrite would move it.
			const handle = fixture({
				[dst]: MemoryFileSystem.file(`declare module "pkg/virtual/x" {\n  export const y: number;\n}\n`, { mtime: 1 }),
			});
			const opts = {
				ambient: [{ exportKey: "./virtual", source: "./src/long/path/input-file.d.ts", outName: "virtual.d.ts" }],
				srcCwd: dir,
				outDir: join(dir, "out"),
			};
			yield* copyIn(handle, opts);
			const mtime1 = handle.volume.mtime(dst);
			assert.strictEqual(mtime1, 1);
			yield* copyIn(handle, opts);
			assert.strictEqual(handle.volume.mtime(dst), mtime1);
		}),
	);

	it.effect("fails ConfigValidationError when the source is missing", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				copyIn(fixture(), {
					ambient: [{ exportKey: "./gone", source: "./src/missing.d.ts", outName: "gone.d.ts" }],
					srcCwd: dir,
					outDir: join(dir, "out"),
				}),
			);
			assert.instanceOf(error, ConfigValidationError);
			assert.match(error.message, /ambient .d.ts source not found/);
		}),
	);

	it.effect("fails ConfigValidationError when the source has a relative import", () =>
		Effect.gen(function* () {
			const handle = fixture({
				[join(dir, "src/rel.d.ts")]: `import type { A } from "./neighbor.js";\nexport type B = A;\n`,
			});
			const error = yield* Effect.flip(
				copyIn(handle, {
					ambient: [{ exportKey: "./rel", source: "./src/rel.d.ts", outName: "rel.d.ts" }],
					srcCwd: dir,
					outDir: join(dir, "out"),
				}),
			);
			assert.instanceOf(error, ConfigValidationError);
			assert.match(error.message, /relative import/);
		}),
	);
});
