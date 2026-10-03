import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Cause, Context, DateTime, Effect, Exit, Layer, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { StoreMigration, StoreOptions } from "../src/index.js";
import { Store, StoreError, StoreMigrationError } from "../src/index.js";
import { applyPending } from "../src/internal/migrator.js";

const dir = mkdtempSync(join(tmpdir(), "effected-store-adopt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const freshFile = () => join(dir, `db-${++counter}.sqlite`);

/**
 * The fixture is produced by effect/sql's own SqliteMigrator, not hand-written
 * SQL: whatever ledger shape and naming it really records is what adoption
 * must read. Keys follow the `fromRecord` `<id>_<name>` convention.
 */
const runEffectMigrator = (
	filename: string,
	keys: Record<string, string>,
	table?: string,
): Effect.Effect<ReadonlyArray<readonly [number, string]>, unknown> =>
	Effect.gen(function* () {
		const record = Object.fromEntries(
			Object.entries(keys).map(([key, statement]) => [
				key,
				Effect.gen(function* () {
					const sql = yield* SqliteClient.SqliteClient;
					yield* sql.unsafe(statement);
				}),
			]),
		);
		return yield* SqliteMigrator.run({
			loader: SqliteMigrator.fromRecord(record),
			...(table !== undefined && { table }),
		});
	}).pipe(Effect.provide(SqliteClient.layer({ filename })));

const legacyKeys = {
	"0001_initial": "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
	"0002_test_artifacts": "CREATE TABLE artifacts (id INTEGER PRIMARY KEY)",
};

// Migration 1 is a plain CREATE TABLE: re-running it against the adopted
// database fails, so "no re-run" is observable rather than assumed.
const initial: StoreMigration = {
	id: 1,
	name: "initial",
	up: (sql) => sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
};
const testArtifacts: StoreMigration = {
	id: 2,
	name: "test_artifacts",
	up: (sql) => sql`CREATE TABLE artifacts (id INTEGER PRIMARY KEY)`,
};
const addTags: StoreMigration = {
	id: 3,
	name: "add_tags",
	up: (sql) => sql`CREATE TABLE tags (name TEXT PRIMARY KEY)`,
};

const openStore = <A, E>(
	filename: string,
	options: StoreOptions,
	use: (store: Store["Service"]) => Effect.Effect<A, E>,
) =>
	Effect.exit(
		Effect.gen(function* () {
			return yield* use(yield* Store);
		}).pipe(Effect.provide(Store.layerSqlite({ ...options, filename }))),
	);

/** Read a database directly, outside any Store, so assertions do not trust the code under test. */
const inspect = <A>(filename: string, read: (db: DatabaseSync) => A): A => {
	const db = new DatabaseSync(filename, { readOnly: true });
	try {
		return read(db);
	} finally {
		db.close();
	}
};
const ownLedger = (filename: string) =>
	inspect(filename, (db) =>
		db.prepare("SELECT id, name, applied_at FROM _store_migrations ORDER BY id").all(),
	) as unknown as ReadonlyArray<{ id: number; name: string; applied_at: string }>;
const foreignLedger = (filename: string, table = "effect_sql_migrations") =>
	inspect(filename, (db) =>
		db.prepare(`SELECT migration_id, name, created_at FROM ${table} ORDER BY migration_id`).all(),
	) as unknown as ReadonlyArray<{ migration_id: number; name: string; created_at: string }>;
const tables = (filename: string) =>
	inspect(filename, (db) =>
		(
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
		).map((row) => row.name),
	);

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown => {
	const cause = Option.getOrThrow(Exit.getCause(exit));
	assert.isFalse(cause.reasons.some(Cause.isDieReason), "a ledger disagreement must be typed, never a defect");
	return cause.reasons.find(Cause.isFailReason)?.error;
};

const assertAdoptFailure = (exit: Exit.Exit<unknown, unknown>, message: RegExp) => {
	const error = failureOf(exit);
	assert.instanceOf(error, StoreError);
	assert.strictEqual((error as StoreError).operation, "adopt");
	const cause = (error as StoreError).cause;
	assert.instanceOf(cause, Error);
	assert.match(cause instanceof Error ? cause.message : "", message);
};

describe("Store adoptMigratorLedger", () => {
	it.effect("fixture control: the SqliteMigrator ledger stores fromRecord keys prefix-stripped", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			const rows = foreignLedger(filename);
			assert.deepStrictEqual(
				rows.map((row) => [row.migration_id, row.name]),
				[
					[1, "initial"],
					[2, "test_artifacts"],
				],
			);
		}),
	);

	it.effect("control: WITHOUT adoption, opening the legacy database re-runs migration 1 and fails", () =>
		Effect.gen(function* () {
			// The mutation check in suite form: if adoption were skipped, this is
			// what every adoption test below would see.
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			const exit = yield* openStore(filename, { migrations: [initial, testArtifacts] }, () => Effect.void);
			const error = failureOf(exit);
			assert.instanceOf(error, StoreMigrationError);
			assert.strictEqual((error as StoreMigrationError).id, 1);
		}),
	);

	it.effect("adopts the foreign history, runs only later migrations, and leaves the foreign table untouched", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			const before = foreignLedger(filename);

			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts, addTags], adoptMigratorLedger: true },
				(store) => store.status,
			);
			assert.isTrue(Exit.isSuccess(exit));

			assert.deepStrictEqual(
				ownLedger(filename).map((row) => [row.id, row.name]),
				[
					[1, "initial"],
					[2, "test_artifacts"],
					[3, "add_tags"],
				],
			);
			assert.include(tables(filename), "tags");
			assert.deepStrictEqual(foreignLedger(filename), before);

			// The adopted rows carry the foreign created_at, read as UTC.
			const status = Exit.isSuccess(exit) ? exit.value : [];
			const first = status.find((entry) => entry.id === 1);
			const createdAt = before[0]?.created_at ?? "";
			assert.isDefined(first?.appliedAt);
			assert.strictEqual(
				first?.appliedAt === undefined ? Number.NaN : DateTime.toEpochMillis(first.appliedAt),
				Date.parse(`${createdAt.replace(" ", "T")}Z`),
			);
		}),
	);

	it.effect("is idempotent: a second open adopts nothing and changes nothing", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			const options: StoreOptions = { migrations: [initial, testArtifacts, addTags], adoptMigratorLedger: true };
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, options, () => Effect.void)));
			const first = ownLedger(filename);
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, options, () => Effect.void)));
			assert.deepStrictEqual(ownLedger(filename), first);
		}),
	);

	it.effect("a database the foreign Migrator never touched builds normally", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts], adoptMigratorLedger: true },
				() => Effect.void,
			);
			assert.isTrue(Exit.isSuccess(exit));
			assert.notInclude(tables(filename), "effect_sql_migrations");
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1, 2],
			);
		}),
	);

	it.effect("reads a custom foreign table name", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys, "legacy_migrations");
			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts], adoptMigratorLedger: { table: "legacy_migrations" } },
				() => Effect.void,
			);
			assert.isTrue(Exit.isSuccess(exit));
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1, 2],
			);
		}),
	);

	describe("a ledger that disagrees fails typed, adopts nothing and applies nothing", () => {
		it.effect("a name mismatch for the same id", () =>
			Effect.gen(function* () {
				const filename = freshFile();
				yield* runEffectMigrator(filename, legacyKeys);
				const renamed: StoreMigration = { ...initial, name: "0001_initial" };
				const exit = yield* openStore(
					filename,
					{ migrations: [renamed, testArtifacts, addTags], adoptMigratorLedger: true },
					() => Effect.void,
				);
				assertAdoptFailure(exit, /migration 1 as "initial", but migration 1 is named "0001_initial"/);
				assert.deepStrictEqual(ownLedger(filename), []);
				assert.notInclude(tables(filename), "tags");
			}),
		);

		it.effect("a foreign row with no migration of that id", () =>
			Effect.gen(function* () {
				const filename = freshFile();
				yield* runEffectMigrator(filename, legacyKeys);
				const exit = yield* openStore(
					filename,
					{ migrations: [initial], adoptMigratorLedger: true },
					() => Effect.void,
				);
				assertAdoptFailure(exit, /records migration 2 "test_artifacts", which has no migration with that id/);
				assert.deepStrictEqual(ownLedger(filename), []);
			}),
		);

		it.effect("a migration below the foreign high-water mark the foreign ledger never recorded", () =>
			Effect.gen(function* () {
				const filename = freshFile();
				yield* runEffectMigrator(filename, {
					"0001_initial": legacyKeys["0001_initial"],
					"0003_add_tags": "CREATE TABLE tags (name TEXT PRIMARY KEY)",
				});
				const exit = yield* openStore(
					filename,
					{ migrations: [initial, testArtifacts, addTags], adoptMigratorLedger: true },
					() => Effect.void,
				);
				assertAdoptFailure(exit, /migration 2 "test_artifacts" is at or below .* latest id 3 but was never recorded/);
				assert.deepStrictEqual(ownLedger(filename), []);
				assert.notInclude(tables(filename), "artifacts");
			}),
		);
	});
});

describe("Store.layerSqliteAs", () => {
	it.effect("provides the consumer's key over its own file and ledger, never the inner Store", () =>
		Effect.gen(function* () {
			class RegistryStore extends Context.Service<RegistryStore, Store["Service"]>()("store-test/RegistryStore") {}
			const registryFile = freshFile();
			const leaked = yield* Effect.gen(function* () {
				const registry = yield* RegistryStore;
				yield* registry.client`INSERT INTO notes (body) VALUES ('kept')`;
				return yield* Effect.serviceOption(Store);
			}).pipe(Effect.provide(Store.layerSqliteAs(RegistryStore, { filename: registryFile, migrations: [initial] })));
			assert.isTrue(Option.isNone(leaked));
			assert.deepStrictEqual(
				ownLedger(registryFile).map((row) => row.name),
				["initial"],
			);
		}),
	);

	it("rejects a key whose shape is incompatible or adds members, and outputs only the key", () => {
		class Keyed extends Context.Service<Keyed, Store["Service"]>()("store-test/Keyed") {}
		class Unrelated extends Context.Service<Unrelated, { readonly name: string }>()("store-test/Unrelated") {}
		class Wider extends Context.Service<Wider, Store["Service"] & { readonly extra: string }>()("store-test/Wider") {}
		const live = Store.layerSqliteAs(Keyed, { filename: ":memory:", migrations: [] });
		// @ts-expect-error the inner Store is provided internally, never output
		const withStore: Layer.Layer<Store | Keyed, unknown, unknown> = live;
		// @ts-expect-error a key over an unrelated shape
		const unrelated = () => Store.layerSqliteAs(Unrelated, { filename: ":memory:", migrations: [] });
		// @ts-expect-error a key over a wider shape would be handed a value missing `extra`
		const wider = () => Store.layerSqliteAs(Wider, { filename: ":memory:", migrations: [] });
		assert.isDefined(withStore);
		assert.isFunction(unrelated);
		assert.isFunction(wider);
	});
});

/** Reversible twins of the fixtures: rollback must be able to drop what adoption claimed. */
const initialR: StoreMigration = { ...initial, down: (sql) => sql`DROP TABLE notes` };
const testArtifactsR: StoreMigration = { ...testArtifacts, down: (sql) => sql`DROP TABLE artifacts` };

const marker = (filename: string) =>
	inspect(filename, (db) => {
		const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_store_meta'").all();
		if (exists.length === 0) return [];
		return db.prepare("SELECT key, value FROM _store_meta WHERE key = 'adoptMigratorLedger'").all();
	}) as unknown as ReadonlyArray<{ key: string; value: string }>;

/** Rewrite one foreign row's created_at, outside any Store, to a value SqliteMigrator would never write. */
const setForeignCreatedAt = (filename: string, id: number, value: string) => {
	const db = new DatabaseSync(filename);
	try {
		db.prepare("UPDATE effect_sql_migrations SET created_at = ? WHERE migration_id = ?").run(value, id);
	} finally {
		db.close();
	}
};

describe("Store adoptMigratorLedger is one-shot", () => {
	it.effect("adopt, rollback(0), reopen: nothing is re-adopted and every migration re-applies from scratch", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			const options: StoreOptions = { migrations: [initialR, testArtifactsR], adoptMigratorLedger: true };

			assert.isTrue(Exit.isSuccess(yield* openStore(filename, options, (store) => store.rollback(0))));
			// The rollback really unwound the adopted history.
			assert.notInclude(tables(filename), "notes");
			assert.notInclude(tables(filename), "artifacts");
			assert.deepStrictEqual(ownLedger(filename), []);
			const adoptedMarker = marker(filename);
			assert.strictEqual(adoptedMarker.length, 1);

			assert.isTrue(Exit.isSuccess(yield* openStore(filename, options, () => Effect.void)));
			// Re-applied, not re-adopted: a re-adoption would record ids 1 and 2
			// WITHOUT running their `up`, leaving both tables missing.
			assert.include(tables(filename), "notes");
			assert.include(tables(filename), "artifacts");
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1, 2],
			);
			assert.deepStrictEqual(marker(filename), adoptedMarker);
		}),
	);

	it.effect("an existing but empty foreign table adopts nothing, applies everything, and records the decision", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, {});
			assert.include(tables(filename), "effect_sql_migrations");
			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts], adoptMigratorLedger: true },
				() => Effect.void,
			);
			assert.isTrue(Exit.isSuccess(exit));
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1, 2],
			);
			assert.include(tables(filename), "notes");
			assert.strictEqual(marker(filename).length, 1);
		}),
	);

	it.effect("adoption is atomic: a failure on the second row records no row and no marker", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			// The ledger exactly as Store creates it, plus a trigger that aborts the
			// SECOND insert. Without the transaction, row 1 would survive.
			const db = new DatabaseSync(filename);
			try {
				db.exec(`
					CREATE TABLE _store_migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);
					CREATE TRIGGER abort_second BEFORE INSERT ON _store_migrations
					WHEN (SELECT COUNT(*) FROM _store_migrations) >= 1
					BEGIN SELECT RAISE(ABORT, 'second insert refused'); END;
				`);
			} finally {
				db.close();
			}
			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts], adoptMigratorLedger: true },
				() => Effect.void,
			);
			const error = failureOf(exit);
			assert.instanceOf(error, StoreError);
			assert.strictEqual((error as StoreError).operation, "adopt");
			assert.deepStrictEqual(ownLedger(filename), []);
			assert.deepStrictEqual(marker(filename), []);
		}),
	);
});

describe("Store adoptMigratorLedger created_at", () => {
	it.effect("a zone-less T timestamp is read as UTC", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			setForeignCreatedAt(filename, 1, "2026-10-03T12:00:00");
			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts], adoptMigratorLedger: true },
				(store) => store.status,
			);
			assert.isTrue(Exit.isSuccess(exit));
			const first = (Exit.isSuccess(exit) ? exit.value : []).find((entry) => entry.id === 1);
			assert.strictEqual(
				first?.appliedAt === undefined ? Number.NaN : DateTime.toEpochMillis(first.appliedAt),
				Date.UTC(2026, 9, 3, 12, 0, 0),
			);
		}),
	);

	it.effect("an unreadable timestamp fails typed and records nothing", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, legacyKeys);
			setForeignCreatedAt(filename, 2, "not a date");
			const exit = yield* openStore(
				filename,
				{ migrations: [initial, testArtifacts], adoptMigratorLedger: true },
				() => Effect.void,
			);
			assertAdoptFailure(exit, /migration 2 with an unreadable created_at "not a date"/);
			assert.deepStrictEqual(ownLedger(filename), []);
			assert.deepStrictEqual(marker(filename), []);
		}),
	);
});

describe("applying a stale plan (concurrent openers)", () => {
	it.effect("a planned migration another connection already applied is skipped, not re-run", () =>
		Effect.gen(function* () {
			// Another process applied migration 1 between this one's ledger read and
			// its apply: model it by handing applyPending a plan that is already stale.
			const filename = freshFile();
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, { migrations: [initial] }, () => Effect.void)));
			const result = yield* Effect.gen(function* () {
				const sql = yield* SqliteClient.SqliteClient;
				return yield* applyPending(sql, "_store_migrations", [initial, testArtifacts]);
			}).pipe(Effect.provide(SqliteClient.layer({ filename })));
			// Migration 1 is a bare CREATE TABLE: re-running it would have failed.
			assert.deepStrictEqual(
				result.applied.map((record) => record.id),
				[2],
			);
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1, 2],
			);
		}),
	);
});

describe("Store adoptMigratorLedger records the decision even when nothing is copied", () => {
	it.effect("the marker, not a tombstone, protects a custom table a later rollback never tracked", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runEffectMigrator(filename, { "0001_initial": legacyKeys["0001_initial"] }, "legacy_migrations");
			const idempotent: StoreMigration = {
				id: 1,
				name: "initial",
				up: (sql) => sql`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
				down: (sql) => sql`DROP TABLE notes`,
			};
			const custom: StoreOptions = { migrations: [idempotent], adoptMigratorLedger: { table: "legacy_migrations" } };
			// Era 1: Store WITHOUT the option fills its own ledger.
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, { migrations: [idempotent] }, () => Effect.void)));
			// Era 2: the option is turned on, with a custom table. The own ledger is
			// non-empty, so nothing is copied, and the decision is recorded (marker 0).
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, custom, () => Effect.void)));
			assert.strictEqual(marker(filename).length, 1);
			// A Store WITHOUT the option rolls everything back. Its tombstone snapshots
			// only the default table, so legacy_migrations cannot be judged from it.
			assert.isTrue(
				Exit.isSuccess(yield* openStore(filename, { migrations: [idempotent] }, (store) => store.rollback(0))),
			);
			assert.notInclude(tables(filename), "notes");

			// Reopen with the custom-table option. The recorded decision skips
			// adoption, so migration 1 simply re-applies. Without the marker,
			// adoption would meet a tombstone that never tracked legacy_migrations
			// and refuse the build, typed.
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, custom, () => Effect.void)));
			assert.include(tables(filename), "notes");
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1],
			);
		}),
	);
});

describe("Store adoptMigratorLedger gap rule counts what is adopted", () => {
	it.effect("a fully rolled-back Migrator history with a hole adopts nothing and builds", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			// A Migrator history of 0001 and 0003 (0002 never existed for it).
			yield* runEffectMigrator(filename, {
				"0001_initial": legacyKeys["0001_initial"],
				"0003_tags": "CREATE TABLE tags (name TEXT PRIMARY KEY)",
			});
			const idempotent = (id: number, name: string, table: string): StoreMigration => ({
				id,
				name,
				up: (sql) => sql.unsafe(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY)`),
				down: (sql) => sql.unsafe(`DROP TABLE ${table}`),
			});
			const migrations = [
				idempotent(1, "initial", "notes"),
				idempotent(2, "middle", "middle"),
				idempotent(3, "tags", "tags"),
			];
			// An option-less Store applies 1..3, then rolls all of it back: every
			// foreign row is now stale.
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, { migrations }, (store) => store.rollback(0))));

			// Nothing is adopted, so the hole at 2 is no gap: everything re-runs.
			const exit = yield* openStore(filename, { migrations, adoptMigratorLedger: true }, () => Effect.void);
			assert.isTrue(Exit.isSuccess(exit));
			assert.deepStrictEqual(
				ownLedger(filename).map((row) => row.id),
				[1, 2, 3],
			);
			for (const table of ["notes", "middle", "tags"]) assert.include(tables(filename), table);
			assert.strictEqual(marker(filename).length, 1);
		}),
	);
});

describe("Store adoptMigratorLedger outside SQLite", () => {
	// The real SQLite client, reporting itself as pg: every onDialectOrElse call
	// takes the pg branch, or the orElse branch when there is none.
	const PgLike = Layer.effect(
		SqlClient.SqlClient,
		Effect.map(
			SqlClient.SqlClient,
			(sql) =>
				new Proxy(sql, {
					get: (target, key, receiver) =>
						key === "onDialectOrElse"
							? (cases: { readonly pg?: () => unknown; readonly orElse: () => unknown }) => (cases.pg ?? cases.orElse)()
							: Reflect.get(target, key, receiver),
				}),
		),
	).pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:" })));

	const build = (options: StoreOptions) =>
		Effect.exit(
			Effect.provide(
				Effect.flatMap(Store, (store) => store.status),
				Store.layer(options).pipe(Layer.provide(PgLike)),
			),
		);

	it.effect("the option is refused, typed, on a non-SQLite dialect", () =>
		Effect.gen(function* () {
			assertAdoptFailure(yield* build({ migrations: [initial], adoptMigratorLedger: true }), /SQLite only/);
		}),
	);

	it.effect("control: without the option the same client builds", () =>
		Effect.gen(function* () {
			assert.isTrue(Exit.isSuccess(yield* build({ migrations: [initial] })));
		}),
	);
});

describe("Store adoptMigratorLedger honours rollback history", () => {
	it.effect(
		"legacy DB, Store without options, rollback(0), then adoption: the unwound id is not adopted and re-runs",
		() =>
			Effect.gen(function* () {
				const filename = freshFile();
				yield* runEffectMigrator(filename, { "0001_initial": legacyKeys["0001_initial"] });
				// Era 1, no options: an idempotent migration over the legacy file.
				const idempotent: StoreMigration = {
					id: 1,
					name: "initial",
					up: (sql) => sql`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`,
					down: (sql) => sql`DROP TABLE notes`,
				};
				assert.isTrue(
					Exit.isSuccess(yield* openStore(filename, { migrations: [idempotent] }, (store) => store.rollback(0))),
				);
				// The rollback dropped notes and left a tombstone; the foreign ledger
				// still says 1 — it is the old program's, and nothing rewrote it.
				assert.notInclude(tables(filename), "notes");
				assert.deepStrictEqual(
					foreignLedger(filename).map((row) => row.migration_id),
					[1],
				);

				// Era 2: adoption turned on. Row 1 is unchanged since the rollback, so it
				// is stale history: not adopted, and migration 1 runs again.
				const exit = yield* openStore(
					filename,
					{ migrations: [idempotent], adoptMigratorLedger: true },
					(store) => store.status,
				);
				assert.isTrue(Exit.isSuccess(exit));
				assert.include(tables(filename), "notes");
				assert.deepStrictEqual(
					ownLedger(filename).map((row) => row.id),
					[1],
				);
				// The marker is still written: adoption decided, and adopted nothing.
				assert.strictEqual(marker(filename).length, 1);
			}),
	);
});
