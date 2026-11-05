import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError } from "effect";
import { Package } from "../src/Package.js";
import { PackageJsonFile, PackageJsonWriteError } from "../src/PackageJsonFile.js";

const TARGET = "/repo/package.json";
const STALE = `{"name":"stale","version":"0.0.1"}`;

describe("PackageJsonFile.write — atomicity", () => {
	it.effect("a failed rename keeps the previous file and removes the temp", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync(
				{ [TARGET]: STALE },
				{
					faults: {
						rename: (from) =>
							Effect.fail(
								PlatformError.systemError({
									_tag: "PermissionDenied",
									module: "FileSystem",
									method: "rename",
									pathOrDescriptor: String(from),
								}),
							),
					},
				},
			);
			const layer = PackageJsonFile.layer.pipe(Layer.provide(Layer.mergeAll(handle.layer, Path.layer)));
			const pkg = yield* Package.decode({ name: "fresh", version: "1.0.0" });
			const error = yield* Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				return yield* Effect.flip(file.write(TARGET, pkg));
			}).pipe(Effect.provide(layer));

			assert.instanceOf(error, PackageJsonWriteError);
			assert.strictEqual(error.path, TARGET);
			assert.strictEqual(handle.volume.text(TARGET), STALE);
			assert.deepStrictEqual(handle.volume.paths(), [TARGET]);
		}),
	);
});
