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
import { applyPending } from "../src/internal/migrator.js";

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
							// One prepared statement each: a multi-statement string would run only its first.
							for (const part of statement.split(";").map((piece) => piece.trim())) {
								if (part.length > 0) yield* sql.unsafe(part);
							}
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

describe("Store mirrorMigratorLedger is two-way for matching rows", () => {
	// Migration 3 inserts a row, so a second run of its `up` is visible as a
	// duplicate — the data-safety failure, not just a DDL error.
	const seedKeys = {
		"0001_initial": "CREATE TABLE notes (id INTEGER PRIMARY KEY)",
		"0002_test_artifacts": "CREATE TABLE artifacts (id INTEGER PRIMARY KEY)",
		"0003_seed": "CREATE TABLE IF NOT EXISTS seeds (label TEXT); INSERT INTO seeds (label) VALUES ('three')",
	};
	const seed: StoreMigration = {
		id: 3,
		name: "seed",
		up: (sql) =>
			Effect.gen(function* () {
				yield* sql`CREATE TABLE IF NOT EXISTS seeds (label TEXT)`;
				yield* sql`INSERT INTO seeds (label) VALUES ('three')`;
			}),
	};
	const seedCount = (filename: string) =>
		Number(
			(inspect(filename, (db) => db.prepare("SELECT COUNT(*) AS n FROM seeds").get()) as { n: number } | undefined)?.n,
		);
	const both: Pick<StoreOptions, "adoptMigratorLedger" | "mirrorMigratorLedger"> = {
		adoptMigratorLedger: true,
		mirrorMigratorLedger: true,
	};

	it.effect("an older program migrating forward is imported, not re-run, when the newer one reopens", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			// Legacy database at 0001.
			yield* runOldVersion(filename, { "0001_initial": seedKeys["0001_initial"] });
			// B1 knows [1,2]: adopts 1, applies and mirrors 2.
			assert.isTrue(
				Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts], ...both }, () => Effect.void)),
			);
			// An older binary shipping 0001..0003 migrates forward: it applies 3.
			const old = yield* runOldVersion(filename, seedKeys);
			assert.deepStrictEqual(Exit.isSuccess(old) ? old.value.map(([id]) => id) : "failed", [3]);
			assert.strictEqual(seedCount(filename), 1);
			// B2 knows [1,2,3]: it must import 3, never run its `up` again.
			assert.isTrue(
				Exit.isSuccess(
					yield* openStore(filename, { migrations: [notes, artifacts, seed], ...both }, () => Effect.void),
				),
			);
			assert.strictEqual(seedCount(filename), 1);
			assert.deepStrictEqual(ownIds(filename), [1, 2, 3]);
		}),
	);

	it.effect("concurrent: a stale plan finds the id in the mirror under the lock and imports it", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(
				Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts], ...both }, () => Effect.void)),
			);
			// Another process — an older binary — applies 3 after this one planned it.
			yield* runOldVersion(filename, seedKeys);
			assert.strictEqual(seedCount(filename), 1);
			const result = yield* Effect.gen(function* () {
				const sql = yield* SqliteClient.SqliteClient;
				return yield* applyPending(sql, "_store_migrations", [seed], "effect_sql_migrations");
			}).pipe(Effect.provide(SqliteClient.layer({ filename })));
			assert.deepStrictEqual(result.applied, []);
			assert.strictEqual(seedCount(filename), 1);
			assert.deepStrictEqual(ownIds(filename), [1, 2, 3]);
		}),
	);

	it.effect("a foreign row with an id no migration has fails typed, and imports nothing", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(
				Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts], ...both }, () => Effect.void)),
			);
			yield* runOldVersion(filename, seedKeys);
			// The newer program does not know 3 at all.
			const exit = yield* openStore(filename, { migrations: [notes, artifacts], ...both }, () => Effect.void);
			const cause = Option.getOrThrow(Exit.getCause(exit));
			assert.isFalse(cause.reasons.some(Cause.isDieReason));
			const error = cause.reasons.find(Cause.isFailReason)?.error as StoreError;
			assert.instanceOf(error, StoreError);
			assert.strictEqual(error.operation, "setup");
			assert.match(error.message, /records migration 3 "seed", which has no migration with that id/);
			assert.deepStrictEqual(ownIds(filename), [1, 2]);
		}),
	);

	it.effect("a foreign row whose name disagrees fails typed", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			assert.isTrue(
				Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts], ...both }, () => Effect.void)),
			);
			yield* runOldVersion(filename, seedKeys);
			const renamed: StoreMigration = { ...seed, name: "0003_seed" };
			const exit = yield* openStore(filename, { migrations: [notes, artifacts, renamed], ...both }, () => Effect.void);
			const error = Option.getOrThrow(Exit.getCause(exit)).reasons.find(Cause.isFailReason)?.error as StoreError;
			assert.instanceOf(error, StoreError);
			assert.match(error.message, /records migration 3 as "seed", but migration 3 is named "0003_seed"/);
			assert.strictEqual(seedCount(filename), 1);
		}),
	);
});

describe("rollback history keeps the mirror's import honest", () => {
	const tables = (filename: string) =>
		inspect(filename, (db) =>
			(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
				(row) => row.name,
			),
		);
	const typedFailure = (exit: Exit.Exit<unknown, unknown>) => {
		const cause = Option.getOrThrow(Exit.getCause(exit));
		assert.isFalse(cause.reasons.some(Cause.isDieReason));
		return cause.reasons.find(Cause.isFailReason)?.error as StoreError;
	};

	it.effect(
		"rollback by a Store WITHOUT the mirror, then reopen with it: the stale row is not imported, the migration re-runs",
		() =>
			Effect.gen(function* () {
				const filename = freshFile();
				// Applied 1,2 with the mirror on: both ledgers hold 1,2.
				assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
				// A Store without the option rolls 2 back: artifacts dropped, own row
				// gone, effect_sql_migrations still says 2 (not this opening's ledger).
				assert.isTrue(
					Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts] }, (store) => store.rollback(1))),
				);
				assert.notInclude(tables(filename), "artifacts");
				assert.deepStrictEqual(
					foreignLedger(filename).map((row) => row.migration_id),
					[1, 2],
				);
				// Reopen with the mirror: 2 must NOT come back as applied without its table.
				assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
				assert.include(tables(filename), "artifacts");
				assert.deepStrictEqual(ownIds(filename), [1, 2]);
			}),
	);

	it.effect("the mirror retired, a rollback and a re-apply without it, then re-enabled: consistent both ways", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const plain: StoreOptions = { migrations: [notes, artifacts] };
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, plain, (store) => store.rollback(1))));
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, plain, () => Effect.void)));
			assert.include(tables(filename), "artifacts");
			// Re-enabled: nothing to import, nothing re-run, and an older program
			// still finds the database fully migrated.
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
			assert.deepStrictEqual(ownIds(filename), [1, 2]);
			const old = yield* runOldVersion(filename);
			assert.deepStrictEqual(Exit.isSuccess(old) ? old.value : "failed", []);
		}),
	);

	it.effect("an older program re-applying after a mirrored rollback is imported, not re-run", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			// Mirror on throughout: the rollback deletes the foreign row too, so its
			// tombstone records "no row"; a row present later was re-applied.
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, (store) => store.rollback(1))));
			const old = yield* runOldVersion(filename);
			assert.deepStrictEqual(Exit.isSuccess(old) ? old.value.map(([id]) => id) : "failed", [2]);
			// Re-running 2's bare CREATE TABLE would fail: success proves it was imported.
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, mirrored, () => Effect.void)));
			assert.deepStrictEqual(ownIds(filename), [1, 2]);
		}),
	);

	it.effect("a rollback that never saw the mirrored table cannot be judged, and is refused typed", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const custom: StoreOptions = {
				migrations: [notes, artifacts],
				mirrorMigratorLedger: { table: "legacy_migrations" },
			};
			assert.isTrue(Exit.isSuccess(yield* openStore(filename, custom, () => Effect.void)));
			// Rolled back by a Store that knows nothing of legacy_migrations.
			assert.isTrue(
				Exit.isSuccess(yield* openStore(filename, { migrations: [notes, artifacts] }, (store) => store.rollback(1))),
			);
			const error = typedFailure(yield* openStore(filename, custom, () => Effect.void));
			assert.instanceOf(error, StoreError);
			assert.strictEqual(error.operation, "setup");
			assert.match(error.message, /legacy_migrations records migration 2, which Store rolled back while not tracking/);
		}),
	);

	it.effect("the gap rule: foreign 1,2,4 against Store migrations 1..4 is refused typed", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			// An older binary whose 0003 never existed: it recorded 1, 2 and 4.
			yield* runOldVersion(filename, {
				"0001_initial": legacyRecord["0001_initial"],
				"0002_test_artifacts": legacyRecord["0002_test_artifacts"],
				"0004_more": "CREATE TABLE more (id INTEGER PRIMARY KEY)",
			});
			const third: StoreMigration = { id: 3, name: "third", up: (sql) => sql`CREATE TABLE third (id INTEGER)` };
			const fourth: StoreMigration = {
				id: 4,
				name: "more",
				up: (sql) => sql`CREATE TABLE more (id INTEGER PRIMARY KEY)`,
			};
			const error = typedFailure(
				yield* openStore(
					filename,
					{ migrations: [notes, artifacts, third, fourth], mirrorMigratorLedger: true },
					() => Effect.void,
				),
			);
			assert.instanceOf(error, StoreError);
			assert.match(
				error.message,
				/migration 3 "third" is at or below effect_sql_migrations's imported id 4 but was never recorded there/,
			);
			assert.deepStrictEqual(ownIds(filename), []);
			assert.notInclude(tables(filename), "third");
		}),
	);
});

describe("false turns both ledger options off", () => {
	it.effect("mirror and adoption set to false create no effect_sql_migrations table", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			const exit = yield* openStore(
				filename,
				{ migrations: [notes, artifacts], mirrorMigratorLedger: false, adoptMigratorLedger: false },
				() => Effect.void,
			);
			assert.isTrue(Exit.isSuccess(exit));
			const tables = inspect(filename, (db) =>
				(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
					(row) => row.name,
				),
			);
			assert.notInclude(tables, "effect_sql_migrations");
			assert.notInclude(tables, "_store_meta");
		}),
	);

	it.effect("adoptMigratorLedger: false adopts nothing from a legacy ledger", () =>
		Effect.gen(function* () {
			const filename = freshFile();
			yield* runOldVersion(filename, { "0001_initial": legacyRecord["0001_initial"] });
			// Off means the legacy history is unknown to Store, exactly as when the
			// option is absent: migration 1 re-runs and its bare CREATE TABLE fails.
			const exit = yield* openStore(
				filename,
				{ migrations: [notes], adoptMigratorLedger: false, mirrorMigratorLedger: false },
				() => Effect.void,
			);
			assert.isTrue(Exit.isFailure(exit));
			assert.deepStrictEqual(ownIds(filename), []);
			const meta = inspect(filename, (db) =>
				db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_store_meta'").all(),
			);
			assert.deepStrictEqual(meta, []);
		}),
	);
});
