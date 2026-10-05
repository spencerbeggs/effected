import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer, Logger, Option, References } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlError from "effect/sql/SqlError";
import type { StoreMigration, StoreShape } from "../src/index.js";
import { Cache, CacheError, Store, StoreError } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "effected-store-lifecycle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const freshFile = () => join(dir, `db-${++counter}.sqlite`);

const failureOf = (exit: Exit.Exit<unknown, unknown>): unknown => {
	const cause = Option.getOrThrow(Exit.getCause(exit));
	assert.isFalse(cause.reasons.some(Cause.isDieReason), "expected a typed failure, not a defect");
	return cause.reasons.find(Cause.isFailReason)?.error;
};

const tables = (filename: string) => {
	const db = new DatabaseSync(filename, { readOnly: true });
	try {
		return (
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
		).map((row) => row.name);
	} finally {
		db.close();
	}
};

const notes: StoreMigration = {
	id: 1,
	name: "initial",
	up: (sql) => sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`,
};
const artifacts: StoreMigration = {
	id: 2,
	name: "test_artifacts",
	up: (sql) => sql`CREATE TABLE artifacts (id INTEGER PRIMARY KEY)`,
};

describe("StoreError.message carries the cause", () => {
	it.effect("an adopt refusal reads as one sentence: operation and reason", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* SqliteMigrator.run({
				loader: SqliteMigrator.fromRecord({
					"0001_initial": Effect.gen(function* () {
						const sql = yield* SqliteClient.SqliteClient;
						yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`;
					}),
				}),
			}).pipe(Effect.provide(SqliteClient.layer({ filename })));

			const misnamed: StoreMigration = { ...notes, name: "initialx" };
			const exit = yield* Effect.exit(
				Effect.provide(Effect.void, Store.layerSqlite({ filename, migrations: [misnamed], adoptMigratorLedger: true })),
			);
			const error = failureOf(exit);
			assert.instanceOf(error, StoreError);
			assert.strictEqual(
				(error as StoreError).message,
				'Store adopt failed: effect_sql_migrations records migration 1 as "initial", but migration 1 is named "initialx"',
			);
			// The structure is kept: the cause is still there to inspect.
			assert.instanceOf((error as StoreError).cause, Error);
		}),
	);

	it.effect("a SQL failure carries the database's own text, not the driver's generic summary", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.void,
					Store.layerSqlite({
						filename: freshFile(),
						migrations: [],
						onConnect: (sql) => sql`SELECT * FROM no_such_table`,
					}),
				),
			);
			const error = failureOf(exit) as StoreError;
			assert.instanceOf(error, StoreError);
			// The direct cause is the SqlError ("Failed to prepare statement"); the
			// message folds in the innermost node:sqlite text instead.
			assert.strictEqual((error.cause as Error).message, "Failed to prepare statement");
			assert.strictEqual(error.message, "Store setup failed: no such table: no_such_table");
		}),
	);

	it.effect("a constraint failure names the constraint and never the bound value", () =>
		Effect.gen(function* () {
			const secret = 424242;
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.void,
					Store.layerSqlite({
						filename: freshFile(),
						migrations: [],
						onConnect: (sql) =>
							Effect.gen(function* () {
								yield* sql`CREATE TEMP TABLE t (id INTEGER PRIMARY KEY)`;
								yield* sql`INSERT INTO t (id) VALUES (${secret})`;
								yield* sql`INSERT INTO t (id) VALUES (${secret})`;
							}),
					}),
				),
			);
			const error = failureOf(exit) as StoreError;
			assert.strictEqual(error.message, "Store setup failed: UNIQUE constraint failed: t.id");
			assert.notInclude(error.message, String(secret));
		}),
	);
});

interface LogRecord {
	readonly message: string;
	readonly level: string;
	readonly annotations: Record<string, unknown>;
}

/** Run `effect` with every Debug-and-above record captured, annotations included. */
const captureLogs = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const records: Array<LogRecord> = [];
		const capture = Logger.make<unknown, void>(({ message, logLevel, fiber }) => {
			const text = Array.isArray(message) ? message.map(String).join(" ") : String(message);
			records.push({
				message: text,
				level: logLevel,
				annotations: { ...fiber.getRef(References.CurrentLogAnnotations) },
			});
		});
		const exit = yield* Effect.exit(effect).pipe(
			Effect.provide(Logger.layer([capture])),
			Effect.provideService(References.MinimumLogLevel, "Debug"),
		);
		return { exit, records };
	});

describe("migration log records (effect/sql's shape)", () => {
	it.effect("one Running migration per applied migration, then Migrations complete with the latest", () =>
		Effect.gen(function* () {
			const { exit, records } = yield* captureLogs(
				Effect.provide(Effect.void, Store.layerSqlite({ filename: freshFile(), migrations: [notes, artifacts] })),
			);
			assert.isTrue(Exit.isSuccess(exit));
			const running = records.filter((record) => record.message === "Running migration");
			assert.deepStrictEqual(
				running.map((record) => [record.level, record.annotations.migration_id, record.annotations.migration_name]),
				[
					["Debug", "1", "initial"],
					["Debug", "2", "test_artifacts"],
				],
			);
			const complete = records.filter((record) => record.message === "Migrations complete");
			assert.strictEqual(complete.length, 1);
			assert.strictEqual(complete[0]?.annotations.latest_migration_id, "2");
			assert.strictEqual(complete[0]?.annotations.latest_migration_name, "test_artifacts");
		}),
	);

	it.effect("a reopen with nothing pending logs only the completion record", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const StoreLive = Store.layerSqlite({ filename, migrations: [notes] });
			assert.isTrue(Exit.isSuccess(yield* Effect.exit(Effect.provide(Effect.void, StoreLive))));
			const { records } = yield* captureLogs(
				Effect.provide(Effect.void, Store.layerSqlite({ filename, migrations: [notes] })),
			);
			assert.strictEqual(records.filter((record) => record.message === "Running migration").length, 0);
			assert.strictEqual(records.filter((record) => record.message === "Migrations complete").length, 1);
		}),
	);

	it.effect("adoption that copies rows logs a summary record", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* SqliteMigrator.run({
				loader: SqliteMigrator.fromRecord({
					"0001_initial": Effect.gen(function* () {
						const sql = yield* SqliteClient.SqliteClient;
						yield* sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`;
					}),
				}),
			}).pipe(Effect.provide(SqliteClient.layer({ filename })));
			const { exit, records } = yield* captureLogs(
				Effect.provide(
					Effect.void,
					Store.layerSqlite({ filename, migrations: [notes, artifacts], adoptMigratorLedger: true }),
				),
			);
			assert.isTrue(Exit.isSuccess(exit));
			const adopted = records.find((record) => record.message === "Adopted migrator ledger");
			assert.isDefined(adopted);
			assert.strictEqual(adopted?.annotations.adopted_count, "1");
			assert.strictEqual(adopted?.annotations.migrator_table, "effect_sql_migrations");
			// Only the migration above the adopted history actually ran.
			assert.deepStrictEqual(
				records
					.filter((record) => record.message === "Running migration")
					.map((record) => record.annotations.migration_id),
				["2"],
			);
		}),
	);

	it.effect("Cache's own ledger shares the engine and logs the same records", () =>
		Effect.gen(function* () {
			const { exit, records } = yield* captureLogs(
				Effect.provide(Effect.void, Cache.layerSqlite({ filename: freshFile() })),
			);
			assert.isTrue(Exit.isSuccess(exit));
			assert.isAbove(records.filter((record) => record.message === "Running migration").length, 0);
			assert.strictEqual(records.filter((record) => record.message === "Migrations complete").length, 1);
		}),
	);
});

const parentChild: ReadonlyArray<StoreMigration> = [
	{ id: 1, name: "parents", up: (sql) => sql`CREATE TABLE parents (id INTEGER PRIMARY KEY)` },
	{
		id: 2,
		name: "children",
		up: (sql) =>
			sql`CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents (id) ON DELETE RESTRICT)`,
	},
];

/** Insert a parent and its child, then try to delete the parent. */
const deleteReferencedParent = Effect.gen(function* () {
	const store = yield* Store;
	yield* store.client`INSERT INTO parents (id) VALUES (1)`;
	yield* store.client`INSERT INTO children (id, parent_id) VALUES (1, 1)`;
	return yield* Effect.exit(store.client`DELETE FROM parents WHERE id = 1`);
});

describe("onConnect", () => {
	it.effect("by default the connection already enforces foreign keys: a RESTRICT violation fails", () =>
		Effect.gen(function* () {
			// node:sqlite opens every connection with foreign_keys = 1
			// (DatabaseSync's enableForeignKeyConstraints defaults to true), and the
			// driver does not override it.
			const deleted = yield* deleteReferencedParent.pipe(
				Effect.provide(Store.layerSqlite({ filename: freshFile(), migrations: parentChild })),
			);
			assert.isTrue(Exit.isFailure(deleted));
		}),
	);

	it.effect("the hook reaches Store's own connection, outside any transaction", () =>
		Effect.gen(function* () {
			// PRAGMA foreign_keys is a no-op inside a transaction, so this only
			// takes effect if the hook really runs on the connection, outside one.
			const deleted = yield* deleteReferencedParent.pipe(
				Effect.provide(
					Store.layerSqlite({
						filename: freshFile(),
						migrations: parentChild,
						onConnect: (sql) => sql`PRAGMA foreign_keys = OFF`,
					}),
				),
			);
			assert.isTrue(Exit.isSuccess(deleted));
		}),
	);

	it.effect("the hook runs before the ledger: a failing hook leaves the file without one", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.void,
					Store.layerSqlite({ filename, migrations: [notes], onConnect: (sql) => sql`SELECT * FROM no_such_table` }),
				),
			);
			assert.strictEqual((failureOf(exit) as StoreError).operation, "setup");
			assert.notInclude(tables(filename), "_store_migrations");
			assert.notInclude(tables(filename), "notes");
		}),
	);

	it.effect("Cache takes the same hook; a failure is CacheError setup", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.void,
					Cache.layerSqlite({ filename: freshFile(), onConnect: (sql) => sql`SELECT * FROM no_such_table` }),
				),
			);
			const error = failureOf(exit);
			assert.instanceOf(error, CacheError);
			assert.strictEqual((error as CacheError).operation, "setup");
		}),
	);
});

describe("driver setup failures", () => {
	// SqliteClient.layer fails with a typed SqlError when the database cannot be
	// opened, configured or switched to WAL. The batteries-included layers
	// re-raise it as their own setup error, keeping their declared unions.
	const unopenable = () => join(dir, "no-such-dir", `db-${++counter}.sqlite`);

	it.effect("Store.layerSqlite reports an unopenable file as StoreError setup, not a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(Effect.void, Store.layerSqlite({ filename: unopenable(), migrations: [] })),
			);
			const error = failureOf(exit);
			assert.instanceOf(error, StoreError);
			assert.strictEqual((error as StoreError).operation, "setup");
			assert.instanceOf((error as StoreError).cause, SqlError.SqlError);
		}),
	);

	it.effect("Cache.layerSqlite reports an unopenable file as CacheError setup, not a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(Effect.provide(Effect.void, Cache.layerSqlite({ filename: unopenable() })));
			const error = failureOf(exit);
			assert.instanceOf(error, CacheError);
			assert.strictEqual((error as CacheError).operation, "setup");
			assert.instanceOf((error as CacheError).cause, SqlError.SqlError);
		}),
	);
});

describe("Store.sqlClient", () => {
	class RegistryStore extends Context.Service<RegistryStore, StoreShape>()("lifecycle/RegistryStore") {}

	it.effect("bridges a keyed store's client to the bare SqlClient", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const RegistryLive = Store.layerSqliteAs(RegistryStore, { filename, migrations: [notes] });
			// A query written against the bare SqlClient, as an existing Live layer would be.
			const viaSqlClient = Effect.gen(function* () {
				const sql = yield* SqlClient.SqlClient;
				yield* sql`INSERT INTO notes (id) VALUES (7)`;
				return yield* sql<{ id: number }>`SELECT id FROM notes`;
			});
			const rows = yield* viaSqlClient.pipe(
				Effect.provide(Store.sqlClient(RegistryStore).pipe(Layer.provide(RegistryLive))),
			);
			assert.deepStrictEqual(
				rows.map((row) => row.id),
				[7],
			);
		}),
	);
});
