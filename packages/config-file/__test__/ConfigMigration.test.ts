import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Option } from "effect";
import { ConfigCodec } from "../src/ConfigCodec.js";
import { ConfigMigration, ConfigMigrationError } from "../src/ConfigMigration.js";

const bump = (version: number, name: string, fn: (raw: Record<string, unknown>) => Record<string, unknown>) => ({
	version,
	name,
	up: (raw: unknown) => Effect.succeed(fn(raw as Record<string, unknown>)),
});

describe("ConfigMigration.make", () => {
	it.effect("applies pending migrations in ascending order and stamps the version", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({
				codec: ConfigCodec.json,
				migrations: [bump(3, "add-c", (r) => ({ ...r, c: 3 })), bump(2, "add-b", (r) => ({ ...r, b: 2 }))],
			});
			const parsed = yield* codec.parse(`{"version":1,"a":1}`);
			assert.deepStrictEqual(parsed, { version: 3, a: 1, b: 2, c: 3 });
		}),
	);

	it.effect("skips migrations at or below the current version", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({
				codec: ConfigCodec.json,
				migrations: [bump(2, "add-b", (r) => ({ ...r, b: 2 }))],
			});
			const parsed = yield* codec.parse(`{"version":2,"a":1}`);
			assert.deepStrictEqual(parsed, { version: 2, a: 1 });
		}),
	);

	it.effect("fails with ConfigMigrationError naming the step — not a reason string", () =>
		Effect.gen(function* () {
			const boom = new Error("upstream exploded");
			const codec = ConfigMigration.make({
				codec: ConfigCodec.json,
				migrations: [{ version: 2, name: "add-b", up: () => Effect.fail(boom) }],
			});
			const error = yield* Effect.flip(codec.parse(`{"version":1}`));
			assert.instanceOf(error, ConfigMigrationError);
			assert.strictEqual(error._tag, "ConfigMigrationError");
			assert.strictEqual((error as ConfigMigrationError).name, "add-b");
			assert.strictEqual((error as ConfigMigrationError).version, 2);
			assert.strictEqual((error as ConfigMigrationError).phase, "apply");
			// identity preserved — not String(e), not e.message, not a reason string.
			assert.strictEqual((error as ConfigMigrationError).cause, boom);
		}),
	);

	it.effect("fails with phase read-version when the version field is missing", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({
				codec: ConfigCodec.json,
				migrations: [bump(2, "add-b", (r) => r)],
			});
			const error = yield* Effect.flip(codec.parse(`{"a":1}`));
			assert.strictEqual((error as ConfigMigrationError).phase, "read-version");
		}),
	);

	it.effect("a codec failure surfaces as ConfigCodecError, not ConfigMigrationError", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({ codec: ConfigCodec.json, migrations: [bump(2, "x", (r) => r)] });
			const error = yield* Effect.flip(codec.parse("{ not json"));
			assert.strictEqual(error._tag, "ConfigCodecError");
		}),
	);

	it.effect("with no migrations, parse is the inner codec's parse", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({ codec: ConfigCodec.json, migrations: [] });
			assert.deepStrictEqual(yield* codec.parse(`{"a":1}`), { a: 1 });
		}),
	);

	it.effect("a migration that throws instead of failing its Effect is a defect, not a typed error", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({
				codec: ConfigCodec.json,
				migrations: [
					{
						version: 2,
						name: "throws-sync",
						up: () => {
							throw new Error("bug");
						},
					},
				],
			});
			const exit = yield* Effect.exit(codec.parse(`{"version":1}`));
			assert.isTrue(Exit.isFailure(exit));
			const cause = Exit.getCause(exit);
			assert.isTrue(Option.isSome(cause));
			if (Option.isSome(cause)) {
				// A throw from caller-supplied migration code is a programmer bug: it stays a
				// defect so catchTag("ConfigMigrationError") cannot silently swallow it.
				assert.isTrue(Cause.hasDies(cause.value));
				assert.isFalse(Cause.hasFails(cause.value));
			}
		}),
	);

	it.effect("a throw inside the returned Effect dies the same way", () =>
		Effect.gen(function* () {
			const codec = ConfigMigration.make({
				codec: ConfigCodec.json,
				migrations: [
					{
						version: 2,
						name: "throws-inside",
						up: () =>
							Effect.sync(() => {
								throw new Error("bug");
							}),
					},
				],
			});
			const exit = yield* Effect.exit(codec.parse(`{"version":1}`));
			assert.isTrue(Exit.isFailure(exit));
			const cause = Exit.getCause(exit);
			assert.isTrue(Option.isSome(cause));
			if (Option.isSome(cause)) assert.isTrue(Cause.hasDies(cause.value));
		}),
	);
});
