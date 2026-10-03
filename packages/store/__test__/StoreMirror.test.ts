import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { StoreMigration, StoreOptions } from "../src/index.js";
import { Store, StoreError } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "effected-store-mirror-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
let counter = 0;
const freshFile = () => join(dir, `db-${++counter}.sqlite`);

/** The same schema, as an OLDER program records it: effect/sql fromRecord keys. */
const legacyRecord = {
	"0001_initial": "CREATE TABLE notes (id INTEGER PRIMARY KEY)",
	"0002_test_artifacts": "CREATE TABLE artifacts (id INTEGER PRIMARY KEY)",
};

/** Run the REAL SqliteMigrator over `filename`, as an older program would; return what it applied. */
const runOldVersion = (filename: string, keys: Record<string, string> = legacyRecord) =>
	Effect.exit(
		SqliteMigrator.run({
			loader: SqliteMigrator.fromRecord(
				Object.fromEntries(
					Object.entries(keys).map(([key, statement]) => [
						key,
						Effect.gen(function* () {
							const sql = yield* SqliteClient.SqliteClient;
							yield* sql.unsafe(statement);
						}),
					]),
				),
			),
		}).pipe(Effect.provide(SqliteClient.layer({ filename }))),
	);

// The same schema, as the NEWER program records it: Store migrations,
// prefix-stripped names, reversible so rollback can be exercised.
const notes: StoreMigration = {
	id: 1,
	name: "initial",
	up: (sql) => sql`CREATE TABLE notes (id INTEGER PRIMARY KEY)`,
	down: (sql) => sql`DROP TABLE notes`,
};
const artifacts: StoreMigration = {
	id: 2,
	name: "test_artifacts",
	up: (sql) => sql`CREATE TABLE artifacts (id INTEGER PRIMARY KEY)`,
	down: (sql) => sql`DROP TABLE artifacts`,
};

const openStore = <A, E>(
	filename: string,
	options: StoreOptions,
	use: (store: Store["Service"]) => Effect.Effect<A, E>,
) => Effect.exit(Effect.flatMap(Store, use).pipe(Effect.provide(Store.layerSqlite({ ...options, filename }))));

const inspect = <A>(filename: string, read: (db: DatabaseSync) => A): A => {
	const db = new DatabaseSync(filename, { readOnly: true });
	try {
		return read(db);
	} finally {
		db.close();
	}
};
const foreignLedger = (filename: string) =>
	inspect(filename, (db) =>
		db.prepare("SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id").all(),
	) as unknown as ReadonlyArray<{ migration_id: number; name: string; created_at: string }>;
const ownIds = (filename: string) =>
	(
		inspect(filename, (db) => db.prepare("SELECT id FROM _store_migrations ORDER BY id").all()) as unknown as Array<{
			id: number;
		}>
	).map((row) => row.id);

const mirrored: StoreOptions = { migrations: [notes, artifacts], mirrorMigratorLedger: true };

describe("Store mirrorMigratorLedger", () => {
	it.effect("a database Store creates fresh is one an older SqliteMigrator finds fully migrated", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));

			// The older program opens the same file: it must apply nothing and not
			// fail. Without the mirror it re-runs 0001 and dies on "table exists".
			const old = yield* runOldVersion(filename);
			assert.isTrue(Exit.isSuccess(old));
			assert.deepStrictEqual(Exit.isSuccess(old) ? old.value : "failed", []);
		}),
	);

	it.effect("control: without the mirror, the older SqliteMigrator re-runs 0001 and fails", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts] }, () => Effect.void)));
			assert.isTrue(Exit.isFailure(yield* runOldVersion(filename)));
		}),
	);

	it.effect(
		"mirrored rows are effect/sql's exact shape: migration_id, prefix-stripped name, current_timestamp form",
		() =>
			Effect.gen(function* () {
				const filename = freshFile();
				assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
				const rows = foreignLedger(filename);
				assert.deepStrictEqual(
					rows.map((row) => [row.migration_id, row.name]),
					[
						[1, "initial"],
						[2, "test_artifacts"],
					],
				);
				for (const row of rows) assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
			}),
	);

	it.effect("rollback deletes the mirrored row, so the older program re-applies exactly what was unwound", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, (store) => store.rollback(1))));
			assert.deepStrictEqual(
				foreignLedger(filename).map((row) => row.migration_id),
				[1],
			);
			const old = yield* runOldVersion(filename);
			assert.deepStrictEqual(Exit.isSuccess(old) ? old.value.map(([id]) => id) : "failed", [2]);
		}),
	);

	it.effect("a ledger that predates the option is brought level on the first build with it on", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts] }, () => Effect.void)));
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
			assert.deepStrictEqual(
				foreignLedger(filename).map((row) => row.migration_id),
				[1, 2],
			);
			assert.isTrue(Exit.isSuccess(yield* runOldVersion(filename)));
		}),
	);

	it.effect("with adoptMigratorLedger: old history adopted once, new migrations mirrored into the same table", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runOldVersion(filename, { "0001_initial": legacyRecord["0001_initial"] });
			const before = foreignLedger(filename);
			const exit = yield* openStore(
				filename,
				{ migrations: [notes, artifacts], adoptMigratorLedger: true, mirrorMigratorLedger: true },
				() => Effect.void,
			);
			assert.isTrue(Exit.isSuccess(exit));
			assert.deepStrictEqual(ownIds(filename), [1, 2]);
			const after = foreignLedger(filename);
			// The adopted row is untouched; the newly applied one was added.
			assert.deepStrictEqual(after[0], before[0]);
			assert.deepStrictEqual(
				after.map((row) => [row.migration_id, row.name]),
				[
					[1, "initial"],
					[2, "test_artifacts"],
				],
			);
		}),
	);

	it.effect("the mirror write shares the migration's transaction: if it fails, the migration does not land", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			// Pre-create effect/sql's ledger with a trigger refusing every insert.
			const db = new DatabaseSync(filename);
			try {
				db.exec(`
					CREATE TABLE effect_sql_migrations (
						migration_id integer PRIMARY KEY NOT NULL,
						created_at datetime NOT NULL DEFAULT current_timestamp,
						name VARCHAR(255) NOT NULL
					);
					CREATE TRIGGER refuse BEFORE INSERT ON effect_sql_migrations
					BEGIN SELECT RAISE(ABORT, 'mirror refused'); END;
				`);
			} finally {
				db.close();
			}
			const exit = yield* openStore(filename, mirrored, () => Effect.void);
			assert.isTrue(Exit.isFailure(exit));
			assert.deepStrictEqual(ownIds(filename), []);
			const tables = inspect(filename, (db) =>
				(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
					(row) => row.name,
				),
			);
			assert.notInclude(tables, "notes");
		}),
	);
});

describe("Store mirrorMigratorLedger outside SQLite", () => {
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

	it.effect("the option is refused, typed, as StoreError setup", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.flatMap(Store, (store) => store.status),
					Store.layer({ migrations: [notes], mirrorMigratorLedger: true }).pipe(Layer.provide(PgLike)),
				),
			);
			const cause = Option.getOrThrow(Exit.getCause(exit));
			const error = cause.reasons.find(Cause.isFailReason)?.error;
			assert.instanceOf(error, StoreError);
			assert.strictEqual((error as StoreError).operation, "setup");
			assert.match((error as StoreError).message, /SQLite only/);
		}),
	);
});
