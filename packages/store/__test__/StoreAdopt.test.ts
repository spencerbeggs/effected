import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqliteMigrator from "@effect/sql-sqlite-node/SqliteMigrator";
import { afterAll, assert, describe, it } from "@effect/vitest";
import type { Layer } from "effect";
import { Cause, Context, DateTime, Effect, Exit, Option } from "effect";
import type { StoreMigration, StoreOptions } from "../src/index.js";
import { Store, StoreError, StoreMigrationError } from "../src/index.js";

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

	it("rejects a key whose service is not exactly StoreShape, and outputs only the key", () => {
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
