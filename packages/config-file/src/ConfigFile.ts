import { Context, DateTime, Effect, FileSystem, Layer, Option, Path, PubSub, Schema, Semaphore } from "effect";
import type { ConfigCodec, ConfigCodecError } from "./ConfigCodec.js";
import type { ConfigEventPayload, ConfigEvents, ConfigEventsShape } from "./ConfigEvent.js";
import { ConfigEvent } from "./ConfigEvent.js";
import { ConfigResolver } from "./ConfigResolver.js";
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
 * Indicates that {@link ConfigFileShape.save} or {@link ConfigFileShape.update}
 * was called on a service configured without a `defaultPath`.
 *
 * @remarks
 * v3 reported this as a generic `ConfigError` carrying `operation: "save"` and
 * `reason: "no default path configured"` — indistinguishable by tag from a real
 * write failure.
 *
 * It carries no `path` field on purpose. The whole point of this failure is
 * that there is no path; a {@link ConfigFileWriteError} with a fabricated path
 * would be a lie, and lying error payloads are what this port exists to undo.
 *
 * @public
 */
export class ConfigDefaultPathMissingError extends Schema.TaggedErrorClass<ConfigDefaultPathMissingError>()(
	"ConfigDefaultPathMissingError",
	{},
) {
	override get message(): string {
		return "No `defaultPath` configured: `save` and `update` require ConfigFileOptions.defaultPath";
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
 * The failure modes of encoding and writing one known path.
 *
 * @remarks
 * Deliberately excludes {@link ConfigFileNotFoundError} — the path is explicit,
 * so there is nothing to discover — and {@link ConfigDefaultPathMissingError},
 * because no default path is consulted.
 *
 * @public
 */
export type ConfigWriteError = ConfigFileWriteError | ConfigCodecError | ConfigValidationError;

/**
 * The failure modes of {@link ConfigFileShape.save}.
 *
 * @public
 */
export type ConfigSaveError = ConfigWriteError | ConfigDefaultPathMissingError;

/**
 * The failure modes of {@link ConfigFileShape.update}, which loads and then saves.
 *
 * @public
 */
export type ConfigUpdateError = ConfigLoadError | ConfigFileWriteError | ConfigDefaultPathMissingError;

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
	/**
	 * Every source the resolver chain found, in priority order. Empty is success.
	 *
	 * @remarks
	 * A found-but-corrupt source ABORTS discovery with a typed error rather than
	 * being silently skipped: silently skipping a corrupt file would mean running
	 * on the wrong config. This is deliberate, and is parity with v3.
	 */
	readonly discover: Effect.Effect<ReadonlyArray<ConfigSource<A>>, ConfigReadError>;
	/**
	 * Like {@link ConfigFileShape.load}, but yields `defaultValue` when nothing is found.
	 *
	 * @remarks
	 * `defaultValue` is returned as-is: neither the schema nor `options.validate`
	 * is applied to it. It is trusted caller input, not a discovered document.
	 */
	readonly loadOrDefault: (defaultValue: A) => Effect.Effect<A, ConfigReadError>;
	/** Decode and validate an in-memory value. */
	readonly validate: (value: unknown) => Effect.Effect<A, ConfigValidationError>;
	/**
	 * Encode `value` and write it to an explicit `path`.
	 *
	 * @remarks
	 * Does **not** create the parent directory — that is
	 * {@link ConfigFileShape.save}'s job, and the distinction is load-bearing:
	 * `write` targets a path the caller already vouched for.
	 */
	readonly write: (value: A, path: string) => Effect.Effect<void, ConfigWriteError>;
	/**
	 * Resolve `defaultPath`, `mkdir -p` its parent, encode `value` into it, and
	 * return the path written.
	 */
	readonly save: (value: A) => Effect.Effect<string, ConfigSaveError>;
	/**
	 * Load the current value, apply `fn`, {@link ConfigFileShape.save} the result
	 * and return it.
	 *
	 * @remarks
	 * With `defaultValue` the load cannot fail with
	 * {@link ConfigFileNotFoundError}; without it, it can.
	 */
	readonly update: (fn: (current: A) => A, defaultValue?: A) => Effect.Effect<A, ConfigUpdateError>;
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
	/**
	 * Where {@link ConfigFileShape.save} writes when given no explicit path.
	 *
	 * @remarks
	 * Its requirements join the resolvers' in `RR` and flow into the layer's `R`.
	 * v3 typed this `Effect<string, ConfigError, any>` and cast the requirements
	 * away at the call site.
	 *
	 * When absent, `save` and `update` fail with
	 * {@link ConfigDefaultPathMissingError}.
	 */
	readonly defaultPath?: Effect.Effect<string, never, RR>;
	/**
	 * The opt-in event hook. Pass the `ConfigEvents` class itself.
	 *
	 * @remarks
	 * A **key**, not an instance: the service is looked up in the ambient context
	 * at call time with `Effect.serviceOption`, so it never enters the layer's
	 * `R`. When this is omitted, `emit` is `Effect.void` — it does not even
	 * perform the lookup. That is what "zero-cost when absent" means here.
	 */
	readonly events?: Context.Key<ConfigEvents, ConfigEventsShape>;
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
	path: Path.Path,
	resolverEnv: Context.Context<RR>,
): ConfigFileShape<A> => {
	/**
	 * Publish one event, or nothing at all.
	 *
	 * @remarks
	 * Three properties hold, in order of how easy they are to lose:
	 *
	 * 1. **Zero-cost when absent.** No `events` option means `Effect.void` — no
	 *    context lookup, no `DateTime.now`.
	 * 2. **Never a requirement.** `Effect.serviceOption` reads the ambient context
	 *    without adding to `R`, so wiring events cannot change a layer's type.
	 * 3. **Never fatal.** A subscriber's hub is consumer-supplied code. It cannot
	 *    FAIL — `PubSub.publish` has no error channel — but it CAN throw, and
	 *    `catchDefect` absorbs that; interruption is deliberately left to
	 *    propagate, because a config load that is being interrupted must stay
	 *    interrupted.
	 */
	const emit = (payload: ConfigEventPayload): Effect.Effect<void> =>
		options.events === undefined
			? Effect.void
			: Effect.serviceOption(options.events).pipe(
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.void,
							onSome: (svc) =>
								Effect.gen(function* () {
									const timestamp = yield* DateTime.now;
									yield* PubSub.publish(svc.events, new ConfigEvent({ timestamp, event: payload }));
								}),
						}),
					),
					Effect.catchDefect((defect) => Effect.logDebug("ConfigEvents.emit: consumer hub raised a defect", defect)),
				);

	/** The public, path-and-resolver view of the sources that fed a load. */
	const sourceRefs = (
		sources: ReadonlyArray<ConfigSource<A>>,
	): ReadonlyArray<{ readonly path: string; readonly resolver: string }> =>
		sources.map((s) => ({ path: s.path, resolver: s.resolver }));

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

		const parsed = yield* options.codec
			.parse(raw)
			.pipe(Effect.tapError((error) => emit({ _tag: "ParseFailed", path: target, codec: options.codec.name, error })));
		yield* emit({ _tag: "Parsed", path: target, codec: options.codec.name });

		// Schema decoding and the caller's `validate` are one validation step from a
		// subscriber's point of view: both answer "is this document acceptable?".
		const validated = yield* Effect.gen(function* () {
			const decoded = yield* decode(parsed, Option.some(target));
			return yield* runValidate(decoded);
		}).pipe(Effect.tapError((error) => emit({ _tag: "ValidationFailed", path: target, error })));
		yield* emit({ _tag: "Validated", path: target });

		return validated;
	});

	const discover = Effect.fn("ConfigFile.discover")(function* () {
		const sources: Array<ConfigSource<A>> = [];
		for (const resolver of options.resolvers) {
			// `resolve` cannot fail — the absorption contract — so no error handling here.
			const found = yield* Effect.provide(resolver.resolve, resolverEnv);
			if (Option.isSome(found)) {
				const target = found.value;
				// Emitted before the read, so a corrupt file is still reported as found.
				yield* emit({ _tag: "Discovered", path: target, resolver: resolver.name });
				sources.push({ path: target, resolver: resolver.name, value: yield* loadFrom(target) });
			}
		}
		return sources;
	});

	const searched = options.resolvers.map((r) => r.name);

	/**
	 * Merge the discovered sources and announce the result. Shared by `load` and
	 * `loadOrDefault`, which in v3 each re-inlined it and drifted apart.
	 *
	 * Both events carry EVERY contributing source. v3 reported `sources[0].path`,
	 * which is wrong under `layeredMerge`, where all of them contributed.
	 */
	const mergeAndEmit = (sources: NonEmptySources<A>): Effect.Effect<A> =>
		Effect.gen(function* () {
			const value = yield* options.strategy.resolve(sources);
			const refs = sourceRefs(sources);
			yield* emit({ _tag: "Resolved", sources: refs, strategy: options.strategy.name });
			yield* emit({ _tag: "Loaded", sources: refs });
			return value;
		});

	const load = Effect.fn("ConfigFile.load")(function* () {
		const sources = yield* discover();
		if (sources.length === 0) {
			yield* emit({ _tag: "NotFound" });
			return yield* Effect.fail(new ConfigFileNotFoundError({ searched }));
		}
		// Guarded by the check above; TypeScript cannot narrow Array<T> to [T, ...T[]].
		return yield* mergeAndEmit(sources as unknown as NonEmptySources<A>);
	});

	const loadOrDefault = Effect.fn("ConfigFile.loadOrDefault")(function* (defaultValue: A) {
		const sources = yield* discover();
		if (sources.length === 0) {
			yield* emit({ _tag: "NotFound" });
			return defaultValue;
		}
		// Guarded by the check above; TypeScript cannot narrow Array<T> to [T, ...T[]].
		return yield* mergeAndEmit(sources as unknown as NonEmptySources<A>);
	});

	const validate = Effect.fn("ConfigFile.validate")(function* (value: unknown) {
		const decoded = yield* decode(value, Option.none());
		return yield* runValidate(decoded);
	});

	/**
	 * Shared by `write` and `save`. Not an `Effect.fn`: it is internal, and the
	 * public boundaries that call it already open a span.
	 */
	const encodeAndWrite = (value: A, target: string): Effect.Effect<void, ConfigWriteError> =>
		Effect.gen(function* () {
			const encoded = yield* Schema.encodeEffect(options.schema)(value).pipe(
				// Same normalization as `decode`: carry the structured issue, never stringify.
				Effect.catchTag("SchemaError", (error) =>
					Effect.fail(new ConfigValidationError({ path: Option.some(target), issue: error.issue })),
				),
			);
			const serialized = yield* options.codec
				.stringify(encoded)
				.pipe(Effect.tapError((error) => emit({ _tag: "StringifyFailed", codec: options.codec.name, error })));
			yield* fs
				.writeFileString(target, serialized)
				.pipe(Effect.mapError((cause) => new ConfigFileWriteError({ path: target, cause })));
		});

	/**
	 * Resolve `defaultPath`, `mkdir -p` its parent and write. Shared by `save`
	 * and `update`, and — crucially — emits nothing.
	 *
	 * v3's `update` called the public `save`, so a single `update` published
	 * `Written` + `Saved` + `Updated`; v3 documented this as a known smell. Event
	 * granularity is per-operation, so the emitting boundary must sit in the
	 * public method, never in the shared internals it delegates to.
	 */
	const saveTo = (value: A): Effect.Effect<string, ConfigSaveError> =>
		Effect.gen(function* () {
			const configured = options.defaultPath;
			if (configured === undefined) return yield* Effect.fail(new ConfigDefaultPathMissingError({}));
			// `defaultPath`'s requirements are `RR`, satisfied by the same context the
			// resolvers use. No cast — v3 wrote `as Effect.Effect<string, ConfigError>`.
			const target = yield* Effect.provide(configured, resolverEnv);
			yield* fs
				.makeDirectory(path.dirname(target), { recursive: true })
				.pipe(Effect.mapError((cause) => new ConfigFileWriteError({ path: target, cause })));
			yield* encodeAndWrite(value, target);
			return target;
		});

	const write = Effect.fn("ConfigFile.write")(function* (value: A, target: string) {
		// No `makeDirectory` here, deliberately: `write` trusts the caller's path.
		yield* encodeAndWrite(value, target);
		yield* emit({ _tag: "Written", path: target });
	});

	const save = Effect.fn("ConfigFile.save")(function* (value: A) {
		const target = yield* saveTo(value);
		yield* emit({ _tag: "Saved", path: target });
		return target;
	});

	/**
	 * Serializes `update`'s read-modify-write. One permit, one service instance.
	 *
	 * @remarks
	 * `update` is load → transform → save. Without a lock, two concurrent calls
	 * both read the old document across the read's async boundary and both write
	 * their own transform of it, so one caller's change is silently lost. The
	 * lock covers the whole critical section, not just the write.
	 *
	 * This guards a single service instance in a single process. It is not a file
	 * lock: another process writing the same path concurrently can still clobber.
	 */
	const updateLock = Semaphore.makeUnsafe(1);

	const update = Effect.fn("ConfigFile.update")(function* (fn: (current: A) => A, defaultValue?: A) {
		return yield* updateLock.withPermits(1)(
			Effect.gen(function* () {
				const current = defaultValue !== undefined ? yield* loadOrDefault(defaultValue) : yield* load();
				const updated = fn(current);
				// `saveTo`, not `save`: calling the public method would leak its `Saved`.
				const target = yield* saveTo(updated);
				yield* emit({ _tag: "Updated", path: target });
				return updated;
			}),
		);
	});

	return {
		load: load(),
		loadFrom,
		discover: discover(),
		loadOrDefault,
		validate,
		write,
		save,
		update,
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
 * `ConfigFile.layer` is a layer-RETURNING function, not a layer: calling it
 * twice builds two independent service instances. Bind its result to a const
 * and provide that const, per the memoization discipline — do not call
 * `ConfigFile.layer(...)` inline at each provide site.
 *
 * @public
 */
const layer = <Self, A, I, RR = never>(
	tag: Context.Key<Self, ConfigFileShape<A>>,
	options: ConfigFileOptions<A, I, RR>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path | RR> =>
	Layer.effect(
		tag,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			// `save` needs `dirname`. Task 5 declared Path in `R` without yielding it.
			const path = yield* Path.Path;
			const resolverEnv = yield* Effect.context<RR>();
			return makeImpl(options, fs, path, resolverEnv);
		}),
	);

/**
 * Options for {@link ConfigFile.testLayer}.
 *
 * @remarks
 * Deliberately has no `resolvers`: `testLayer` synthesizes one
 * {@link (ConfigResolver:variable).staticDir} per seeded file, in `files`
 * insertion order, so the first key wins under
 * {@link (MergeStrategy:variable).firstMatch}.
 *
 * It also has no `defaultPath`. Nothing in the temp directory is a defensible
 * default write target, so `save` and `update` fail with
 * {@link ConfigDefaultPathMissingError} under this layer — the honest answer.
 * Exercise the write path with {@link ConfigFile.layer} instead.
 *
 * @public
 */
export interface ConfigFileTestOptions<A, I> {
	/** The schema every seeded document is decoded through. */
	readonly schema: Schema.Codec<A, I>;
	/** How file content becomes an unknown document, and back. */
	readonly codec: ConfigCodec;
	/** How several discovered sources become one value. */
	readonly strategy: MergeStrategy<A>;
	/**
	 * Filenames (relative to the temp dir) mapped to their raw contents.
	 *
	 * @remarks
	 * A name may contain separators (`"nested/.apprc"`); the parent directory is
	 * created for you.
	 */
	readonly files: Record<string, string>;
	/** An optional caller-supplied check run after schema decoding. */
	readonly validate?: (value: A) => Effect.Effect<A, ConfigValidationError>;
}

/**
 * A scoped layer that seeds `files` into a temp directory, wires the **real**
 * live implementation over them, and removes the directory when the scope
 * closes.
 *
 * @remarks
 * Deliberately not a mock. It delegates to the very same `makeImpl` that
 * {@link ConfigFile.layer} uses, so tests exercise the actual codec, resolver
 * and merge pipeline rather than a parallel implementation that can drift from
 * it. A stubbed test layer would make every downstream test a claim about the
 * stub instead of about the code under test.
 *
 * Platform-agnostic: the consumer supplies the `FileSystem` layer, and the temp
 * directory is created through `FileSystem.makeTempDirectory` rather than
 * `node:fs`.
 *
 * `Layer.scoped` does not exist in v4. `Layer.effect` types its layer as
 * `Layer<I, E, Exclude<R, Scope>>`, so an `Effect.addFinalizer` inside it binds
 * to the layer's own scope and runs on release without surfacing `Scope` in the
 * layer's requirements.
 *
 * @example
 * ```ts
 * const TestConfig = ConfigFile.testLayer(AppConfig, {
 * 	schema: AppShape,
 * 	codec: ConfigCodec.json,
 * 	strategy: MergeStrategy.firstMatch<AppShape>(),
 * 	files: { ".apprc": `{"port":4242}` },
 * }).pipe(Layer.provide(NodeServices.layer));
 * ```
 *
 * @public
 */
const testLayer = <Self, A, I>(
	tag: Context.Key<Self, ConfigFileShape<A>>,
	options: ConfigFileTestOptions<A, I>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path> =>
	Layer.effect(
		tag,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			// The resolvers below need exactly this context. Taking it from the
			// ambient environment avoids rebuilding it — and avoids a cast.
			const resolverEnv = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

			// Failures here are test-harness defects, not config errors: die.
			const dir = yield* fs.makeTempDirectory({ prefix: "effected-config-file-" }).pipe(Effect.orDie);
			yield* Effect.addFinalizer(() => fs.remove(dir, { recursive: true }).pipe(Effect.orDie));

			for (const [name, content] of Object.entries(options.files)) {
				const target = path.join(dir, name);
				yield* fs.makeDirectory(path.dirname(target), { recursive: true }).pipe(Effect.orDie);
				yield* fs.writeFileString(target, content).pipe(Effect.orDie);
			}

			const resolvers = Object.keys(options.files).map((name) => ConfigResolver.staticDir({ dir, filename: name }));

			return makeImpl(
				{
					schema: options.schema,
					codec: options.codec,
					strategy: options.strategy,
					resolvers,
					// Conditional spread: passing `validate: undefined` explicitly is not
					// the same as omitting it.
					...(options.validate !== undefined && { validate: options.validate }),
				},
				fs,
				path,
				resolverEnv,
			);
		}),
	);

/**
 * The config file service: a per-schema service factory and its layers.
 *
 * @public
 */
export const ConfigFile = { Service, layer, testLayer } as const;
