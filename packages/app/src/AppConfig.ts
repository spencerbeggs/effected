import type {
	ConfigCodec,
	ConfigEvents,
	ConfigEventsShape,
	ConfigFileShape,
	ConfigResolver,
	ConfigValidationError,
	MergeStrategy as MergeStrategyShape,
} from "@effected/config-file";
import { ConfigFile, MergeStrategy } from "@effected/config-file";
import type { Xdg } from "@effected/xdg";
import { AppDirs, XdgConfig } from "@effected/xdg";
import type { Context, FileSystem, Path, Schema } from "effect";
import { Effect, Layer } from "effect";

/**
 * Options for {@link (AppConfig:variable).layer}.
 *
 * @public
 */
export interface AppConfigOptions<A, I> {
	/**
	 * The config file's name within the app's config directory.
	 *
	 * @remarks
	 * No default — a config filename is the consumer's decision. A single path
	 * component: an empty name, or one containing a separator, **dies** at
	 * layer construction.
	 */
	readonly filename: string;
	/** The schema every discovered document is decoded through. */
	readonly schema: Schema.Codec<A, I>;
	/**
	 * How file content becomes an unknown document, and back.
	 *
	 * @remarks
	 * Required — never inferred, never defaulted. Defaulting it, or inferring
	 * one from `filename`'s extension, would hard-code a *format* choice into a
	 * composition layer, which is not this package's decision to make. The
	 * named import (`JsonCodec`, `TomlCodec`, …) is also what keeps the other
	 * engines out of the consumer's bundle.
	 */
	readonly codec: ConfigCodec;
	/** How several discovered sources become one value. Default `MergeStrategy.firstMatch`. */
	readonly strategy?: MergeStrategyShape<A>;
	/** An optional caller-supplied check run after schema decoding. */
	readonly validate?: (value: A) => Effect.Effect<A, ConfigValidationError>;
	/** The opt-in event hook. Pass the `ConfigEvents` class itself. */
	readonly events?: Context.Key<ConfigEvents, ConfigEventsShape>;
	/**
	 * Probe the OS-native config directory as a fallback. Defaults to `true`.
	 *
	 * @remarks
	 * The native probe sits **after** the XDG resolver, so an existing
	 * `~/.config/<app>` still beats the native directory; on Linux it resolves
	 * to nothing and never touches the filesystem. Pass `false` to drop it.
	 */
	readonly native?: boolean;
}

/**
 * A filename is one path component. Anything else escapes the app's own
 * directory, so it dies rather than resolving somewhere surprising — the same
 * wiring-defect rule xdg applies to `namespace`.
 */
const badFilename = (context: string, filename: string): Error | undefined => {
	if (filename.length === 0) {
		return new Error(`${context}: \`filename\` must not be empty`);
	}
	if (/[/\\]/.test(filename) || filename === "." || filename === "..") {
		return new Error(`${context}: \`filename\` must be a single path component, received ${JSON.stringify(filename)}`);
	}
	return undefined;
};

/**
 * Build the xdg-flavored config layer for a `ConfigFile.Service` class.
 *
 * @remarks
 * Wraps `ConfigFile.layer(tag, …)` with the resolver chain xdg documents, in
 * xdg's documented order — `XdgConfig.resolver`, then
 * `XdgConfig.nativeResolver` — and with `defaultPath:
 * XdgConfig.savePath(filename)`, which fits config-file's infallible
 * `defaultPath` slot without an `orDie` because xdg resolves at
 * layer-construction time.
 *
 * **The namespace is never a parameter.** It is read from the ambient
 * {@link AppDirs} service at layer build time, so it is typed exactly once, in
 * `App.layer` — the two-strings drift where an app passes `"myapp"` to
 * `App.layer` and `"my-app"` to its config preset cannot happen.
 *
 * This is a layer-returning function: bind the result to a `const` and reuse
 * that binding, or two provide sites mint two independent service instances.
 */
const layer = <Self, A, I>(
	tag: Context.Key<Self, ConfigFileShape<A>>,
	options: AppConfigOptions<A, I>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const invalid = badFilename("AppConfig.layer", options.filename);
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const appDirs = yield* AppDirs;
			// TS infers the resolvers' `RR` from the FIRST array element and will
			// not union in the second, so the chain is annotated up front.
			const resolvers: ReadonlyArray<ConfigResolver<AppDirs | Xdg | FileSystem.FileSystem | Path.Path>> =
				options.native === false
					? [XdgConfig.resolver({ filename: options.filename })]
					: [
							XdgConfig.resolver({ filename: options.filename }),
							XdgConfig.nativeResolver({ namespace: appDirs.namespace, filename: options.filename }),
						];

			return ConfigFile.layer(tag, {
				schema: options.schema,
				codec: options.codec,
				strategy: options.strategy ?? MergeStrategy.firstMatch<A>(),
				resolvers,
				defaultPath: XdgConfig.savePath(options.filename),
				// Conditional spreads: a present key holding `undefined` is not an
				// absent key.
				...(options.validate !== undefined && { validate: options.validate }),
				...(options.events !== undefined && { events: options.events }),
			});
		}),
	);

/**
 * The xdg-flavored `ConfigFile` preset: discovery through the app's XDG
 * config search path, saves into the app's own config directory.
 *
 * @remarks
 * A free-standing export, deliberately separate from anything that reaches
 * the sqlite driver: `AppConfig` reaches `@effected/xdg` and
 * `@effected/config-file` only, so a consumer who wants XDG-placed config
 * files and no database imports it without pulling a SQLite driver into
 * their graph.
 *
 * @public
 */
export const AppConfig = { layer } as const;
