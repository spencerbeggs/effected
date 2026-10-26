import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { NodeSyncFileSystem } from "@effected/memfs/node-sync";
import type { FileSystem, Path } from "effect";
import { Cause, Deferred, Effect, Exit, Fiber } from "effect";
import * as Migrator from "effect/sql/Migrator";
import { SqlClient } from "effect/sql/SqlClient";
import type { StoreMigration } from "../src/index.js";
import { Store, StoreError, StoreMigrationError } from "../src/index.js";

const root = mkdtempSync(join(tmpdir(), "effected-store-migrate-once-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let fileCount = 0;
/** A fresh directory per test, so the process-wide registry never sees a key twice across tests. */
const freshDir = (): string => {
	fileCount += 1;
	const dir = join(root, `case-${fileCount}`);
	mkdirSync(dir);
	return dir;
};

const tables = (file: string): ReadonlyArray<string> => {
	const db = new DatabaseSync(file);
	try {
		return (
			db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
		).map((row) => row.name);
	} finally {
		db.close();
	}
};

/** One migration that counts its runs and creates `notes`. */
const counted = () => {
	const counter = { runs: 0 };
	const migrations: ReadonlyArray<StoreMigration> = [
		{
			id: 1,
			name: "notes",
			up: (sql) =>
				Effect.suspend(() => {
					counter.runs += 1;
					return sql`CREATE TABLE notes (body TEXT)`;
				}),
		},
	];
	return { counter, migrations };
};

const provide = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
	effect.pipe(Effect.provide(NodeSyncFileSystem.layerWithPath));

describe("Store.fromMigratorRecord", () => {
	// Every shape the grammar treats specially: leading zeros, an underscore in
	// the name, a non-match, a line break in the name, a leading underscore, a
	// non-ASCII digit, id 0, two keys with one id, and an id past 2^53.
	const keys = [
		"0001_initial",
		"10_tenth",
		"2_second",
		"0003_name_with_underscores",
		"no-id",
		"4_line\nbreak",
		"_5_leading",
		"٣_arabic_indic",
		"0_zero",
		"6_a",
		"06_b",
		"9007199254740993_huge",
		"7_",
		"8_x.y z",
	];
	const record = Object.fromEntries(keys.map((key) => [key, Effect.void]));

	it.effect("parses keys exactly as effect/sql's Migrator.fromRecord does", () =>
		Effect.gen(function* () {
			const core = yield* Migrator.fromRecord(record);
			const ours = Store.fromMigratorRecord(record);
			assert.deepStrictEqual(
				ours.map((migration) => [migration.id, migration.name]),
				core.map(([id, name]) => [id, name]),
			);
			// The control: the table above really exercises the drops and the collisions.
			assert.isFalse(ours.some((migration) => migration.name.includes("\n") || migration.name === "arabic_indic"));
			assert.strictEqual(ours.filter((migration) => migration.id === 6).length, 2);
		}),
	);

	it("maps a prefixed key to effect/sql's recorded id and name", () => {
		const [first] = Store.fromMigratorRecord({ "0001_initial": Effect.void });
		assert.strictEqual(first?.id, 1);
		assert.strictEqual(first?.name, "initial");
		assert.isUndefined(first?.down);
	});

	it.effect("provides each migration with the store's SqlClient", () =>
		Effect.gen(function* () {
			const migrations = Store.fromMigratorRecord({
				"0001_initial": Effect.flatMap(SqlClient, (sql) => sql`CREATE TABLE notes (body TEXT)`),
			});
			const rows = yield* Effect.gen(function* () {
				const store = yield* Store;
				yield* store.client`INSERT INTO notes (body) VALUES (${"hello"})`;
				return yield* store.client<{ body: string }>`SELECT body FROM notes`;
			}).pipe(Effect.provide(Store.layerTest({ migrations })));
			assert.deepStrictEqual(
				rows.map((row) => row.body),
				["hello"],
			);
		}),
	);

	it.effect("leaves an id effect/sql would never run to Store's wiring check", () =>
		Effect.gen(function* () {
			const migrations = Store.fromMigratorRecord({ "0_zero": Effect.void });
			const exit = yield* Effect.exit(Effect.provide(Effect.void, Store.layerTest({ migrations })));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
		}),
	);
});

describe("Store.migrateOnce", () => {
	it.effect("shares one run between concurrent callers", () =>
		Effect.gen(function* () {
			const filename = join(freshDir(), "state.db");
			const { counter, migrations } = counted();
			let builds = 0;
			const onConnect = () => Effect.sync(() => (builds += 1));
			yield* Effect.all(
				Array.from({ length: 8 }, () => Store.migrateOnce({ filename, migrations, onConnect })),
				{ concurrency: "unbounded" },
			);
			assert.strictEqual(builds, 1);
			assert.strictEqual(counter.runs, 1);
			assert.include(tables(filename), "notes");
		}).pipe(provide),
	);

	it.effect("keys on the real path: absolute, symlinked and relative spellings share the run", () =>
		Effect.gen(function* () {
			const dir = freshDir();
			const link = `${dir}-link`;
			symlinkSync(dir, link);
			const { counter, migrations } = counted();
			// Count connections, not `up` runs: a second build would re-check the
			// ledger and skip `up`, so only the build count can see a duplicate run.
			let builds = 0;
			const onConnect = () => Effect.sync(() => (builds += 1));
			yield* Store.migrateOnce({ filename: join(dir, "state.db"), migrations, onConnect });
			yield* Store.migrateOnce({ filename: join(link, "state.db"), migrations, onConnect });
			yield* Store.migrateOnce({ filename: relative(process.cwd(), join(dir, "state.db")), migrations, onConnect });
			assert.strictEqual(builds, 1);
			assert.strictEqual(counter.runs, 1);
		}).pipe(provide),
	);

	it.effect("runs again for a different migration set on the same file", () =>
		Effect.gen(function* () {
			const filename = join(freshDir(), "state.db");
			const first = counted();
			yield* Store.migrateOnce({ filename, migrations: first.migrations });
			let secondRuns = 0;
			const extended: ReadonlyArray<StoreMigration> = [
				...first.migrations,
				{
					id: 2,
					name: "tags",
					up: (sql) =>
						Effect.suspend(() => {
							secondRuns += 1;
							return sql`CREATE TABLE tags (name TEXT)`;
						}),
				},
			];
			yield* Store.migrateOnce({ filename, migrations: extended });
			assert.strictEqual(first.counter.runs, 1);
			assert.strictEqual(secondRuns, 1);
			assert.includeMembers([...tables(filename)], ["notes", "tags"]);
		}).pipe(provide),
	);

	it.effect("does not cache a failure: every waiter sees it, and the next call retries", () =>
		Effect.gen(function* () {
			const filename = join(freshDir(), "state.db");
			let attempts = 0;
			const migrations: ReadonlyArray<StoreMigration> = [
				{
					id: 1,
					name: "flaky",
					up: (sql) =>
						Effect.suspend(() => {
							attempts += 1;
							return attempts === 1 ? sql`SELECT * FROM no_such_table` : sql`CREATE TABLE notes (body TEXT)`;
						}),
				},
			];
			const failures = yield* Effect.all(
				Array.from({ length: 3 }, () => Effect.flip(Store.migrateOnce({ filename, migrations }))),
				{ concurrency: "unbounded" },
			);
			assert.strictEqual(attempts, 1);
			for (const failure of failures) assert.instanceOf(failure, StoreMigrationError);
			yield* Store.migrateOnce({ filename, migrations });
			assert.strictEqual(attempts, 2);
			assert.include(tables(filename), "notes");
		}).pipe(provide),
	);

	it.effect("interrupting the first caller does not cancel the shared run", () =>
		Effect.gen(function* () {
			const filename = join(freshDir(), "state.db");
			const started = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			let runs = 0;
			const migrations: ReadonlyArray<StoreMigration> = [
				{
					id: 1,
					name: "slow",
					up: (sql) =>
						Effect.gen(function* () {
							runs += 1;
							yield* Deferred.succeed(started, undefined);
							yield* Deferred.await(release);
							return yield* sql`CREATE TABLE notes (body TEXT)`;
						}),
				},
			];
			const first = yield* Effect.forkChild(Store.migrateOnce({ filename, migrations }));
			yield* Deferred.await(started);
			yield* Fiber.interrupt(first);
			const second = yield* Effect.forkChild(Store.migrateOnce({ filename, migrations }));
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(second);
			assert.strictEqual(runs, 1);
			assert.include(tables(filename), "notes");
		}).pipe(provide),
	);

	it.effect("fails typed as setup when the directory does not exist", () =>
		Effect.gen(function* () {
			const filename = join(root, "missing", "state.db");
			const error = yield* Effect.flip(Store.migrateOnce({ filename, migrations: [] }));
			assert.instanceOf(error, StoreError);
			assert.strictEqual(error._tag === "StoreError" ? error.operation : undefined, "setup");
		}).pipe(provide),
	);

	it.effect("dies on a filename that names no shared file", () =>
		Effect.gen(function* () {
			for (const filename of [":memory:", "", "file:state.db?mode=memory"]) {
				const exit = yield* Effect.exit(Store.migrateOnce({ filename, migrations: [] }));
				assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause), filename);
			}
		}).pipe(provide),
	);
});
