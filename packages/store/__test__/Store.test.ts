import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, describe, it, layer } from "@effect/vitest";
import { Cause, Effect, Exit, Layer } from "effect";
import type { StoreMigration } from "../src/index.js";
import { Cache, Store, StoreError, StoreMigrationError } from "../src/index.js";

// The callbacks return the raw statement effects (whose values are rows, not
// void): the engine discards them, so no Effect.asVoid ceremony is needed.
const createNotes: StoreMigration = {
	id: 1,
	name: "create-notes",
	up: (sql) => sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
	down: (sql) => sql`DROP TABLE notes`,
};

// Order-observable: inserting requires the table migration 1 creates, so a
// runner applying by list position (2 before 1) fails with a SqlError.
const seedNotes: StoreMigration = {
	id: 2,
	name: "seed-notes",
	up: (sql) => sql`INSERT INTO notes (body) VALUES ('seeded')`,
	down: (sql) => sql`DELETE FROM notes`,
};

// No `down` on purpose: rollback must skip it but still remove its ledger row.
const addIndex: StoreMigration = {
	id: 3,
	name: "add-index",
	up: (sql) => sql`CREATE INDEX idx_notes_body ON notes (body)`,
};

const acquireStore = Effect.gen(function* () {
	return yield* Store;
});

describe("Store", () => {
	// Migrations listed out of id order: the sort is load-bearing.
	layer(Store.layerTest({ migrations: [seedNotes, createNotes, addIndex] }))((it) => {
		it.effect("construction applies all migrations in id order", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const rows = yield* store.client<{ body: string }>`SELECT body FROM notes`;
				assert.deepStrictEqual(
					rows.map((row) => row.body),
					["seeded"],
				);
			}),
		);

		it.effect("status reports every migration applied", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const status = yield* store.status;
				assert.deepStrictEqual(
					status.map((entry) => [entry.id, entry.name, entry.appliedAt !== undefined]),
					[
						[1, "create-notes", true],
						[2, "seed-notes", true],
						[3, "add-index", true],
					],
				);
			}),
		);

		it.effect("migrate after construction applies nothing", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const result = yield* store.migrate;
				assert.deepStrictEqual(result, { applied: [], rolledBack: [] });
			}),
		);
	});

	layer(Store.layerTest({ migrations: [createNotes, seedNotes, addIndex] }))((it) => {
		it.effect("rollback unwinds past toId newest first, then migrate re-applies", () =>
			Effect.gen(function* () {
				const store = yield* Store;

				// Boundary: the target sits beyond one migration, so rollback(2)
				// must unwind ONLY migration 3.
				const partial = yield* store.rollback(2);
				assert.deepStrictEqual(partial.rolledBack, [{ id: 3, name: "add-index" }]);

				const rest = yield* store.rollback(0);
				assert.deepStrictEqual(rest.rolledBack, [
					{ id: 2, name: "seed-notes" },
					{ id: 1, name: "create-notes" },
				]);

				const status = yield* store.status;
				assert.deepStrictEqual(
					status.map((entry) => entry.appliedAt !== undefined),
					[false, false, false],
				);

				const reapplied = yield* store.migrate;
				assert.deepStrictEqual(
					reapplied.applied.map((entry) => entry.id),
					[1, 2, 3],
				);
			}),
		);
	});

	layer(Store.layerTest({ migrations: [createNotes, seedNotes, addIndex] }))((it) => {
		it.effect("a migration without down is skipped over but leaves the ledger row removed", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				const result = yield* store.rollback(2);
				assert.deepStrictEqual(result.rolledBack, [{ id: 3, name: "add-index" }]);
				// The index survives (no down ran), but the ledger row is gone.
				const status = yield* store.status;
				assert.strictEqual(status.find((entry) => entry.id === 3)?.appliedAt, undefined);
				const indexes = yield* store.client<{ name: string }>`
					SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_notes_body'
				`;
				assert.lengthOf(indexes, 1);
			}),
		);

		it.effect("rollback dies on NaN, fractional and negative toId", () =>
			Effect.gen(function* () {
				const store = yield* Store;
				for (const bad of [Number.NaN, 1.5, -1]) {
					const exit = yield* Effect.exit(store.rollback(bad));
					assert.isTrue(Exit.isFailure(exit));
					if (Exit.isFailure(exit)) {
						assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
						assert.isTrue(exit.cause.reasons.some(Cause.isDieReason));
					}
				}
			}),
		);
	});

	it.effect("an up returning a non-void value (the raw statement effect) applies cleanly", () =>
		Effect.gen(function* () {
			// A SELECT resolves to rows — the least-void value a statement can
			// produce. The engine must discard it and record the migration applied.
			const raw: StoreMigration = {
				id: 1,
				name: "raw-statement",
				up: (sql) =>
					sql`CREATE TABLE raw_notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`.pipe(
						Effect.andThen(sql`INSERT INTO raw_notes (body) VALUES ('raw')`),
						Effect.andThen(sql<{ body: string }>`SELECT body FROM raw_notes`),
					),
			};
			const status = yield* Effect.provide(
				Effect.gen(function* () {
					const store = yield* Store;
					const rows = yield* store.client<{ body: string }>`SELECT body FROM raw_notes`;
					assert.deepStrictEqual(
						rows.map((row) => row.body),
						["raw"],
					);
					return yield* store.status;
				}),
				Store.layerTest({ migrations: [raw] }),
			);
			assert.deepStrictEqual(
				status.map((entry) => [entry.id, entry.name, entry.appliedAt !== undefined]),
				[[1, "raw-statement", true]],
			);
		}),
	);

	describe("construction failures", () => {
		const failing: StoreMigration = {
			id: 2,
			name: "explodes",
			up: (sql) => sql`INSERT INTO does_not_exist (x) VALUES (1)`,
		};

		it.effect("a failing up surfaces StoreMigrationError on the layer channel", () =>
			Effect.gen(function* () {
				const bad = Store.layerTest({ migrations: [createNotes, failing] });
				const error = yield* Effect.flip(Effect.provide(acquireStore, bad));
				assert.instanceOf(error, StoreMigrationError);
				assert.strictEqual(error._tag, "StoreMigrationError");
				assert.strictEqual(error.id, 2);
				assert.strictEqual(error.name, "explodes");
				assert.strictEqual(error.direction, "up");
			}),
		);

		it.effect("a failing up leaves prior migrations applied", () =>
			Effect.gen(function* () {
				const dir = mkdtempSync(join(tmpdir(), "effected-store-"));
				const filename = join(dir, "state.db");
				const failingLayer = Store.layerSqlite({ filename, migrations: [createNotes, failing] });
				const exit = yield* Effect.exit(Effect.provide(acquireStore, failingLayer));
				assert.isTrue(Exit.isFailure(exit));

				// A second, good layer over the SAME file sees migration 1 applied
				// and does not re-run it (the seeded table already exists).
				const good = Store.layerSqlite({ filename, migrations: [createNotes] });
				const status = yield* Effect.provide(
					Effect.gen(function* () {
						const store = yield* Store;
						return yield* store.status;
					}),
					good,
				);
				assert.strictEqual(status.find((entry) => entry.id === 1)?.appliedAt !== undefined, true);
				rmSync(dir, { recursive: true, force: true });
			}),
		);

		it.effect("a throwing up stays a defect, not a typed failure", () =>
			Effect.gen(function* () {
				const throwing: StoreMigration = {
					id: 1,
					name: "throws",
					up: () =>
						Effect.sync(() => {
							throw new Error("programmer bug");
						}),
				};
				const bad = Store.layerTest({ migrations: [throwing] });
				const exit = yield* Effect.exit(Effect.provide(acquireStore, bad));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
					const die = exit.cause.reasons.find(Cause.isDieReason);
					assert.instanceOf(die?.defect, Error);
					assert.notInstanceOf(die?.defect, StoreMigrationError);
					assert.notInstanceOf(die?.defect, StoreError);
				}
			}),
		);

		it.effect("duplicate migration ids die at construction", () =>
			Effect.gen(function* () {
				const bad = Store.layerTest({
					migrations: [createNotes, { ...seedNotes, id: 1 }],
				});
				const exit = yield* Effect.exit(Effect.provide(acquireStore, bad));
				assert.isTrue(Exit.isFailure(exit));
				if (Exit.isFailure(exit)) {
					assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
					assert.isTrue(exit.cause.reasons.some(Cause.isDieReason));
				}
			}),
		);

		it.effect("non-positive-integer migration ids die at construction", () =>
			Effect.gen(function* () {
				for (const badId of [0, -1, 1.5, Number.NaN]) {
					const bad = Store.layerTest({ migrations: [{ ...createNotes, id: badId }] });
					const exit = yield* Effect.exit(Effect.provide(acquireStore, bad));
					assert.isTrue(Exit.isFailure(exit), `id ${badId} should die`);
					if (Exit.isFailure(exit)) {
						assert.isTrue(exit.cause.reasons.some(Cause.isDieReason), `id ${badId} should be a defect`);
					}
				}
			}),
		);
	});

	describe("sharing one database file", () => {
		const dir = mkdtempSync(join(tmpdir(), "effected-store-shared-"));
		afterAll(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		it.effect("a Store and a Cache coexist in one file without ledger collisions", () =>
			Effect.gen(function* () {
				const filename = join(dir, "shared.db");
				const shared = Layer.mergeAll(
					Store.layerSqlite({ filename, migrations: [createNotes] }),
					Cache.layerSqlite({ filename }),
				);
				yield* Effect.provide(
					Effect.gen(function* () {
						const store = yield* Store;
						const cache = yield* Cache;
						yield* cache.set({ key: "k", value: new TextEncoder().encode("v") });
						const status = yield* store.status;
						assert.deepStrictEqual(
							status.map((entry) => entry.id),
							[1],
						);
						assert.isTrue(yield* cache.has("k"));
					}),
					shared,
				);
			}),
		);
	});
});
