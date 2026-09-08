import type {
	ConfigCodec,
	ConfigEvents,
	ConfigEventsShape,
	ConfigFileShape,
	ConfigValidationError,
	MergeStrategy as MergeStrategyShape,
} from "@effected/config-file";
import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
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
	 *
	 * Ignored when `xdg` is `false`: the native probe is the tail of the XDG
	 * fallback chain, not an independent tier.
	 */
	readonly native?: boolean;
	/**
	 * Probe the app's XDG config search path. Defaults to `true`.
	 *
	 * @remarks
	 * Pass `false` to build the chain from `resolvers` (and `resolversAfter`,
	 * and `systemEtc`) alone. The case it exists for is a CLI's
	 * `--config <path>` branch, where a search-path fallback defeats the flag's
	 * purpose: without it, a `--config` naming a file that fails to resolve
	 * silently loads the user's XDG config instead.
	 *
	 * It drops **both** XDG resolvers — `XdgConfig.resolver` and, since it is
	 * documented as sitting behind it, `XdgConfig.nativeResolver`. `native` has
	 * no effect while `xdg` is `false`.
	 *
	 * `defaultPath` is unaffected: `save` still writes to
	 * `XdgConfig.savePath(filename)`. Dropping the *discovery* tier is not a
	 * statement about where this app saves its config.
	 */
	readonly xdg?: boolean;
	/**
	 * Append the system tier — `<dir>/<namespace>/<filename>`, `/etc` by
	 * default — after the XDG chain. Defaults to absent (no system tier).
	 *
	 * @remarks
	 * `true` uses `/etc`; an object overrides the system config root, which is
	 * chiefly how a test points the tier at a writable directory. The app name
	 * is the ambient `AppDirs` namespace, never a parameter — the same rule the
	 * XDG resolvers follow, so the two cannot drift apart.
	 *
	 * It is appended **after** the XDG pair because a machine-wide default must
	 * lose to a user's own config, which is the whole convention. A chain that
	 * wants the system tier somewhere else passes
	 * `ConfigResolver.systemEtc` through `resolvers` or `resolversAfter`
	 * instead and leaves this absent.
	 */
	readonly systemEtc?: boolean | { readonly dir?: string };
	/**
	 * Resolvers composed **after** every built-in tier, in priority order —
	 * the lowest-priority end of the chain.
	 *
	 * @remarks
	 * The counterpart to `resolvers`, which prepends. Together the two make the
	 * whole chain caller-controlled without giving up what this preset does for
	 * free (the ambient namespace and `defaultPath`): the built-ins can be
	 * surrounded, and with `xdg: false` they can be removed entirely, at which
	 * point the chain is exactly `[...resolvers, ...resolversAfter]`.
	 *
	 * These come last, after the system tier, so a caller who needs a different
	 * order around `systemEtc` leaves that option absent and passes
	 * `ConfigResolver.systemEtc` here in the position it wants.
	 */
	readonly resolversAfter?: ReadonlyArray<ConfigResolver<RR>>;
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
			const xdg = options.xdg !== false;
			const systemEtc = options.systemEtc ?? false;
			const systemEtcDir = typeof systemEtc === "object" ? systemEtc.dir : undefined;
			const resolvers: ReadonlyArray<ConfigResolver<AppDirs | Xdg | FileSystem.FileSystem | Path.Path | RR>> = [
				// Caller resolvers lead: a `--config` flag outranks the app's own
				// search path, which is the whole point of passing one.
				...(options.resolvers ?? []),
				// The XDG pair is one tier: `native` is the tail of the XDG fallback
				// chain, so `xdg: false` drops both rather than leaving an orphan.
				...(xdg ? [XdgConfig.resolver({ filename: options.filename })] : []),
				...(xdg && options.native !== false
					? [XdgConfig.nativeResolver({ namespace: appDirs.namespace, filename: options.filename })]
					: []),
				// A machine-wide default loses to the user's own config, so the
				// system tier sits behind the XDG pair.
				...(systemEtc === false
					? []
					: [
							ConfigResolver.systemEtc({
								app: appDirs.namespace,
								filename: options.filename,
								...(systemEtcDir !== undefined && { dir: systemEtcDir }),
							}),
						]),
				...(options.resolversAfter ?? []),
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
	 * The chain is caller-controlled at both ends: `options.resolvers` prepends,
	 * `options.resolversAfter` appends, `options.systemEtc` adds the `/etc`
	 * tier behind the XDG pair, and `options.xdg: false` removes the XDG pair
	 * altogether — at which point the chain is exactly the caller's own, and
	 * the preset is contributing the ambient namespace and `defaultPath` alone.
	 * Dropping to `ConfigFile.layer` directly is no longer the price of an
	 * unusual chain.
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
