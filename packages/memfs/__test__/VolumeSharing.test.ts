// Pins the volume-sharing rule the README teaches: `@effect/vitest`'s
// `layer(L)` builds ONE volume for its whole group, while each
// `Effect.provide` of the same layer value builds a fresh one.

import { assert, describe, it, layer } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { MemoryFileSystem } from "../src/index.js";

const Fixture = MemoryFileSystem.layerWith({ "/config.json": "{}" });

layer(Fixture)("layer(L) shares one volume across its group", (it) => {
	it.effect("an earlier test writes", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString("/out.txt", "x");
		}),
	);

	it.effect("a later test sees the write", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/out.txt"), "x");
		}),
	);
});

describe("Effect.provide builds a fresh volume per provide", () => {
	it.effect("a write under one provide is invisible to the next", () =>
		Effect.gen(function* () {
			yield* Effect.provide(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* fs.writeFileString("/out.txt", "x");
				}),
				Fixture,
			);
			const seen = yield* Effect.provide(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					return yield* fs.exists("/out.txt");
				}),
				Fixture,
			);
			assert.isFalse(seen);
		}),
	);
});
