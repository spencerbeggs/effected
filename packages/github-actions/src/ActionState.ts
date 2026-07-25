import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import { ActionEnvironment } from "./ActionEnvironment.js";
import { ActionOutputs } from "./ActionOutputs.js";

/**
 * Raised when state cannot cross the phase boundary.
 *
 * @public
 */
export class ActionStateError extends Schema.TaggedErrorClass<ActionStateError>()("ActionStateError", {
	/**
	 * `missing` — no value was saved under this key in an earlier phase.
	 * `malformed` — a value is there but is not JSON, or does not satisfy the
	 * schema it was read with. `writeFailed` — the state file could not be
	 * appended to.
	 */
	reason: Schema.Literals(["missing", "malformed", "writeFailed"]),
	key: Schema.String,
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		switch (this.reason) {
			case "missing":
				return `No action state was saved under "${this.key}"`;
			case "malformed":
				return `Action state under "${this.key}" could not be decoded`;
			default:
				return `Failed to persist action state under "${this.key}"`;
		}
	}
}

/**
 * The {@link ActionState} service shape.
 *
 * @public
 */
export interface ActionStateShape {
	/** Persist a value for a later phase. */
	readonly save: <A, I>(key: string, value: A, schema: Schema.Codec<A, I>) => Effect.Effect<void, ActionStateError>;
	/** Read a value saved by an earlier phase. */
	readonly get: <A, I>(key: string, schema: Schema.Codec<A, I>) => Effect.Effect<A, ActionStateError>;
	/** Read a value that may not have been saved. */
	readonly getOptional: <A, I>(
		key: string,
		schema: Schema.Codec<A, I>,
	) => Effect.Effect<Option.Option<A>, ActionStateError>;
	/**
	 * Persist a secret, masking it in the runner log first.
	 *
	 * @remarks
	 * `GITHUB_STATE` is plaintext by GitHub's protocol — a `Redacted` cannot
	 * survive that boundary by design — so masking is the only available
	 * defense, and coupling it to the write is what makes it unforgettable.
	 */
	readonly saveSecret: (key: string, secret: string) => Effect.Effect<void, ActionStateError>;
}

/** The runner republishes saved state as `STATE_<key>`. */
const stateVariable = (key: string): string => `STATE_${key}`;

const make = Effect.gen(function* () {
	const env = yield* ActionEnvironment;
	const fs = yield* FileSystem.FileSystem;
	const outputs = yield* ActionOutputs;

	const write = (key: string, serialized: string): Effect.Effect<void, ActionStateError> =>
		Effect.gen(function* () {
			const path = yield* env
				.get("GITHUB_STATE")
				.pipe(Effect.mapError((cause) => new ActionStateError({ reason: "writeFailed", key, cause })));
			// Same derived-delimiter discipline as ActionOutputs: a value that
			// contains the delimiter would terminate its block early.
			let delimiter = "EFFECTED_EOF";
			while (serialized.includes(delimiter)) {
				delimiter = `${delimiter}_`;
			}
			yield* fs
				.writeFileString(path, `${key}<<${delimiter}\n${serialized}\n${delimiter}\n`, { flag: "a" })
				.pipe(Effect.mapError((cause) => new ActionStateError({ reason: "writeFailed", key, cause })));
		});

	const read = <A, I>(key: string, schema: Schema.Codec<A, I>): Effect.Effect<Option.Option<A>, ActionStateError> =>
		Effect.gen(function* () {
			const raw = yield* env.getOptional(stateVariable(key));
			if (Option.isNone(raw)) {
				return Option.none<A>();
			}
			const parsed = yield* Effect.try({
				try: () => JSON.parse(raw.value) as unknown,
				catch: (cause) => new ActionStateError({ reason: "malformed", key, cause }),
			});
			const decoded = yield* Schema.decodeUnknownEffect(schema)(parsed).pipe(
				Effect.mapError((cause) => new ActionStateError({ reason: "malformed", key, cause })),
			);
			return Option.some(decoded);
		});

	const save = <A, I>(key: string, value: A, schema: Schema.Codec<A, I>) =>
		Schema.encodeUnknownEffect(schema)(value).pipe(
			Effect.mapError((cause) => new ActionStateError({ reason: "malformed", key, cause })),
			Effect.flatMap((encoded) => write(key, JSON.stringify(encoded))),
		);

	return {
		save,
		getOptional: read,
		get: <A, I>(key: string, schema: Schema.Codec<A, I>) =>
			Effect.flatMap(read(key, schema), (found) =>
				Option.isSome(found)
					? Effect.succeed(found.value)
					: Effect.fail(new ActionStateError({ reason: "missing", key })),
			),
		saveSecret: (key: string, secret: string) =>
			// Mask first, then persist. The ordering is the guarantee.
			Effect.flatMap(outputs.setSecret(secret), () => write(key, JSON.stringify(secret))),
	} satisfies ActionStateShape;
});

const unimplemented = (member: string): never => {
	throw new Error(`ActionState.makeTest: ${member}() was called but not stubbed — pass a \`${member}\` override.`);
};

/**
 * State that survives the `pre` → `main` → `post` phase boundary.
 *
 * @remarks
 * Each phase of an action is a **separate process**. GitHub's protocol is a
 * write-only file (`GITHUB_STATE`) whose entries the runner republishes to the
 * next phase as `STATE_<key>` environment variables — so saving and reading go
 * through different mechanisms, which is why this is a service rather than a
 * pair of helpers.
 *
 * @public
 */
export class ActionState extends Context.Service<ActionState, ActionStateShape>()(
	"@effected/github-actions/ActionState",
) {
	static readonly layer: Layer.Layer<ActionState, never, ActionEnvironment | FileSystem.FileSystem | ActionOutputs> =
		Layer.effect(this, make);

	/** A test double. Unstubbed members die rather than answering wrongly. */
	static readonly makeTest = (overrides: Partial<ActionStateShape> = {}): ActionStateShape => ({
		save: () => Effect.sync(() => unimplemented("save")),
		get: () => Effect.sync(() => unimplemented("get")),
		getOptional: () => Effect.sync(() => unimplemented("getOptional")),
		saveSecret: () => Effect.sync(() => unimplemented("saveSecret")),
		...overrides,
	});

	/** {@link ActionState.makeTest} behind `Layer.succeed`. */
	static readonly layerTest = (overrides: Partial<ActionStateShape> = {}): Layer.Layer<ActionState> =>
		Layer.succeed(ActionState, ActionState.makeTest(overrides));
}
