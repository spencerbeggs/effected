import type { Context, Layer } from "effect";
import { ConfigProvider, Effect } from "effect";
import type { ConfigFileShape, ConfigLoadError } from "./ConfigFile.js";

/**
 * Expose a loaded, merged, schema-validated document as a v4 `ConfigProvider`,
 * so it can be read through `Config.string("port")` and layered beneath other
 * providers.
 *
 * @remarks
 * Strictly additive, and deliberately in its own module so it never becomes a
 * required import. The schema-validated whole-document
 * {@link ConfigFileShape.load} remains the primary API: v4's `Config` has no
 * whole-document story, and this function is the bridge, not a replacement.
 *
 * Three properties, in order of how easy they are to lose:
 *
 * 1. **A missing file is a failure, not an empty provider.** The
 *    {@link ConfigFileNotFoundError} propagates. Handing back an empty provider
 *    would silently turn every subsequent `Config` read into "not found", which
 *    is the exact class of lie this port exists to undo.
 * 2. **Nested keys are structural, not dotted.** `fromUnknown` descends one path
 *    segment at a time, so `{ db: { host } }` is reached with
 *    `Config.nested(Config.string("host"), "db")` — never `Config.string("db.host")`,
 *    which is looked up as a single literal key and fails. No flattening happens
 *    here, because none is needed.
 * 3. **The decoded value is handed over as-is.** `fromUnknown` descends with
 *    `Object.hasOwn`, and a `Schema.Class` instance carries its fields as own
 *    properties, so no encoding step is required. The corollary: leaves are read
 *    in their **decoded** form. A field whose decoded type is not a JSON
 *    primitive — a `Date`, an `Option` — is not readable through a `Config`
 *    accessor, because `fromUnknown` only turns strings, numbers, booleans and
 *    bigints into values. Such a field is still reachable through `load`, which
 *    is the API that was designed to carry it.
 *
 * Descent by own property is also why a prototype getter and `__proto__` are
 * both unreachable through the returned provider.
 *
 * @example
 * ```ts
 * const fileProvider = yield* asConfigProvider(cfg);
 * const provider = ConfigProvider.orElse(ConfigProvider.fromEnv(), fileProvider);
 * ```
 *
 * @public
 */
export const asConfigProvider = <A>(
	service: ConfigFileShape<A>,
): Effect.Effect<ConfigProvider.ConfigProvider, ConfigLoadError> =>
	Effect.map(service.load, (value) => ConfigProvider.fromUnknown(value));

/**
 * Options for {@link layerConfigProvider}.
 *
 * @public
 */
export interface LayerConfigProviderOptions {
	/**
	 * Make the config file the primary source, consulted before the ambient
	 * provider rather than after it.
	 *
	 * @remarks
	 * Defaults to `false`, which is the precedence almost every application
	 * wants: an environment variable overrides the file it was deployed with.
	 */
	readonly asPrimary?: boolean;
}

/**
 * Install a loaded config document as a fallback beneath the **ambient**
 * `ConfigProvider`, so `Config` accessors read env first and the file second.
 *
 * @remarks
 * This is the composition the v3 library could not express. v4's ambient
 * `ConfigProvider` is a `Context.Reference` whose default value is
 * `ConfigProvider.fromEnv()`, so with no further wiring this layer already
 * yields the intended precedence: environment variable wins, config file
 * supplies whatever the environment lacks. Provide a different
 * `ConfigProvider.layer(...)` beneath it to change what "ambient" means.
 *
 * The load happens when the layer is built, and a {@link ConfigFileNotFoundError}
 * surfaces in the layer's error channel rather than degrading to an empty
 * provider — the same honesty {@link asConfigProvider} keeps.
 *
 * @example
 * ```ts
 * const stack = layerConfigProvider(AppConfig).pipe(Layer.provide(AppConfigLive));
 * ```
 *
 * @public
 */
export const layerConfigProvider = <Self, A>(
	tag: Context.Key<Self, ConfigFileShape<A>>,
	options?: LayerConfigProviderOptions,
): Layer.Layer<never, ConfigLoadError, Self> => {
	// A `Context.Key` *is* an `Effect<Shape, never, Identifier>`, so the service
	// lookup needs no `asEffect`, and `Self` flows straight into the layer's `R`.
	const provider = Effect.flatMap(tag, asConfigProvider);
	// Two call sites rather than `{ asPrimary: options?.asPrimary }`: passing the
	// key explicitly as `undefined` is not the same as omitting it.
	return options?.asPrimary !== undefined
		? ConfigProvider.layerAdd(provider, { asPrimary: options.asPrimary })
		: ConfigProvider.layerAdd(provider);
};
