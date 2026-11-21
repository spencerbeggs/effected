import type { FileSystem, Option } from "effect";
import { Effect, Schema } from "effect";
import type { ActionStateShape } from "../../../../src/ActionState.js";
import { ActionStateError } from "../../../../src/ActionState.js";

/**
 * The file under `RUNNER_TEMP` that the harness checkout step writes its saved state to, and the cleanup step reads
 * back. The runner hands a step's saved state only to that step's own post entry, so a later step of the same job sees
 * it only through a file.
 */
export const RECORD_FILE = "effected-parity-state.json";

const Saved = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));

const readSaved = (fs: FileSystem.FileSystem, file: string, key: string) =>
	Effect.gen(function* () {
		if (!(yield* fs.exists(file))) return {};
		return yield* Schema.decodeUnknownEffect(Saved)(yield* fs.readFileString(file));
	}).pipe(Effect.mapError((cause) => new ActionStateError({ reason: "malformed", key, cause })));

/**
 * `real`, except that every value it saves is also written, in its encoded form, to `file`: the same form `real`
 * hands the runner.
 */
export const teeing = (real: ActionStateShape, fs: FileSystem.FileSystem, file: string): ActionStateShape => ({
	...real,
	save: (key, value, schema) =>
		Effect.gen(function* () {
			yield* real.save(key, value, schema);
			const encoded = yield* Schema.encodeUnknownEffect(schema)(value).pipe(
				Effect.mapError((cause) => new ActionStateError({ reason: "notPlainJson", key, cause })),
			);
			const saved = yield* readSaved(fs, file, key);
			yield* fs
				.writeFileString(file, JSON.stringify({ ...saved, [key]: encoded }))
				.pipe(Effect.mapError((cause) => new ActionStateError({ reason: "writeFailed", key, cause })));
		}),
});

/**
 * An `ActionState` that reads what {@link teeing} wrote to `file`, decoding each value with the schema it is read
 * with, as the live service decodes `STATE_<key>`. Saving is not supported: the cleanup step only reads.
 */
export const fromFile = (fs: FileSystem.FileSystem, file: string): ActionStateShape => {
	const getOptional = <A, I>(
		key: string,
		schema: Schema.Codec<A, I>,
	): Effect.Effect<Option.Option<A>, ActionStateError> =>
		Effect.gen(function* () {
			const saved = yield* readSaved(fs, file, key);
			if (!Object.hasOwn(saved, key)) return yield* Effect.succeedNone;
			return yield* Schema.decodeUnknownEffect(schema)(saved[key]).pipe(
				Effect.mapError((cause) => new ActionStateError({ reason: "malformed", key, cause })),
				Effect.asSome,
			);
		});
	const refuse = (key: string) => Effect.fail(new ActionStateError({ reason: "writeFailed", key }));
	return {
		save: (key) => refuse(key),
		saveSecret: (key) => refuse(key),
		getOptional,
		get: (key, schema) =>
			Effect.flatMap(getOptional(key, schema), (value) =>
				value._tag === "Some"
					? Effect.succeed(value.value)
					: Effect.fail(new ActionStateError({ reason: "missing", key })),
			),
	};
};
