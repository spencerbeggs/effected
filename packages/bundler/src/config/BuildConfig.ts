import { Effect, Schema } from "effect";
import { ActionConfig } from "./ActionConfig.js";

/**
 * A module format the build can emit.
 *
 * @public
 */
export const BuildFormat = Schema.Literals(["esm", "cjs"]);

/**
 * The decoded type of {@link (BuildFormat:variable)}.
 *
 * @public
 */
export type BuildFormat = typeof BuildFormat.Type;

/**
 * The platform a JS pass targets.
 *
 * @public
 */
export const BuildPlatform = Schema.Literals(["node", "browser", "neutral"]);

/**
 * The decoded type of {@link (BuildPlatform:variable)}.
 *
 * @public
 */
export type BuildPlatform = typeof BuildPlatform.Type;

/**
 * Format and bundling settings pinned to some of a package's export paths, layered onto the base build.
 *
 * @remarks
 * Use one to keep a single entry CJS in an otherwise ESM-only package, or to build an entry as an isolated
 * browser sub-package. Every setting except `entries` is absent unless written, and absent means the base
 * build's value.
 *
 * @public
 */
export class EntryOverride extends Schema.Class<EntryOverride>("EntryOverride")({
	/** Export paths to pin to this partition, e.g. `"./changesets/markdownlint"`, or `"."` for the root. */
	entries: Schema.Array(Schema.String),
	/** Output module formats for this partition. */
	format: Schema.optionalKey(Schema.Array(BuildFormat)),
	/** Packages force-bundled into this partition's JS output. */
	bundle: Schema.optionalKey(Schema.Array(Schema.String)),
	/** Packages kept external in this partition. */
	externals: Schema.optionalKey(Schema.Array(Schema.String)),
	/** Whether this partition bundles its `node_modules` dependencies. */
	bundleNodeModules: Schema.optionalKey(Schema.Boolean),
	/** Packages whose declarations are inlined into this partition's `.d.ts`; a workspace sibling must be built first. */
	bundledPackages: Schema.optionalKey(Schema.Array(Schema.String)),
	/** Packages externalized in this partition's declaration pass only. */
	dtsExternals: Schema.optionalKey(Schema.Array(Schema.String)),
	/** The JS pass's platform for this partition, `"node"` when absent. Use `"browser"` for a browser runtime. */
	platform: Schema.optionalKey(BuildPlatform),
	/** CSS handling forwarded to tsdown's `css` option on the JS pass; tsdown owns the shape. */
	css: Schema.optionalKey(Schema.Unknown),
	/**
	 * Builds this partition into a `pkg/<outSubdir>/` subdirectory as an isolated sub-package.
	 *
	 * @remarks
	 * The export's built path becomes `./<outSubdir>/index.{js,d.ts}`. Exactly one export path may be pinned
	 * per `outSubdir` override.
	 */
	outSubdir: Schema.optionalKey(Schema.String),
}) {}

/**
 * One standalone output file's source and format.
 *
 * @public
 */
export class LooseFileSpec extends Schema.Class<LooseFileSpec>("LooseFileSpec")({
	/** Source module to bundle into the file. */
	source: Schema.String,
	/** Module format. Required only for an ambiguous `.js` key; inferred from `.mjs` and `.cjs`. */
	format: Schema.optionalKey(BuildFormat),
}) {}

/**
 * One non-module asset to copy into each publish group's `pkg/` directory, in the shape of tsdown's `copy` option.
 *
 * @public
 */
export class CopyEntry extends Schema.Class<CopyEntry>("CopyEntry")({
	/**
	 * Source paths or globs, relative to the package directory. A directory is copied whole and keeps its own basename
	 * under `to`, so `{ from: "../../schemas", to: "schemas" }` emits `pkg/schemas/schemas/...`; use the bare string
	 * `"../../schemas"` to ship `schemas/` at the package root.
	 */
	from: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
	/** The destination directory, relative to the group's `pkg/` root, which is the default. It may not leave `pkg/`. */
	to: Schema.optionalKey(Schema.String),
	/** Whether to drop each source's directory structure. tsdown defaults this to `true`. */
	flatten: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * JSX transform settings.
 *
 * @public
 */
export class JsxConfig extends Schema.Class<JsxConfig>("JsxConfig")({
	/** `"automatic"` auto-imports the JSX factories; `"classic"` compiles to `React.createElement`. */
	runtime: Schema.optionalKey(Schema.Literals(["automatic", "classic"])),
	/** The JSX import source for the automatic runtime, e.g. `"react"` or `"preact"`. */
	importSource: Schema.optionalKey(Schema.String),
}) {}

/**
 * What the build changes in the emitted `package.json`.
 *
 * @public
 */
export class ManifestConfig extends Schema.Class<ManifestConfig>("ManifestConfig")({
	/** Top-level manifest keys to drop from the emitted `package.json`, beyond the ones always stripped. */
	drop: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Top-level string keys written over the emitted `package.json`, after `drop`.
	 *
	 * @remarks
	 * `name` renames the package everywhere the build names it: every publish group without its own name override,
	 * `targets.json` and the API model, so two workspace packages can emit as one published name. Keys the build or the
	 * release owns, such as `version`, `private`, `exports` and the dependency maps, fail validation, as does a key also
	 * listed in `drop`.
	 */
	set: Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}) {}

/**
 * An API Extractor message-suppression rule.
 *
 * @remarks
 * `messageId` matches exactly and `pattern`, a regex or substring, matches the message text. A rule with
 * both needs both to match.
 *
 * @public
 */
export class WarningSuppressionRule extends Schema.Class<WarningSuppressionRule>("WarningSuppressionRule")({
	/** The exact API Extractor message id. */
	messageId: Schema.optionalKey(Schema.String),
	/** A regex or substring matched against the message text. */
	pattern: Schema.optionalKey(Schema.String),
}) {}

/**
 * A single TSDoc tag definition, as API Extractor's TSDoc config takes it.
 *
 * @public
 */
export class TsdocTagDefinition extends Schema.Class<TsdocTagDefinition>("TsdocTagDefinition")({
	/** The tag's name, with its leading `@`. */
	tagName: Schema.String,
	/** The tag's syntax. */
	syntaxKind: Schema.Literals(["block", "inline", "modifier"]),
	/** Whether a declaration may carry the tag more than once. */
	allowMultiple: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * TSDoc and documentation-warning settings.
 *
 * @public
 */
export class TsdocConfig extends Schema.Class<TsdocConfig>("TsdocConfig")({
	/**
	 * API Extractor messages to suppress.
	 *
	 * @remarks
	 * Defaults to the `_base` forgotten-export every `Schema.Class` synthesizes. A list replaces the default
	 * rather than adding to it, so an empty list suppresses nothing.
	 */
	suppressWarnings: Schema.Array(WarningSuppressionRule).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed([{ messageId: "ae-forgotten-export", pattern: "_base" }])),
	),
	/** Custom TSDoc tags to register. */
	tagDefinitions: Schema.Array(TsdocTagDefinition).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
}) {}

/**
 * API model generation settings, the `[package.build.meta]` table.
 *
 * @public
 */
export class MetaConfig extends Schema.Class<MetaConfig>("MetaConfig")({
	/**
	 * Directories, relative to the package directory, that the canonical group's API model is copied into.
	 *
	 * @remarks
	 * For a docs site reading the model from its own tree. Each one receives the `.api.json`, the meta `package.json`
	 * and `tsconfig.json`, and `bundle.json` when one was emitted.
	 */
	localPaths: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Forward-looks the meta bundle's own version and its workspace siblings' dependency versions to their
	 * next release versions from pending changesets.
	 *
	 * @remarks
	 * `"auto"` is `false` under CI and `true` locally, so a local bundle matches the CI release build.
	 */
	optimistic: Schema.Union([Schema.Literal("auto"), Schema.Boolean]).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed("auto" as const)),
	),
	/** TSDoc and documentation-warning settings. */
	tsdoc: TsdocConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
}) {}

/**
 * A single-executable (SEA) target platform and architecture.
 *
 * @public
 */
export class ExeTargetConfig extends Schema.Class<ExeTargetConfig>("ExeTargetConfig")({
	/** The platform, using tsdown's `win` token rather than `win32`. */
	platform: Schema.Literals(["darwin", "linux", "win"]),
	/** The CPU architecture. */
	arch: Schema.Literals(["arm64", "x64"]),
}) {}

/**
 * Single-executable `seaConfig` overrides, merged over the defaults.
 *
 * @public
 */
export class ExeSeaConfig extends Schema.Class<ExeSeaConfig>("ExeSeaConfig")({
	/** Whether to silence Node's experimental SEA warning. */
	disableExperimentalSEAWarning: Schema.optionalKey(Schema.Boolean),
	/** Whether to embed V8's code cache. */
	useCodeCache: Schema.optionalKey(Schema.Boolean),
	/** Whether to embed a V8 startup snapshot. */
	useSnapshot: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * One single-executable (SEA) binary to compile.
 *
 * @public
 */
export class ExeConfig extends Schema.Class<ExeConfig>("ExeConfig")({
	/** Output binary basename, with no extension or suffix. */
	fileName: Schema.String,
	/** The bin entry; `./src/bin.ts` when absent. */
	entry: Schema.optionalKey(Schema.String),
	/** The Node runtime to embed. */
	nodeVersion: Schema.optionalKey(Schema.String),
	/** `seaConfig` overrides merged over the defaults. */
	seaConfig: Schema.optionalKey(ExeSeaConfig),
	/** Explicit targets; inferred from the package's `os` and `cpu` when absent. */
	targets: Schema.optionalKey(Schema.Array(ExeTargetConfig)),
}) {}

/**
 * The build settings of one package, the `[package.build]` table.
 *
 * @remarks
 * Every field has a default or is absent, so an empty table is a complete config.
 *
 * @public
 */
export class PackageBuildConfig extends Schema.Class<PackageBuildConfig>("PackageBuildConfig")({
	/** Output module formats. ESM-only by default; add `"cjs"` for a dual-format build. */
	format: Schema.Array(BuildFormat).pipe(Schema.withDecodingDefaultKey(Effect.succeed(["esm" as const]))),
	/** Packages kept external. */
	externals: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Packages force-bundled into the JS output, even ones declared in `package.json` that would otherwise be
	 * external.
	 *
	 * @remarks
	 * The inverse of `externals`. Declarations are not inlined by this; use `bundledPackages` to roll a
	 * package's types into the emitted `.d.ts` too.
	 */
	bundle: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * External packages whose declarations are inlined into the bundled `.d.ts`; all others stay external.
	 *
	 * @remarks
	 * A workspace sibling inlines from its built declarations, so it has to be built first; the build fails naming it
	 * when they are absent.
	 */
	bundledPackages: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Packages externalized in the declaration pass only: imported from the emitted `.d.ts` rather than
	 * inlined, while the JS pass still bundles them per `bundleNodeModules`.
	 *
	 * @remarks
	 * For a dependency whose types cannot be safely inlined, such as `effect`'s cross-module `declare module`
	 * augmentations. Declare these as package dependencies so consumers can resolve the emitted imports.
	 */
	dtsExternals: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Bundles `node_modules` and workspace dependencies that are not externalized into the JS output and the
	 * bundled declarations alike.
	 */
	bundleNodeModules: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	/**
	 * Minifies the output.
	 *
	 * @remarks
	 * Off by default: minified Node libraries trip security scanners and degrade stack traces.
	 */
	minify: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
	/**
	 * Runs the bundled `.d.ts` pass and, with it, the meta pass that reads those declarations.
	 *
	 * @remarks
	 * `false` is for JS-only artifacts that never consume declarations. It differs from `meta = false`, which
	 * disables only the API model and still runs the declaration pass.
	 */
	emitDts: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
	/**
	 * Compile-time global replacements forwarded to the build's `define`.
	 *
	 * @remarks
	 * Values are inserted verbatim, so a string literal must carry its own quotes.
	 */
	define: Schema.Record(Schema.String, Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	/** Modules whose default export is a rolldown plugin or a factory of one, as package-relative paths. */
	plugins: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** Per-entry format and bundling overrides, layered onto the base build. */
	overrides: Schema.Array(EntryOverride).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/**
	 * Standalone bundled output files emitted at literal paths, outside the exports, declaration and meta graph.
	 *
	 * @remarks
	 * Keys are literal output filenames; values are a source path or a {@link LooseFileSpec}. Pair with
	 * `bundleNodeModules` to make each file self-contained.
	 */
	looseFiles: Schema.Record(Schema.String, Schema.Union([Schema.String, LooseFileSpec])).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed({})),
	),
	/**
	 * Non-module assets copied into each group's `pkg/` directory by the JS pass.
	 *
	 * @remarks
	 * tsdown's `copy` option as data: a string is a path or glob relative to the package directory, copied into the
	 * `pkg/` root, and {@link CopyEntry} adds a destination. A directory keeps its basename, so `"../../schemas"` ships
	 * `pkg/schemas/...`. A `public/` directory is already copied verbatim with no
	 * config; this is the explicit way, for files that live elsewhere. A package that compiles only a binary runs no JS
	 * pass, so setting this there fails validation.
	 */
	copy: Schema.Array(Schema.Union([Schema.String, CopyEntry])).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	/** JSX transform settings; inferred from the package's tsconfig when absent. */
	jsx: Schema.optionalKey(JsxConfig),
	/** What the build changes in the emitted `package.json`. */
	manifest: ManifestConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	/** API model generation: its settings, or `false` to opt out. Generated with defaults when absent. */
	meta: Schema.Union([Schema.Literal(false), MetaConfig]).pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	/** Single-executable binaries to compile: one, or a list. */
	exe: Schema.optionalKey(Schema.Union([ExeConfig, Schema.Array(ExeConfig)])),
}) {}

/**
 * One Open Graph image a package's API docs declare.
 *
 * @remarks
 * Exactly one of `path` and `url` must be present.
 *
 * @public
 */
export class BundleOpenGraphImage extends Schema.Class<BundleOpenGraphImage>("BundleOpenGraphImage")(
	Schema.Struct({
		/** Bundle-relative asset path. Mutually exclusive with `url`. */
		path: Schema.optionalKey(Schema.String),
		/** Absolute external URL, used verbatim. Mutually exclusive with `path`. */
		url: Schema.optionalKey(Schema.String),
		/** MIME type; inferred from the extension when absent. */
		type: Schema.optionalKey(Schema.String),
		/** Pixel width. */
		width: Schema.optionalKey(Schema.Int),
		/** Pixel height. */
		height: Schema.optionalKey(Schema.Int),
		/** Alt text; inferred when absent. */
		alt: Schema.optionalKey(Schema.String),
	}).check(
		Schema.makeFilter(
			(image) =>
				(image.path === undefined) !== (image.url === undefined)
					? undefined
					: 'exactly one of "path" or "url" must be present',
			{ title: "openGraph image source" },
		),
	),
) {}

/**
 * One registry a documented package is published to.
 *
 * @public
 */
export class BundleRegistryRef extends Schema.Class<BundleRegistryRef>("BundleRegistryRef")({
	/** The protocol family, e.g. `"npm"` or `"jsr"`. Unknown values are accepted. */
	type: Schema.String,
	/** The human instance label, e.g. `"npm"`. */
	name: Schema.String,
	/** The package's URL on that registry instance. */
	url: Schema.String,
}) {}

/**
 * The Open Graph settings of a package's API docs.
 *
 * @public
 */
export class BundleOpenGraphConfig extends Schema.Class<BundleOpenGraphConfig>("BundleOpenGraphConfig")({
	/** Static images, by path or url. Listed after a generated image. */
	images: Schema.optionalKey(Schema.Array(BundleOpenGraphImage)),
	/** Embed accent color, a CSS color string. */
	themeColor: Schema.optionalKey(Schema.String),
	/** Renders an image at build time, listed first. `"satori"` is the only renderer. */
	generate: Schema.optionalKey(Schema.Literal("satori")),
	/**
	 * The cross-build image cache's salt.
	 *
	 * @remarks
	 * A string caches under it, so change it whenever the renderer's output changes for the same input.
	 * `false` always regenerates. Absent, the renderer's own salt is used.
	 */
	cacheSalt: Schema.optionalKey(Schema.Union([Schema.String, Schema.Literal(false)])),
}) {}

/**
 * The config tier of a package's emitted `bundle.json`, the `[package.bundle]` table.
 *
 * @public
 */
export class BundleConfig extends Schema.Class<BundleConfig>("BundleConfig")({
	/** The display name. */
	name: Schema.optionalKey(Schema.String),
	/** A one-line tagline. */
	tagline: Schema.optionalKey(Schema.String),
	/** A description. */
	description: Schema.optionalKey(Schema.String),
	/** The Open Graph settings. */
	openGraph: Schema.optionalKey(BundleOpenGraphConfig),
	/** Registries; `false` disables the default derived from `targets.json`. */
	registries: Schema.optionalKey(Schema.Union([Schema.Array(BundleRegistryRef), Schema.Literal(false)])),
}) {}

/**
 * The `[package]` table of `effected.toml`.
 *
 * @public
 */
export class PackageConfig extends Schema.Class<PackageConfig>("PackageConfig")({
	/** The build settings. */
	build: PackageBuildConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	/** The `bundle.json` config tier. */
	bundle: Schema.optionalKey(BundleConfig),
}) {}

/**
 * A decoded `effected.toml`.
 *
 * @remarks
 * Decode it with `onExcessProperty: "error"`: a struct's decode drops
 * unknown keys by default, and a typo in a human-written config must fail naming its path rather than
 * silently taking the default.
 *
 * @public
 */
export class EffectedConfig extends Schema.Class<EffectedConfig>("EffectedConfig")({
	/** The package tables. */
	package: Schema.optionalKey(PackageConfig),
	/** The GitHub Action table. Absent for a library. */
	action: Schema.optionalKey(ActionConfig),
}) {}
