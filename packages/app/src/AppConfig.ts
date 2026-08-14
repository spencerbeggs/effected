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
import type { Context, FileSystem, Path, Schema, SchemaAST } from "effect";
import { Effect, Layer } from "effect";
import { badFilename } from "./internal/filename.js";

/**
 * Options for {@link AppConfig.layer}.
 *
 * @remarks
 * `RR` is the requirements of any caller-supplied `resolvers`; it defaults to
 * `never`, so a chain of built-in resolvers — whose requirements are already in
 * this layer's `R` — never has to be named.
 *
 * @public
 */
export interface AppConfigOptions<A, I, RR = never> {
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
	/**
	 * Parse options threaded into every schema decode, chiefly
	 * `onExcessProperty`.
	 *
	 * @remarks
	 * Defaults to core's `"ignore"`, so a config file's unknown keys are dropped
	 * silently — which means a typo'd section cannot be reported, and a field
	 * this schema deliberately removed cannot be flagged in a user's older file.
	 * `{ onExcessProperty: "error" }` turns both into a `ConfigValidationError`
	 * naming the offending path.
	 *
	 * `validate` cannot do this: it runs on the decoded value, after the excess
	 * keys are gone. Keys covered by a `Schema.StructWithRest` rest are not
	 * excess, so a deliberate pass-through section still works under `"error"`.
	 *
	 * Pair it with `errors: "all"`. Core defaults to `"first"`, which for a
	 * *loader* means a file with three typos surfaces one per run — fix,
	 * re-run, discover the next. The extra work only happens on a document
	 * that is already failing.
	 */
	readonly parseOptions?: SchemaAST.ParseOptions;
	/** The opt-in event hook. Pass the `ConfigEvents` class itself. */
	readonly events?: Context.Key<ConfigEvents, ConfigEventsShape>;
	/**
	 * Resolvers composed **ahead** of the XDG chain, in priority order.
	 *
	 * @remarks
	 * The case this exists for is a CLI's `--config` flag: pass
	 * `ConfigResolver.explicitPath` for a file, or `ConfigResolver.staticDir` for
	 * a directory, and the flag wins — with the app's XDG search path, and the
	 * native probe, still behind it as the fallback. `ConfigResolver.upwardWalk`
	 * for a project-local file goes here too.
	 *
	 * Absent, the chain is exactly what it always was, so the default is
	 * unchanged: `XdgConfig.resolver`, then `XdgConfig.nativeResolver`.
	 *
	 * A layer is built before a CLI parses anything, so getting the parsed flag
	 * here is the one wiring question this option raises. `effect/unstable/cli`
	 * answers it twice, and neither answer needs an `Effect.provide` inside the
	 * handler: `Command.provide` accepts a **function of the parsed input**, and
	 * for several subcommands sharing one flag, `GlobalFlag.setting` makes the
	 * parsed value a `Context.Service` so the layer can take it in `R` and attach
	 * once at the root. The README shows both.
	 *
	 * Two properties to be deliberate about:
	 *
	 * - **A resolver that finds nothing falls through.** `explicitPath` resolves
	 *   `Option.none()` for a path that does not exist — every `ConfigResolver`'s
	 *   error channel is `never` by contract — so a `--config` pointing at a
	 *   missing file silently loads the XDG config instead. If the flag must be
	 *   an error when it names nothing, check the path before building the layer;
	 *   discovery cannot make that distinction for you.
	 * - **The save path is unaffected.** `save` still writes to
	 *   `XdgConfig.savePath(filename)`, not to whatever a prepended resolver
	 *   discovered. Loading from `--config` and writing back to that same file is
	 *   `write(value, path)`, which takes the path explicitly.
	 */
	readonly resolvers?: ReadonlyArray<ConfigResolver<RR>>;
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

// Implementation of AppConfig.layer; the public contract lives on the static.
const layer = <Self, A, I, RR = never>(
	tag: Context.Key<Self, ConfigFileShape<A>>,
	options: AppConfigOptions<A, I, RR>,
): Layer.Layer<Self, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg | RR> =>
	Layer.unwrap(
		Effect.gen(function* () {
			const invalid = badFilename("AppConfig.layer", options.filename);
			if (invalid !== undefined) return yield* Effect.die(invalid);

			const appDirs = yield* AppDirs;
			// TS infers the resolvers' `RR` from the FIRST array element and will
			// not union in the rest, so the chain is annotated up front.
			const resolvers: ReadonlyArray<ConfigResolver<AppDirs | Xdg | FileSystem.FileSystem | Path.Path | RR>> = [
				// Caller resolvers lead: a `--config` flag outranks the app's own
				// search path, which is the whole point of passing one.
				...(options.resolvers ?? []),
				XdgConfig.resolver({ filename: options.filename }),
				...(options.native === false
					? []
					: [XdgConfig.nativeResolver({ namespace: appDirs.namespace, filename: options.filename })]),
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
				...(options.parseOptions !== undefined && { parseOptions: options.parseOptions }),
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
export class AppConfig {
	private constructor() {}

	/**
	 * Build the xdg-flavored config layer for a `ConfigFile.Service` class.
	 *
	 * @remarks
	 * Wraps `ConfigFile.layer(tag, …)` with the resolver chain xdg documents, in
	 * xdg's documented order — `XdgConfig.resolver`, then `XdgConfig.nativeResolver`
	 * — and with `defaultPath: XdgConfig.savePath(filename)`, which fits
	 * config-file's infallible `defaultPath` slot without an `orDie` because xdg
	 * resolves at layer-construction time.
	 *
	 * `options.resolvers` prepends to that chain, which covers the case this
	 * preset otherwise could not: a CLI whose `--config` flag must outrank the
	 * app's XDG search path. What it deliberately does not cover is a chain that
	 * needs the XDG resolvers somewhere other than last, or no XDG resolvers at
	 * all — an app wanting that composes `ConfigFile.layer` from
	 * `@effected/config-file` directly and orders the whole chain itself, which
	 * costs it only the `defaultPath` and ambient-namespace wiring this preset
	 * does for free.
	 *
	 * **The namespace is never a parameter.** It is read from the ambient
	 * `AppDirs` service at layer build time, so it is typed exactly once, in
	 * `App.layer` — the two-strings drift where an app passes `"myapp"` to
	 * `App.layer` and `"my-app"` to its config preset cannot happen.
	 *
	 * This is a layer-returning function: bind the result to a `const` and reuse
	 * that binding, or two provide sites mint two independent service instances.
	 */
	static readonly layer = layer;
}
