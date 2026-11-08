import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { SchemaFile, StoreDocument } from "../src/index.js";

const document = StoreDocument.make({
	$schema: "http://json-schema.org/draft-07/schema#",
	$id: "https://example.com/x.schema.json",
	root: { type: "object" },
	defs: {},
});

const TARGET = "/repo/schemas/x.schema.json";
const OUTSIDE = "/outside/real.schema.json";

const env = SchemaFile.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			MemoryFileSystem.layerWith({ [OUTSIDE]: "old", [TARGET]: MemoryFileSystem.symlink(OUTSIDE) }),
			Path.layer,
		),
	),
);

describe("SchemaFile.write links", () => {
	for (const [label, options] of [
		["by default", undefined],
		['with links: "follow"', { links: "follow" }],
	] as const) {
		it.effect(`${label} writes through a symlinked target and keeps the link`, () =>
			Effect.gen(function* () {
				const outcome = yield* (yield* SchemaFile).write(TARGET, document, options);
				assert.strictEqual(outcome.outcome, "written");
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.readLink(TARGET), OUTSIDE);
				assert.notStrictEqual(volume.text(OUTSIDE), "old");
			}).pipe(Effect.provide(env)),
		);
	}

	it.effect('with links: "replace" replaces the link and leaves its destination alone', () =>
		Effect.gen(function* () {
			const outcome = yield* (yield* SchemaFile).write(TARGET, document, { links: "replace" });
			assert.strictEqual(outcome.outcome, "written");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(OUTSIDE), "old");
			assert.strictEqual(volume.lstat(TARGET)?.kind, "file");
			assert.isUndefined(volume.readLink(TARGET));
			assert.include(volume.text(TARGET) ?? "", "x.schema.json");
		}).pipe(Effect.provide(env)),
	);
});
