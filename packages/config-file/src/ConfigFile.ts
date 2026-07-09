import type { Path } from "effect";
import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";
import type { ConfigCodec, ConfigCodecError } from "./ConfigCodec.js";
import type { ConfigResolver } from "./ConfigResolver.js";
import type { ConfigSource, MergeStrategy, NonEmptySources } from "./MergeStrategy.js";

/**
 * Indicates that the resolver chain produced no configuration source.
 *
 * @remarks
 * Its own tag, so "no config anywhere" is routable with `Effect.catchTag`
 * separately from "the config I found is broken" — the single most important
 * distinction the v3 mega-error could not express.
 *
 * @public
 */
export class ConfigFileNotFoundError extends Schema.TaggedErrorClass<ConfigFileNotFoundError>()(
	"ConfigFileNotFoundError",
	{
		/** The names of the resolvers that were probed, in order. */
		searched: Schema.Array(Schema.String),
	},
) {
	override get message(): string {
		return `No config file found (searched: ${this.searched.join(", ")})`;
	}
}

/**
 * Indicates that a config file could not be read from the filesystem.
 *
 * @remarks
 * `cause` preserves the underlying filesystem failure structurally. v3 flattened
 * it to `reason: String(e)`.
 *
 * @public
 */
export class ConfigFileReadError extends Schema.TaggedErrorClass<ConfigFileReadError>()("ConfigFileReadError", {
	/** The path that could not be read. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to read config file at "${this.path}"`;
	}
}

/**
 * Indicates that a config file could not be written to the filesystem.
 *
 * @public
 */
export class ConfigFileWriteError extends Schema.TaggedErrorClass<ConfigFileWriteError>()("ConfigFileWriteError", {
	/** The path that could not be written. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to write config file at "${this.path}"`;
	}
}

/**
 * Indicates that parsed config content did not satisfy the schema, or that a
 * caller-supplied `validate` rejected it.
 *
 * @remarks
 * `issue` carries the **structured** schema failure — at runtime a
 * `SchemaIssue.Issue` tree, reachable through `_tag` and nested `issues`. v3
 * flattened this to `String(ParseError)`, destroying every field a caller might
 * branch on. It is typed `unknown` because v4 exposes no `Schema` for `Issue`;
 * narrow it with the `SchemaIssue` module.
 *
 * @public
 */
export class ConfigValidationError extends Schema.TaggedErrorClass<ConfigValidationError>()("ConfigValidationError", {
	/** The offending file, absent when `validate` was called on an in-memory value. */
	path: Schema.Option(Schema.String),
	/** The structured schema issue. Never a string. */
	issue: Schema.Defect(),
}) {
	override get message(): string {
		const at = Option.match(this.path, { onNone: () => "", onSome: (p) => ` at "${p}"` });
		return `Config validation failed${at}`;
	}
}

/**
 * The failure modes of the full discovery-and-load path.
 *
 * @public
 */
export type ConfigLoadError = ConfigFileNotFoundError | ConfigFileReadError | ConfigCodecError | ConfigValidationError;

/**
 * The failure modes of reading one known path.
 *
 * @remarks
 * Deliberately excludes {@link ConfigFileNotFoundError}: every method typed with
 * this union either takes an explicit path or treats "nothing found" as success.
 *
 * @public
 */
export type ConfigReadError = ConfigFileReadError | ConfigCodecError | ConfigValidationError;

/**
 * The config file service, generic over the decoded config type `A`.
 *
 * @remarks
 * Error unions are narrowed per method: `loadOrDefault` cannot fail with
 * {@link ConfigFileNotFoundError} because that is the branch it handles, and
 * `discover` treats an empty result as success.
 *
 * @public
 */
export interface ConfigFileShape<A> {
	/** Discover, decode and merge the highest-priority config source. */
	readonly load: Effect.Effect<A, ConfigLoadError>;
	/** Read, decode and validate one explicit path. */
	readonly loadFrom: (path: string) => Effect.Effect<A, ConfigReadError>;
	/** Every source the resolver chain found, in priority order. Empty is success. */
	readonly discover: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigReadError>;
	/** Like {@link ConfigFileShape.load}, but yields `defaultValue` when nothing is found. */
	readonly loadOrDefault: (defaultValue: A) => Effect.Effect<A, ConfigReadError>;
	/** Decode and validate an in-memory value. */
	readonly validate: (value: unknown) => Effect.Effect<A, ConfigValidationError>;
}

/**
 * Options for {@link ConfigFile.layer}.
 *
 * @remarks
 * `RR` is the union of the resolvers' requirements. It flows into the layer's
 * `R` rather than being cast away.
 *
 * @public
 */
export interface ConfigFileOptions<A, I, RR> {
	/**
	 * The schema every discovered document is decoded through.
	 *
	 * @remarks
	 * `Schema.Codec<A, I>` rather than v4's one-parameter `Schema.Schema<A>`,
	 * because the encoded form `I` matters on the write path. Its decoding and
	 * encoding service channels default to `never`, keeping `decode` free of
	 * requirements.
	 */
	readonly schema: Schema.Codec<A, I>;
	/** How file content becomes an unknown document, and back. */
	readonly codec: ConfigCodec;
	/** The resolver chain, in priority order. */
	readonly resolvers: ReadonlyArray<ConfigResolver<RR>>;
	/** How several discovered sources become one value. */
	readonly strategy: MergeStrategy<A>;
	/** An optional caller-supplied check run after schema decoding. */
	readonly validate?: (value: A) => Effect.Effect<A, ConfigValidationError>;
}

/**
 * Create a uniquely-keyed service class for one config schema.
 *
 * @example
 * ```ts
 * class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}
 * ```
 *
 * @public
 */
const Service =
	<Self, A>() =>
	<const Id extends string>(id: Id) =>
		Context.Service<Self, ConfigFileShape<A>>()(id);

const makeImpl = <A, I, RR>(
	options: ConfigFileOptions<A, I, RR>,
	fs: FileSystem.FileSystem,
	resolverEnv: Context.Context<RR>,
): ConfigFileShape<A> => {
	const decode = (parsed: unknown, at: Option.Option<string>): Effect.Effect<A, ConfigValidationError> =>
		Schema.decodeUnknownEffect(options.schema)(parsed).pipe(
			// Normalize the schema failure at the boundary. Never leak SchemaError
			// deeper, never stringify it — carry its structured issue tree instead.
			Effect.catchTag("SchemaError", (error) =>
				Effect.fail(new ConfigValidationError({ path: at, issue: error.issue })),
			),
		);

	const runValidate = (value: A): Effect.Effect<A, ConfigValidationError> =>
		options.validate ? options.validate(value) : Effect.succeed(value);

	const loadFrom = Effect.fn("ConfigFile.loadFrom")(function* (target: string) {
		const raw = yield* fs
			.readFileString(target)
			.pipe(Effect.mapError((cause) => new ConfigFileReadError({ path: target, cause })));
		const parsed = yield* options.codec.parse(raw);
		const decoded = yield* decode(parsed, Option.some(target));
		return yield* runValidate(decoded);
	});

	const discover = Effect.fn("ConfigFile.discover")(function* () {
		const sources: Array<ConfigSource<A>> = [];
		for (const resolver of options.resolvers) {
			// `resolve` cannot fail — the absorption contract — so no error handling here.
			const found = yield* Effect.provide(resolver.resolve, resolverEnv);
			if (Option.isSome(found)) {
				const target = found.value;
				sources.push({ path: target, resolver: resolver.name, value: yield* loadFrom(target) });
			}
		}
		return sources;
	});

	const searched = options.resolvers.map((r) => r.name);

	const load = Effect.fn("ConfigFile.load")(function* () {
		const sources = yield* discover();
		if (sources.length === 0) return yield* Effect.fail(new ConfigFileNotFoundError({ searched }));
		// Guarded by the check above; TypeScript cannot narrow Array<T> to [T, ...T[]].
		return yield* options.strategy.resolve(sources as unknown as NonEmptySources<A>);
	});

	const loadOrDefault = Effect.fn("ConfigFile.loadOrDefault")(function* (defaultValue: A) {
		const sources = yield* discover();
		if (sources.length === 0) return defaultValue;
		// Guarded by the check above; TypeScript cannot narrow Array<T> to [T, ...T[]].
		return yield* options.strategy.resolve(sources as unknown as NonEmptySources<A>);
	});

	const validate = Effect.fn("ConfigFile.validate")(function* (value: unknown) {
		const decoded = yield* decode(value, Option.none());
		return yield* runValidate(decoded);
	});

	return {
		load: load(),
		loadFrom,
		discover: discover(),
		loadOrDefault,
		validate,
	};
};

/**
 * Build the live layer for a config service class.
 *
 * @remarks
 * Resolver requirements flow into the layer's `R` type. v3 cast them away with
 * `as Effect.Effect<Option<string>>`, making `Layer<Service, never, FileSystem>`
 * a claim rather than a proof.
 *
 * @public
 */
const layer = <Self, A, I, RR>(
	tag: Context.Key<Self, ConfigFileShape<A>>,
	options: ConfigFileOptions<A, I, RR>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path | RR> =>
	Layer.effect(
		tag,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const resolverEnv = yield* Effect.context<RR>();
			return makeImpl(options, fs, resolverEnv);
		}),
	);

/**
 * The config file service: a per-schema service factory and its layers.
 *
 * @public
 */
export const ConfigFile = { Service, layer } as const;
