import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { Package } from "../src/Package.js";
import type { PackageJsonFileShape } from "../src/PackageJsonFile.js";
import { PackageJsonFile } from "../src/PackageJsonFile.js";
import { PackageManifest } from "../src/PackageManifest.js";

const TARGET = "/repo/package.json";
const OUTSIDE = "/outside/real.json";
const OLD = '{\n  "name": "old",\n  "version": "0.0.1"\n}\n';

const input = { name: "fresh", version: "1.0.0" };

const env = PackageJsonFile.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			MemoryFileSystem.layerWith({ [OUTSIDE]: OLD, [TARGET]: MemoryFileSystem.symlink(OUTSIDE) }),
			Path.layer,
		),
	),
);

describe("PackageJsonFile links", () => {
	const writers = {
		write: (file: PackageJsonFileShape, links?: "follow" | "replace") =>
			Package.decode(input).pipe(
				Effect.flatMap((pkg) => file.write(TARGET, pkg, links === undefined ? undefined : { links })),
			),
		writeManifest: (file: PackageJsonFileShape, links?: "follow" | "replace") =>
			PackageManifest.decode(input).pipe(
				Effect.flatMap((manifest) => file.writeManifest(TARGET, manifest, links === undefined ? undefined : { links })),
			),
		modify: (file: PackageJsonFileShape, links?: "follow" | "replace") =>
			file.modify(TARGET, [{ path: ["version"], value: "9.9.9" }], links === undefined ? undefined : { links }),
	};
	for (const [name, run] of Object.entries(writers)) {
		it.effect(`${name} follows a symlinked target by default`, () =>
			Effect.gen(function* () {
				yield* run(yield* PackageJsonFile);
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.readLink(TARGET), OUTSIDE);
				assert.notStrictEqual(volume.text(OUTSIDE), OLD);
			}).pipe(Effect.provide(env)),
		);
		it.effect(`${name} with links: "follow" keeps the link`, () =>
			Effect.gen(function* () {
				yield* run(yield* PackageJsonFile, "follow");
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.readLink(TARGET), OUTSIDE);
				assert.notStrictEqual(volume.text(OUTSIDE), OLD);
			}).pipe(Effect.provide(env)),
		);
		it.effect(`${name} with links: "replace" replaces the link and leaves its destination alone`, () =>
			Effect.gen(function* () {
				yield* run(yield* PackageJsonFile, "replace");
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(OUTSIDE), OLD);
				assert.strictEqual(volume.lstat(TARGET)?.kind, "file");
				assert.isUndefined(volume.readLink(TARGET));
				assert.include(volume.text(TARGET) ?? "", "version");
			}).pipe(Effect.provide(env)),
		);
	}
});
