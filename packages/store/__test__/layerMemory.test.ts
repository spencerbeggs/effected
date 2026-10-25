// The README's "A real service over an in-memory store" convention, compiled
// and run: one shared implementation, `layer(path)` and `layerMemory()` built
// from it, and a fresh database per `layerMemory()` call.

import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer } from "effect";
import type { StoreMigration } from "../src/index.js";
import { Store } from "../src/index.js";

const migrations: ReadonlyArray<StoreMigration> = [
	{
		id: 1,
		name: "create-snapshots",
		up: (sql) => sql`CREATE TABLE snapshots (name TEXT PRIMARY KEY, body TEXT NOT NULL)`,
		down: (sql) => sql`DROP TABLE snapshots`,
	},
];

interface SnapshotShape {
	readonly save: (name: string, body: string) => Effect.Effect<void>;
	readonly load: (name: string) => Effect.Effect<ReadonlyArray<string>>;
}

class Snapshots extends Context.Service<Snapshots, SnapshotShape>()("test/Snapshots") {
	// The one implementation: written against Store, blind to where the database lives.
	static readonly make = Effect.gen(function* () {
		const sql = (yield* Store).client;
		return {
			save: (name: string, body: string) =>
				sql`INSERT OR REPLACE INTO snapshots (name, body) VALUES (${name}, ${body})`.pipe(Effect.asVoid, Effect.orDie),
			load: (name: string) =>
				sql<{ body: string }>`SELECT body FROM snapshots WHERE name = ${name}`.pipe(
					Effect.map((rows) => rows.map((row) => row.body)),
					Effect.orDie,
				),
		};
	});

	/** Production: the service over a database file. */
	static layer(filename: string) {
		return Layer.effect(Snapshots, Snapshots.make).pipe(Layer.provide(Store.layerSqlite({ filename, migrations })));
	}

	/** Tests: the same service over a fresh in-memory database per call. */
	static layerMemory() {
		return Layer.effect(Snapshots, Snapshots.make).pipe(Layer.provide(Store.layerTest({ migrations })));
	}
}

describe("a real service over an in-memory store", () => {
	it.effect("runs the real implementation, migrations included", () =>
		Effect.gen(function* () {
			const snapshots = yield* Snapshots;
			yield* snapshots.save("a", "one");
			assert.deepStrictEqual(yield* snapshots.load("a"), ["one"]);
		}).pipe(Effect.provide(Snapshots.layerMemory())),
	);

	// Fresh per build: Store.layerTest opens a new :memory: database each time the
	// layer is built. The factory form matters inside ONE composed graph, where a
	// shared const is memoized by reference and two consumers would share a database.
	it.effect("each build is a fresh, empty database", () =>
		Effect.gen(function* () {
			const first = Snapshots.layerMemory();
			yield* Effect.gen(function* () {
				yield* (yield* Snapshots).save("a", "one");
			}).pipe(Effect.provide(first));
			const seen = yield* Effect.gen(function* () {
				return yield* (yield* Snapshots).load("a");
			}).pipe(Effect.provide(Snapshots.layerMemory()));
			assert.deepStrictEqual(seen, []);
		}),
	);

	it.effect("the file layer is built from the same implementation", () =>
		Effect.gen(function* () {
			// :memory: as the filename exercises the layer(path) path without touching disk.
			const snapshots = yield* Snapshots;
			yield* snapshots.save("b", "two");
			assert.deepStrictEqual(yield* snapshots.load("b"), ["two"]);
		}).pipe(Effect.provide(Snapshots.layer(":memory:"))),
	);
});
