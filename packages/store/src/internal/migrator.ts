import { DateTime, Effect } from "effect";
import type { SqlClient } from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

/**
 * The migration-ledger engine shared by `Store` (user migrations over
 * `_store_migrations`) and `Cache` (its fixed schema over `_cache_migrations`).
 *
 * The engine is deliberately facade-free: it works over raw records and fails
 * with raw {@link MigratorFailure} values; `Store.ts` and `Cache.ts`
 * materialize the public error classes. It never imports a facade module.
 */

/** A single migration as the engine sees it. */
export interface MigratorMigration {
	readonly id: number;
	readonly name: string;
	readonly up: (sql: SqlClient) => Effect.Effect<void, SqlError>;
	readonly down?: (sql: SqlClient) => Effect.Effect<void, SqlError>;
}

/** An applied or rolled-back migration reference. */
export interface MigratorRecord {
	readonly id: number;
	readonly name: string;
}

/** What a run changed. */
export interface MigratorResult {
	readonly applied: ReadonlyArray<MigratorRecord>;
	readonly rolledBack: ReadonlyArray<MigratorRecord>;
}

/** Raw status row: `appliedAt` is the ledger's ISO-8601 text, absent = pending. */
export interface MigratorStatusRecord {
	readonly id: number;
	readonly name: string;
	readonly appliedAt?: string;
}

/**
 * Raw failure records. `ledger` covers the engine's own SQL (ledger table
 * bookkeeping and the queries around a migration); `migration` covers a
 * user-supplied `up`/`down` failing with a typed `SqlError`. A migration
 * callback that throws is a programmer bug and stays a defect — the engine
 * never catches defects.
 */
export type MigratorFailure =
	| { readonly _tag: "ledger"; readonly cause: SqlError }
	| {
			readonly _tag: "migration";
			readonly direction: "up" | "down";
			readonly id: number;
			readonly name: string;
			readonly cause: SqlError;
	  };

const ledgerFailure = (cause: SqlError): MigratorFailure => ({ _tag: "ledger", cause });

const migrationFailure = (direction: "up" | "down", migration: MigratorRecord, cause: SqlError): MigratorFailure => ({
	_tag: "migration",
	direction,
	id: migration.id,
	name: migration.name,
	cause,
});

/**
 * Validate a migration list as developer wiring: every id must be a positive
 * integer (the `Number.isInteger` guard rejects `NaN` and fractions, which a
 * bare `< 1` comparison would silently admit) and ids must be unique. Returns
 * a description of the first problem, or `undefined` when the list is sound.
 * The facade turns a problem into a construction defect.
 */
export const validateMigrations = (migrations: ReadonlyArray<MigratorMigration>): string | undefined => {
	const seen = new Set<number>();
	for (const migration of migrations) {
		if (!Number.isInteger(migration.id) || migration.id < 1) {
			return `migration ids must be positive integers, received ${migration.id} for "${migration.name}"`;
		}
		if (seen.has(migration.id)) {
			return `duplicate migration id ${migration.id} ("${migration.name}")`;
		}
		seen.add(migration.id);
	}
	return undefined;
};

/** Create the ledger table when absent. */
export const ensureLedger = (sql: SqlClient, table: string): Effect.Effect<void, MigratorFailure> =>
	sql`
		CREATE TABLE IF NOT EXISTS ${sql(table)} (
			id INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at TEXT NOT NULL
		)
	`.pipe(Effect.mapError(ledgerFailure), Effect.asVoid);

/**
 * Apply every pending migration in ascending id order. Each migration's `up`
 * and its ledger insert commit atomically: a failing migration leaves prior
 * migrations applied and itself unrecorded.
 */
export const runPending = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
): Effect.Effect<MigratorResult, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number }>`SELECT id FROM ${sql(table)} ORDER BY id ASC`.pipe(
			Effect.mapError(ledgerFailure),
		);
		const appliedIds = new Set(rows.map((row) => row.id));
		const pending = migrations.filter((migration) => !appliedIds.has(migration.id)).sort((a, b) => a.id - b.id);

		const applied: Array<MigratorRecord> = [];
		for (const migration of pending) {
			yield* sql
				.withTransaction(
					Effect.gen(function* () {
						yield* migration.up(sql).pipe(Effect.mapError((cause) => migrationFailure("up", migration, cause)));
						const appliedAt = DateTime.formatIso(yield* DateTime.now);
						yield* sql`
						INSERT INTO ${sql(table)} (id, name, applied_at)
						VALUES (${migration.id}, ${migration.name}, ${appliedAt})
					`.pipe(Effect.mapError(ledgerFailure));
					}),
				)
				.pipe(Effect.mapError((failure) => (isMigratorFailure(failure) ? failure : ledgerFailure(failure))));
			applied.push({ id: migration.id, name: migration.name });
		}

		return { applied, rolledBack: [] };
	});

/**
 * Roll back applied migrations with `id > toId`, newest first. A migration
 * without a `down` is skipped over — its ledger row is still removed, matching
 * the v3 contract. Each `down` and its ledger delete commit atomically.
 */
export const rollbackTo = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
	toId: number,
): Effect.Effect<MigratorResult, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number; name: string }>`
			SELECT id, name FROM ${sql(table)}
			WHERE id > ${toId}
			ORDER BY id DESC
		`.pipe(Effect.mapError(ledgerFailure));

		const rolledBack: Array<MigratorRecord> = [];
		for (const row of rows) {
			const migration = migrations.find((candidate) => candidate.id === row.id);
			yield* sql
				.withTransaction(
					Effect.gen(function* () {
						if (migration?.down !== undefined) {
							yield* migration.down(sql).pipe(Effect.mapError((cause) => migrationFailure("down", migration, cause)));
						}
						yield* sql`DELETE FROM ${sql(table)} WHERE id = ${row.id}`.pipe(Effect.mapError(ledgerFailure));
					}),
				)
				.pipe(Effect.mapError((failure) => (isMigratorFailure(failure) ? failure : ledgerFailure(failure))));
			rolledBack.push({ id: row.id, name: row.name });
		}

		return { applied: [], rolledBack };
	});

/** Project the full migration list against the ledger. */
export const statusOf = (
	sql: SqlClient,
	table: string,
	migrations: ReadonlyArray<MigratorMigration>,
): Effect.Effect<ReadonlyArray<MigratorStatusRecord>, MigratorFailure> =>
	Effect.gen(function* () {
		const rows = yield* sql<{ id: number; name: string; applied_at: string }>`
			SELECT id, name, applied_at FROM ${sql(table)} ORDER BY id ASC
		`.pipe(Effect.mapError(ledgerFailure));
		const appliedAt = new Map(rows.map((row) => [row.id, row.applied_at]));
		return [...migrations]
			.sort((a, b) => a.id - b.id)
			.map((migration): MigratorStatusRecord => {
				const at = appliedAt.get(migration.id);
				return {
					id: migration.id,
					name: migration.name,
					...(at !== undefined ? { appliedAt: at } : {}),
				};
			});
	});

const isMigratorFailure = (value: MigratorFailure | SqlError): value is MigratorFailure =>
	"_tag" in value && (value._tag === "ledger" || value._tag === "migration");
