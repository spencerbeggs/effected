import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, Schema } from "effect";
import { ConfigFile } from "../src/ConfigFile.js";
import { ConfigResolver } from "../src/ConfigResolver.js";
import { JsonCodec } from "../src/JsonCodec.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("test/LinksConfig") {}

const TARGET = "/app/.apprc";
const OUTSIDE = "/outside/real.apprc";
const OLD = '{"port":1}';

const env = (links?: "follow" | "replace") =>
	ConfigFile.layer(AppConfig, {
		schema: AppShape,
		codec: JsonCodec,
		resolvers: [ConfigResolver.explicitPath(TARGET)],
		strategy: MergeStrategy.firstMatch<AppShape>(),
		...(links !== undefined && { links }),
	}).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				MemoryFileSystem.layerWith({ [OUTSIDE]: OLD, [TARGET]: MemoryFileSystem.symlink(OUTSIDE) }),
				Path.layer,
			),
		),
	);

describe("ConfigFile links", () => {
	for (const [label, links] of [
		["by default", undefined],
		['with links: "follow"', "follow"],
	] as const) {
		it.effect(`write ${label} writes through a symlinked target and keeps the link`, () =>
			Effect.gen(function* () {
				yield* (yield* AppConfig).write(new AppShape({ port: 2 }), TARGET);
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.readLink(TARGET), OUTSIDE);
				assert.deepStrictEqual(JSON.parse(volume.text(OUTSIDE) ?? ""), { port: 2 });
			}).pipe(Effect.provide(env(links))),
		);
	}

	it.effect('write with links: "replace" replaces the link and leaves its destination alone', () =>
		Effect.gen(function* () {
			yield* (yield* AppConfig).write(new AppShape({ port: 2 }), TARGET);
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(OUTSIDE), OLD);
			assert.strictEqual(volume.lstat(TARGET)?.kind, "file");
			assert.isUndefined(volume.readLink(TARGET));
			assert.deepStrictEqual(JSON.parse(volume.text(TARGET) ?? ""), { port: 2 });
		}).pipe(Effect.provide(env("replace"))),
	);

	it.effect('save with links: "replace" replaces the link it found', () =>
		Effect.gen(function* () {
			yield* (yield* AppConfig).save(new AppShape({ port: 3 }));
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(OUTSIDE), OLD);
			assert.isUndefined(volume.readLink(TARGET));
			assert.deepStrictEqual(JSON.parse(volume.text(TARGET) ?? ""), { port: 3 });
		}).pipe(Effect.provide(env("replace"))),
	);

	it.effect('update with links: "replace" replaces the link it found and keeps the decoded value', () =>
		Effect.gen(function* () {
			const updated = yield* (yield* AppConfig).update((current) => new AppShape({ port: current.port + 1 }));
			assert.strictEqual(updated.port, 2);
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(OUTSIDE), OLD);
			assert.strictEqual(volume.lstat(TARGET)?.kind, "file");
			assert.isUndefined(volume.readLink(TARGET));
			assert.deepStrictEqual(JSON.parse(volume.text(TARGET) ?? ""), { port: 2 });
		}).pipe(Effect.provide(env("replace"))),
	);

	it.effect("update by default writes through the link", () =>
		Effect.gen(function* () {
			yield* (yield* AppConfig).update((current) => new AppShape({ port: current.port + 1 }));
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.readLink(TARGET), OUTSIDE);
			assert.deepStrictEqual(JSON.parse(volume.text(OUTSIDE) ?? ""), { port: 2 });
		}).pipe(Effect.provide(env())),
	);
});
