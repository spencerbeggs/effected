import { Effect, Schema } from "effect";
import type { ConfigCodec, ConfigCodecError } from "./ConfigCodec.js";

/**
 * Indicates that a versioned config migration failed.
 *
 * @remarks
 * `phase` says where: reading the current version, applying a step, or writing
 * the new version back. `cause` preserves the underlying failure by identity —
 * even when the failing step threw synchronously instead of failing an Effect.
 * v3 assembled all three into a prose `reason` string.
 *
 * @public
 */
export class ConfigMigrationError extends Schema.TaggedErrorClass<ConfigMigrationError>()("ConfigMigrationError", {
	/** The target version of the step that failed. `0` when reading the version failed. */
	version: Schema.Number,
	/** The name of the step that failed; empty when reading the version failed. */
	name: Schema.String,
	/** Which stage of a migration step failed. */
	phase: Schema.Literals(["read-version", "apply", "write-version"]),
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return this.phase === "read-version"
			? "Failed to read the config version"
			: `Migration "${this.name}" (v${this.version}) failed during ${this.phase}`;
	}
}

/**
 * A single versioned migration step.
 *
 * @remarks
 * v3 also declared a `down` reverse migration. It was never invoked anywhere in
 * the codebase, so it is not ported.
 *
 * @public
 */
export interface ConfigFileMigration {
	readonly version: number;
	readonly name: string;
	readonly up: (raw: unknown) => Effect.Effect<unknown, unknown>;
}

/** How the version number is read from and written to the parsed config. @public */
export interface VersionAccess {
	readonly get: (raw: unknown) => Effect.Effect<number, unknown>;
	readonly set: (raw: unknown, version: number) => Effect.Effect<unknown, unknown>;
}

const defaultVersionAccess: VersionAccess = {
	get: (raw) => {
		if (typeof raw !== "object" || raw === null) return Effect.fail(new Error("config is not an object"));
		const version = (raw as Record<string, unknown>).version;
		return typeof version === "number"
			? Effect.succeed(version)
			: Effect.fail(new Error("version field is missing or not a number"));
	},
	set: (raw, version) => Effect.succeed({ ...(raw as Record<string, unknown>), version }),
};

/** Reads and writes a top-level `version` field. @public */
export const VersionAccess = { default: defaultVersionAccess } as const;

/** Options for {@link ConfigMigration.make}. @public */
export interface ConfigMigrationOptions {
	readonly codec: ConfigCodec;
	readonly migrations: ReadonlyArray<ConfigFileMigration>;
	readonly versionAccess?: VersionAccess;
}

/**
 * Runs one migration phase, normalizing both an Effect failure and a
 * synchronous throw into a {@link ConfigMigrationError}.
 *
 * @remarks
 * `up` and a caller-supplied {@link VersionAccess} are plugin code: nothing
 * stops an implementation from throwing instead of failing an Effect. Malformed
 * plugin behavior gets the same treatment this port gives malformed input
 * everywhere else — a typed failure, never a bare defect — so `cause` still
 * survives by identity instead of dying the fiber.
 */
const runPhase = <A>(
	phase: "read-version" | "apply" | "write-version",
	version: number,
	name: string,
	run: () => Effect.Effect<A, unknown>,
): Effect.Effect<A, ConfigMigrationError> => {
	let effect: Effect.Effect<A, unknown>;
	try {
		effect = run();
	} catch (cause) {
		return Effect.fail(new ConfigMigrationError({ version, name, phase, cause }));
	}
	return effect.pipe(Effect.mapError((cause) => new ConfigMigrationError({ version, name, phase, cause })));
};

/**
 * Wrap a codec so that parsed content is brought up to the latest version.
 *
 * @remarks
 * The returned codec's error channel **widens** to include
 * {@link ConfigMigrationError} rather than flattening migration failures into
 * the inner codec's error — the reason the {@link ConfigCodec} seam is generic
 * in its error type.
 *
 * @public
 */
const make = (options: ConfigMigrationOptions): ConfigCodec<ConfigCodecError | ConfigMigrationError> => {
	const access = options.versionAccess ?? VersionAccess.default;
	const sorted = [...options.migrations].sort((a, b) => a.version - b.version);

	return {
		name: options.codec.name,
		stringify: options.codec.stringify,
		parse: (raw) =>
			Effect.gen(function* () {
				let parsed = yield* options.codec.parse(raw);
				if (sorted.length === 0) return parsed;

				const current = yield* runPhase("read-version", 0, "", () => access.get(parsed));

				for (const migration of sorted.filter((m) => m.version > current)) {
					parsed = yield* runPhase("apply", migration.version, migration.name, () => migration.up(parsed));
					parsed = yield* runPhase("write-version", migration.version, migration.name, () =>
						access.set(parsed, migration.version),
					);
				}
				return parsed;
			}),
	};
};

/** Versioned migration support for config codecs. @public */
export const ConfigMigration = { make } as const;
