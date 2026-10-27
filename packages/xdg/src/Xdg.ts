import { Config, ConfigProvider, Context, Effect, Layer, Option, Schema } from "effect";

/**
 * The operating system the path decisions are taken against.
 *
 * @remarks
 * The members are Node's `process.platform` values, modeled as a schema rather
 * than borrowed from the ambient `NodeJS.Platform` type so the package's public
 * surface names nothing it does not own.
 *
 * @public
 */
export const XdgPlatform = Schema.Literals([
	"aix",
	"android",
	"darwin",
	"freebsd",
	"haiku",
	"linux",
	"openbsd",
	"sunos",
	"win32",
	"cygwin",
	"netbsd",
]);

/**
 * The decoded form of {@link (XdgPlatform:variable)}.
 *
 * @public
 */
export type XdgPlatform = typeof XdgPlatform.Type;

const detectPlatform = (): XdgPlatform => {
	const platform = globalThis.process?.platform;
	// A platform Node does not report — or no `process` at all, as in a browser
	// or a worker — behaves as Linux: XDG is the convention, no native override.
	return Schema.is(XdgPlatform)(platform) ? platform : "linux";
};

/**
 * The platform every native-directory decision is taken against.
 *
 * @remarks
 * A `Context.Reference`, not a global read. Its default is the package's one
 * sanctioned ambient read — `globalThis.process?.platform`, falling back to
 * `"linux"` where there is no `process` — and every caller can override it, so
 * production behaviour is what you expect while a test pins macOS or Windows
 * semantics with `Layer.succeed(CurrentPlatform, "win32")` and exercises the
 * whole native-path matrix without touching a real filesystem or the real
 * platform.
 *
 * Three sites read it: {@link Xdg.layer} (the home variable, the absolute-path
 * rule and the `*_DIRS` delimiter), `AppDirs.layer` (the native rung) and
 * `XdgConfig.nativeResolver`. They must see the same platform, so an
 * application that overrides it provides it **once, at the edge**, beneath all
 * three — never per layer, where two builds could disagree about which
 * operating system they are on.
 *
 * @public
 */
export const CurrentPlatform: Context.Reference<XdgPlatform> = Context.Reference<XdgPlatform>(
	"@effected/xdg/CurrentPlatform",
	{ defaultValue: detectPlatform },
);

/**
 * Indicates that the environment cannot satisfy XDG directory resolution.
 *
 * @remarks
 * Raised only for the home directory: every other XDG variable is optional by
 * construction, and its absence is a resolved default rather than a failure.
 * `cause` carries the underlying `ConfigError` structurally.
 *
 * `variable` is `"HOME"` on every platform but Windows. On `win32` the home
 * directory is read from `USERPROFILE`, falling back to `HOME`, and `variable`
 * is `"USERPROFILE"` — a stable discriminator meaning **neither** variable was
 * set, which the message spells out.
 *
 * @public
 */
export class XdgEnvError extends Schema.TaggedError<XdgEnvError>()("XdgEnvError", {
	/**
	 * The environment variable that was required and not found: `"HOME"`, or
	 * `"USERPROFILE"` on `win32`, where it means neither `USERPROFILE` nor `HOME`.
	 */
	variable: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return this.variable === "USERPROFILE"
			? "Neither the USERPROFILE nor the HOME environment variable is set"
			: `The ${this.variable} environment variable is not set`;
	}
}

/**
 * The XDG Base Directory environment, resolved.
 *
 * @remarks
 * Every field but `home` is optional because the corresponding variable is:
 * `Schema.optionalKey`, so an unset variable is an **absent key** and the read
 * is `paths.configHome ?? fallback`.
 *
 * `configDirs` and `dataDirs` are the system search paths, split and defaulted
 * per the spec (`/etc/xdg` and `/usr/local/share:/usr/share`). They are what
 * make a config lookup a genuine ordered search rather than a single stat.
 *
 * Built by {@link Xdg.layer}, every optional path is **pre-validated
 * absolute**: the XDG Base Directory specification says a relative path in an
 * `XDG_*` variable is invalid and must be ignored, so a relative value reads as
 * an absent key, never as a directory under the current working directory.
 * `home` is the exception and is deliberately not validated. A value passed to
 * {@link Xdg.layerFrom} is trusted as given — it is the test escape hatch.
 *
 * @public
 */
export class XdgPaths extends Schema.Class<XdgPaths>("XdgPaths")({
	/**
	 * The home directory: `$HOME`, or on `win32` `%USERPROFILE%` falling back to
	 * `$HOME`. The one value that must be set. Not validated as absolute.
	 */
	home: Schema.String,
	/** `$XDG_CONFIG_HOME`. */
	configHome: Schema.optionalKey(Schema.String),
	/** `$XDG_DATA_HOME`. */
	dataHome: Schema.optionalKey(Schema.String),
	/** `$XDG_CACHE_HOME`. */
	cacheHome: Schema.optionalKey(Schema.String),
	/** `$XDG_STATE_HOME`. */
	stateHome: Schema.optionalKey(Schema.String),
	/** `$XDG_RUNTIME_DIR`. Absent on most non-Linux systems. */
	runtimeDir: Schema.optionalKey(Schema.String),
	/** `%APPDATA%`, on Windows. */
	appData: Schema.optionalKey(Schema.String),
	/** `%LOCALAPPDATA%`, on Windows. */
	localAppData: Schema.optionalKey(Schema.String),
	/**
	 * `$XDG_CONFIG_DIRS`, split on `:` (`;` on `win32`), relative entries
	 * dropped. Defaults to `["/etc/xdg"]`.
	 */
	configDirs: Schema.Array(Schema.String),
	/**
	 * `$XDG_DATA_DIRS`, split on `:` (`;` on `win32`), relative entries dropped.
	 * Defaults to `["/usr/local/share", "/usr/share"]`.
	 */
	dataDirs: Schema.Array(Schema.String),
}) {}

/** A Windows absolute path: an optional drive letter, then a separator. Core's own rule. */
const WIN32_ABSOLUTE = /^([a-zA-Z]:)?[\\/]/;

/**
 * Whether `value` is an absolute path on `platform`.
 *
 * @remarks
 * Pure string inspection, so the check needs no `Path` service and the layer's
 * requirements do not grow. On `win32` both `C:\x` and a rooted `\x` or `/x`
 * count; everywhere else only a leading `/` does.
 */
const isAbsoluteFor = (platform: XdgPlatform, value: string): boolean =>
	platform === "win32" ? WIN32_ABSOLUTE.test(value) : value.startsWith("/");

/**
 * Split a `PATH`-style variable, dropping empty and relative entries.
 *
 * @remarks
 * Per the XDG spec, an unset **or empty** variable takes the default — so
 * `XDG_CONFIG_DIRS=""` is not "no system directories", it is `/etc/xdg`. The
 * spec also says a relative entry is invalid and ignored, and is silent on what
 * a list emptied by that rule means; this module reads it the way it reads an
 * empty variable, so `XDG_CONFIG_DIRS=rel` also takes the default.
 *
 * On `win32` the delimiter is `;`, the Windows path-list separator: splitting
 * `C:\ProgramData\xdg` on `:` would yield a drive letter and a drive-less
 * rooted fragment that the absolute rule would wrongly accept.
 */
const splitDirs = (
	raw: string | undefined,
	fallback: ReadonlyArray<string>,
	platform: XdgPlatform,
): ReadonlyArray<string> => {
	if (raw === undefined) return fallback;
	const parts = raw
		.split(platform === "win32" ? ";" : ":")
		.filter((entry) => entry.length > 0 && isAbsoluteFor(platform, entry));
	return parts.length === 0 ? fallback : parts;
};

/**
 * Read the XDG environment from the ambient `ConfigProvider` — the one
 * resolution {@link Xdg.layer} and {@link Xdg.layerFromEnv} share.
 */
const readPaths: Effect.Effect<XdgPaths, XdgEnvError> = Effect.gen(function* () {
	/**
	 * `Config<T>` IS an `Effect<T, ConfigError>` in v4, so it pipes directly.
	 * Every `ConfigError` becomes an `XdgEnvError` naming the variable it came from.
	 */
	const asEnvError = <A>(name: string, config: Config.Config<A>): Effect.Effect<A, XdgEnvError> =>
		Effect.catchTag(config, "ConfigError", (cause) => Effect.fail(new XdgEnvError({ variable: name, cause })));

	const platform = yield* CurrentPlatform;

	// On Windows the home directory is `USERPROFILE`, as Node's `os.homedir()`
	// reads it; `HOME` is usually set only under Git Bash or MSYS, where it
	// normally agrees, so it stays as the fallback and nothing that works
	// today stops working.
	const home = yield* platform === "win32"
		? asEnvError("USERPROFILE", Config.String("USERPROFILE").pipe(Config.orElse(() => Config.String("HOME"))))
		: asEnvError("HOME", Config.String("HOME"));

	/**
	 * An unset variable is `Option.none()`, not a failure. The residual
	 * `ConfigError` a `Config.option` can still raise is a *provider* failure
	 * (a `ConfigProvider` backed by a directory or a `.env` file that cannot be
	 * read), not a missing key — so it is mapped rather than swallowed.
	 */
	const read = (name: string): Effect.Effect<string | undefined, XdgEnvError> =>
		Effect.map(asEnvError(name, Config.option(Config.String(name))), Option.getOrUndefined<string>);

	/** A path variable whose relative value is ignored, as though it were unset. */
	const readAbsolute = (name: string, rule: XdgPlatform): Effect.Effect<string | undefined, XdgEnvError> =>
		Effect.map(read(name), (value) => (value !== undefined && isAbsoluteFor(rule, value) ? value : undefined));

	const configHome = yield* readAbsolute("XDG_CONFIG_HOME", platform);
	const dataHome = yield* readAbsolute("XDG_DATA_HOME", platform);
	const cacheHome = yield* readAbsolute("XDG_CACHE_HOME", platform);
	const stateHome = yield* readAbsolute("XDG_STATE_HOME", platform);
	const runtimeDir = yield* readAbsolute("XDG_RUNTIME_DIR", platform);
	// Windows variables, read only by the win32 native rung: judged by the
	// Windows rule on every host, so the answer never depends on where it ran.
	const appData = yield* readAbsolute("APPDATA", "win32");
	const localAppData = yield* readAbsolute("LOCALAPPDATA", "win32");
	const configDirs = yield* read("XDG_CONFIG_DIRS");
	const dataDirs = yield* read("XDG_DATA_DIRS");

	// A *present* key holding `undefined` is not the same as an absent key —
	// v4 constructors validate — so every optional field is conditionally spread.
	return XdgPaths.make({
		home,
		...(configHome !== undefined && { configHome }),
		...(dataHome !== undefined && { dataHome }),
		...(cacheHome !== undefined && { cacheHome }),
		...(stateHome !== undefined && { stateHome }),
		...(runtimeDir !== undefined && { runtimeDir }),
		...(appData !== undefined && { appData }),
		...(localAppData !== undefined && { localAppData }),
		configDirs: splitDirs(configDirs, ["/etc/xdg"], platform),
		dataDirs: splitDirs(dataDirs, ["/usr/local/share", "/usr/share"], platform),
	});
});

/**
 * XDG Base Directory environment resolution.
 *
 * @remarks
 * The service's shape **is** {@link XdgPaths}: the environment is read once, at
 * layer construction, and the service is the resolved value. `yield* Xdg` gives
 * you a record of strings, and the only failure — an unset home directory
 * (`HOME`, or on `win32` both `USERPROFILE` and `HOME`) — happens once, where
 * the layer is built.
 *
 * @public
 */
export class Xdg extends Context.Service<Xdg, XdgPaths>()("@effected/xdg/Xdg") {
	/**
	 * Read the XDG environment through Effect's `Config`.
	 *
	 * @remarks
	 * Reads from the ambient `ConfigProvider`, which defaults to `process.env`.
	 * A test drives it with `ConfigProvider.layer(ConfigProvider.fromUnknown({…}))`
	 * and never mutates the real environment.
	 *
	 * Three rules depend on {@link CurrentPlatform}, read once here:
	 *
	 * - the home directory is `HOME`, or on `win32` `USERPROFILE` then `HOME`;
	 * - a **relative** `XDG_*` value is ignored — it reads as an absent key, per
	 *   the XDG Base Directory specification — under the platform's absolute
	 *   rule, while `APPDATA` and `LOCALAPPDATA`, which are Windows variables,
	 *   are always judged by the Windows rule;
	 * - `XDG_CONFIG_DIRS` and `XDG_DATA_DIRS` split on `;` on `win32` and `:`
	 *   elsewhere, dropping relative entries, and a list left empty takes the
	 *   spec default.
	 *
	 * The home directory itself is deliberately not validated, and a missing one
	 * still fails the whole layer eagerly, even when every `XDG_*_HOME` is set:
	 * the fallback rungs, the native rung and the runtime directory all derive
	 * from it, and failing here is what keeps every downstream read infallible.
	 */
	static readonly layer: Layer.Layer<Xdg, XdgEnvError> = Layer.effect(Xdg, readPaths);

	/**
	 * Read the XDG environment from an explicit environment record instead of
	 * the ambient `ConfigProvider`.
	 *
	 * @remarks
	 * The same resolution as {@link Xdg.layer}, rule for rule — the home
	 * directory (`HOME`, or on `win32` `USERPROFILE` then `HOME`), the relative
	 * value rule, the search-path split — over `env` rather than
	 * `process.env`. A record goes through `ConfigProvider.fromEnvRecord`, so an
	 * empty value reads as unset, exactly as `process.env` does through the
	 * default provider; it is read when the layer is built, never at the call.
	 *
	 * Each call returns a new layer, so two calls with different sources in one
	 * graph resolve independently. Providing a `ConfigProvider` beneath the
	 * shared static {@link Xdg.layer} does not give that — the static is
	 * memoized by reference, so the first provider wins everywhere it is used.
	 *
	 * The layer is also `Layer.fresh`, as `CurrentRuntimeEnv.layerFrom` is: one
	 * returned layer value reads its source again every time it is built, even
	 * provided again inside a provide of itself, where a memoized layer would
	 * hand back the first build. The re-read applies to this value only — a
	 * layer composed from it (`Layer.provide(Xdg.layerFromEnv(env), …)`) is
	 * memoized as usual.
	 *
	 * @example
	 * ```ts
	 * import { AppDirs, Xdg } from "@effected/xdg";
	 * import { Layer } from "effect";
	 *
	 * declare const env: Readonly<Record<string, string | undefined>>;
	 * const DirsLive = Layer.provideMerge(AppDirs.layer({ namespace: "myapp" }), Xdg.layerFromEnv(env));
	 * ```
	 *
	 * @param env - a variable-name-to-value record; for a single `ConfigProvider` per graph, provide it beneath
	 *   {@link Xdg.layer} with `Layer.provide(Xdg.layer, ConfigProvider.layer(provider))` (the first provider wins
	 *   graph-wide, as above)
	 */
	static layerFromEnv(env: Readonly<Record<string, string | undefined>>): Layer.Layer<Xdg, XdgEnvError> {
		return Layer.fresh(
			Layer.effect(
				Xdg,
				Effect.suspend(() =>
					readPaths.pipe(
						Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnvRecord({ ...env })),
					),
				),
			),
		);
	}

	/**
	 * Serve fixed paths instead of reading the environment.
	 *
	 * @remarks
	 * The test layer, and the escape hatch for an application that resolves its
	 * environment some other way. It needs no filesystem.
	 *
	 * @example
	 * ```ts
	 * import { Xdg, XdgPaths } from "@effected/xdg";
	 *
	 * const TestXdg = Xdg.layerFrom(
	 * 	XdgPaths.make({
	 * 		home: "/home/test",
	 * 		configHome: "/home/test/.config",
	 * 		configDirs: ["/etc/xdg"],
	 * 		dataDirs: ["/usr/local/share", "/usr/share"],
	 * 	}),
	 * );
	 * ```
	 */
	static layerFrom(paths: XdgPaths): Layer.Layer<Xdg> {
		return Layer.succeed(Xdg, paths);
	}
}
