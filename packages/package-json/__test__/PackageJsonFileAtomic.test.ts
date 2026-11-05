import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError } from "effect";
import { Package } from "../src/Package.js";
import { PackageJsonFile, PackageJsonWriteError } from "../src/PackageJsonFile.js";
import { PackageJsonModifyError } from "../src/PackageJsonFormat.js";

const TARGET = "/repo/package.json";
const STALE = `{"name":"stale","version":"0.0.1"}`;

describe("PackageJsonFile.modify — options", () => {
	it.effect("PackageJsonFile.modify forwards both options per edit", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync({ [TARGET]: '{\n  "name": "x",\n  "version": "1.0.0"\n}\n' });
			const layer = PackageJsonFile.layer.pipe(Layer.provide(Layer.mergeAll(handle.layer, Path.layer)));
			const text = yield* Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				return yield* file.modify(TARGET, [
					{ path: ["private"], value: true, insertAfter: "name" },
					{ path: ["catalogs", "silk", "effect"], value: "^4", createParents: true },
					{ path: ["license"], value: "MIT" },
				]);
			}).pipe(Effect.provide(layer));

			const expected =
				'{\n  "name": "x",\n  "private": true,\n  "version": "1.0.0",\n  "catalogs": {\n    "silk": {\n      "effect": "^4"\n    }\n  },\n  "license": "MIT"\n}\n';
			assert.strictEqual(text, expected);
			assert.strictEqual(handle.volume.text(TARGET), expected);
		}),
	);

	it.effect("a created catalogs key lands directly after workspaces", () =>
		Effect.gen(function* () {
			const handle = MemoryFileSystem.makeSync({
				[TARGET]:
					'{\n\t"name": "root",\n\t"workspaces": [\n\t\t"packages/*"\n\t],\n\t"scripts": {\n\t\t"build": "turbo"\n\t}\n}\n',
			});
			const layer = PackageJsonFile.layer.pipe(Layer.provide(Layer.mergeAll(handle.layer, Path.layer)));
			const text = yield* Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				return yield* file.modify(TARGET, [
					{
						path: ["catalogs", "silk", "effect"],
						value: "^4.1.1",
						insertAfter: "workspaces",
						createParents: true,
					},
				]);
			}).pipe(Effect.provide(layer));

			const expected =
				'{\n\t"name": "root",\n\t"workspaces": [\n\t\t"packages/*"\n\t],\n\t"catalogs": {\n\t\t"silk": {\n\t\t\t"effect": "^4.1.1"\n\t\t}\n\t},\n\t"scripts": {\n\t\t"build": "turbo"\n\t}\n}\n';
			assert.strictEqual(text, expected);
			assert.strictEqual(handle.volume.text(TARGET), expected);
		}),
	);

	it.effect("an option on one edit does not reach the next", () =>
		Effect.gen(function* () {
			const source = '{\n  "name": "x"\n}\n';
			const handle = MemoryFileSystem.makeSync({ [TARGET]: source });
			const layer = PackageJsonFile.layer.pipe(Layer.provide(Layer.mergeAll(handle.layer, Path.layer)));
			const error = yield* Effect.gen(function* () {
				const file = yield* PackageJsonFile;
				return yield* Effect.flip(
					file.modify(TARGET, [
						{ path: ["a", "b"], value: 1, createParents: true },
						{ path: ["c", "d"], value: 2 },
					]),
				);
			}).pipe(Effect.provide(layer));

			assert.instanceOf(error, PackageJsonModifyError);
			assert.deepStrictEqual(error.path, ["c", "d"]);
			assert.strictEqual(handle.volume.text(TARGET), source);
		}),
	);
});

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
