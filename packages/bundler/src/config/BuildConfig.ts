import { Effect, Schema } from "effect";
import { ActionConfig } from "./ActionConfig.js";

// Every `title`, `description`, `default`, `examples` and `x-taplo` below is
// editor documentation for the published `effected.toml` JSON Schema
// (`schemas/1.0/config.json`). They change nothing about decoding: a class's
// documentation sits on the `Struct` it wraps, because that struct is what the
// schema generator lowers, and a field's sits on its own schema, before any
// `withDecodingDefaultKey`.

/**
 * A module format the build can emit.
 *
 * @public
 */
export const BuildFormat = Schema.Literals(["esm", "cjs"]).annotate({
	title: "Module format",
	description: "A module format the build emits: esm or cjs.",
	"x-taplo": { docs: { enumValues: ["ECMAScript modules.", "CommonJS modules."] } },
});

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
export const BuildPlatform = Schema.Literals(["node", "browser", "neutral"]).annotate({
	title: "Platform",
	description: "The platform the JS pass targets.",
	"x-taplo": {
		docs: {
			enumValues: ["A Node.js runtime.", "A browser runtime.", "No platform: neither Node nor browser built-ins."],
		},
	},
});

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
export class EntryOverride extends Schema.Class<EntryOverride>("EntryOverride")(
	Schema.Struct({
		/** Export paths to pin to this partition, e.g. `"./changesets/markdownlint"`, or `"."` for the root. */
		entries: Schema.Array(Schema.String).annotate({
			description: 'Export paths pinned to this partition, or "." for the root.',
			examples: [["./changesets/markdownlint"], ["."]],
		}),
		/** Output module formats for this partition. */
		format: Schema.optionalKey(
			Schema.Array(BuildFormat).annotate({ description: "Output module formats for this partition." }),
		),
		/** Packages force-bundled into this partition's JS output. */
		bundle: Schema.optionalKey(
			Schema.Array(Schema.String).annotate({ description: "Packages force-bundled into this partition's JS output." }),
		),
		/** Packages kept external in this partition. */
		externals: Schema.optionalKey(
			Schema.Array(Schema.String).annotate({ description: "Packages kept external in this partition." }),
		),
		/** Whether this partition bundles its `node_modules` dependencies. */
		bundleNodeModules: Schema.optionalKey(
			Schema.Boolean.annotate({ description: "Whether this partition bundles its node_modules dependencies." }),
		),
		/** Packages whose declarations are inlined into this partition's `.d.ts`; a workspace sibling must be built first. */
		bundledPackages: Schema.optionalKey(
			Schema.Array(Schema.String).annotate({
				description:
					"Packages whose declarations are inlined into this partition's .d.ts. A workspace sibling must be built first.",
			}),
		),
		/** Packages externalized in this partition's declaration pass only. */
		dtsExternals: Schema.optionalKey(
			Schema.Array(Schema.String).annotate({
				description: "Packages externalized in this partition's declaration pass only.",
			}),
		),
		/** The JS pass's platform for this partition, `"node"` when absent. Use `"browser"` for a browser runtime. */
		platform: Schema.optionalKey(BuildPlatform),
		/** CSS handling forwarded to tsdown's `css` option on the JS pass; tsdown owns the shape. */
		// The key carries the description: core lowers `Unknown` to `{}` and drops its own annotations.
		css: Schema.optionalKey(Schema.Unknown).annotateKey({
			description: "CSS handling forwarded to tsdown's css option on the JS pass. tsdown owns the shape.",
		}),
		/**
		 * Builds this partition into a `pkg/<outSubdir>/` subdirectory as an isolated sub-package.
		 *
		 * @remarks
		 * The export's built path becomes `./<outSubdir>/index.{js,d.ts}`. Exactly one export path may be pinned
		 * per `outSubdir` override.
		 */
		outSubdir: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"Builds this partition as an isolated sub-package in pkg/<outSubdir>/, so the export's built path becomes ./<outSubdir>/index.js. Pin exactly one export path.",
				examples: ["browser"],
			}),
		),
	}).annotate({
		title: "Entry override",
		description:
			"Format and bundling settings pinned to some export paths, layered onto the base build. Every setting but entries is absent unless written, and absent means the base build's value.",
	}),
) {}

/**
 * One standalone output file's source and format.
 *
 * @public
 */
export class LooseFileSpec extends Schema.Class<LooseFileSpec>("LooseFileSpec")(
	Schema.Struct({
		/** Source module to bundle into the file. */
		source: Schema.String.annotate({
			description: "The source module bundled into the file.",
			examples: ["src/hook.ts"],
		}),
		/** Module format. Required only for an ambiguous `.js` key; inferred from `.mjs` and `.cjs`. */
		format: Schema.optionalKey(BuildFormat),
	}).annotate({
		title: "Loose file",
		description:
			"One standalone output file's source and format. The format is inferred from an .mjs or .cjs key and required only for a .js key.",
	}),
) {}

/**
 * One non-module asset to copy into each publish group's `pkg/` directory, in the shape of tsdown's `copy` option.
 *
 * @public
 */
export class CopyEntry extends Schema.Class<CopyEntry>("CopyEntry")(
	Schema.Struct({
		/**
		 * Source paths or globs, relative to the package directory. A directory is copied whole and keeps its own basename
		 * under `to`, so `{ from: "../../schemas", to: "schemas" }` emits `pkg/schemas/schemas/...`; use the bare string
		 * `"../../schemas"` to ship `schemas/` at the package root.
		 */
		from: Schema.Union([Schema.String, Schema.Array(Schema.String)]).annotate({
			description:
				'Source paths or globs, relative to the package. A directory keeps its own basename under to, so from = "../../schemas" with to = "schemas" emits pkg/schemas/schemas/.',
			examples: ["assets/**/*.json", ["LICENSE", "NOTICE"]],
		}),
		/** The destination directory, relative to the group's `pkg/` root, which is the default. It may not leave `pkg/`. */
		to: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The destination directory, relative to the group's pkg/ root, which is the default. It may not leave pkg/.",
			}),
		),
		/** Whether to drop each source's directory structure. tsdown defaults this to `true`. */
		flatten: Schema.optionalKey(
			Schema.Boolean.annotate({
				description: "Whether to drop each source's directory structure. tsdown defaults this to true.",
			}),
		),
	}).annotate({
		title: "Copy entry",
		description: "A non-module asset copied into each group's pkg/ directory, in the shape of tsdown's copy option.",
	}),
) {}

/**
 * JSX transform settings.
 *
 * @public
 */
export class JsxConfig extends Schema.Class<JsxConfig>("JsxConfig")(
	Schema.Struct({
		/** `"automatic"` auto-imports the JSX factories; `"classic"` compiles to `React.createElement`. */
		runtime: Schema.optionalKey(
			Schema.Literals(["automatic", "classic"]).annotate({
				description: "The JSX runtime.",
				"x-taplo": {
					docs: {
						enumValues: ["Auto-imports the JSX factories from importSource.", "Compiles JSX to React.createElement."],
					},
				},
			}),
		),
		/** The JSX import source for the automatic runtime, e.g. `"react"` or `"preact"`. */
		importSource: Schema.optionalKey(
			Schema.String.annotate({
				description: "The JSX import source for the automatic runtime.",
				examples: ["react", "preact"],
			}),
		),
	}).annotate({
		title: "JSX",
		description: "JSX transform settings. Inferred from the package's tsconfig when absent.",
	}),
) {}

/**
 * What the build changes in the emitted `package.json`.
 *
 * @public
 */
export class ManifestConfig extends Schema.Class<ManifestConfig>("ManifestConfig")(
	Schema.Struct({
		/** Top-level manifest keys to drop from the emitted `package.json`, beyond the ones always stripped. */
		drop: Schema.Array(Schema.String)
			.annotate({
				description: "Top-level keys dropped from the emitted package.json, beyond the ones always stripped.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Top-level string keys written over the emitted `package.json`, after `drop`.
		 *
		 * @remarks
		 * `name` renames the package everywhere the build names it: every publish group without its own name override,
		 * `targets.json` and the API model, so two workspace packages can emit as one published name. Keys the build or the
		 * release owns, such as `version`, `private`, `exports` and the dependency maps, fail validation, as does a key also
		 * listed in `drop`.
		 */
		set: Schema.Record(Schema.String, Schema.String)
			.annotate({
				description:
					"Top-level string keys written over the emitted package.json, after drop. name renames the package everywhere the build names it. Keys the build or the release owns, such as version, exports and the dependency maps, fail validation.",
				default: {},
				examples: [{ name: "@scope/published-name" }],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	}).annotate({
		title: "Manifest",
		description: "What the build changes in the emitted package.json.",
	}),
) {}

/**
 * An API Extractor message-suppression rule.
 *
 * @remarks
 * `messageId` matches exactly and `pattern`, a regex or substring, matches the message text. A rule with
 * both needs both to match.
 *
 * @public
 */
export class WarningSuppressionRule extends Schema.Class<WarningSuppressionRule>("WarningSuppressionRule")(
	Schema.Struct({
		/** The exact API Extractor message id. */
		messageId: Schema.optionalKey(
			Schema.String.annotate({
				description: "The exact API Extractor message id.",
				examples: ["ae-forgotten-export"],
			}),
		),
		/** A regex or substring matched against the message text. */
		pattern: Schema.optionalKey(
			Schema.String.annotate({ description: "A regex or substring matched against the message text." }),
		),
	}).annotate({
		title: "Warning suppression",
		description:
			"An API Extractor message-suppression rule. A rule with both messageId and pattern needs both to match; a rule with neither matches nothing.",
	}),
) {}

/**
 * A single TSDoc tag definition, as API Extractor's TSDoc config takes it.
 *
 * @public
 */
export class TsdocTagDefinition extends Schema.Class<TsdocTagDefinition>("TsdocTagDefinition")(
	Schema.Struct({
		/** The tag's name, with its leading `@`. */
		tagName: Schema.String.annotate({ description: "The tag's name, with its leading @.", examples: ["@since"] }),
		/** The tag's syntax. */
		syntaxKind: Schema.Literals(["block", "inline", "modifier"]).annotate({
			description: "The tag's syntax.",
			"x-taplo": {
				docs: {
					enumValues: [
						"A block tag, which owns the text after it.",
						"An inline tag, written inside braces.",
						"A modifier tag, which carries no content.",
					],
				},
			},
		}),
		/** Whether a declaration may carry the tag more than once. */
		allowMultiple: Schema.optionalKey(
			Schema.Boolean.annotate({ description: "Whether a declaration may carry the tag more than once." }),
		),
	}).annotate({
		title: "TSDoc tag",
		description: "A custom TSDoc tag definition, as API Extractor's TSDoc config takes it.",
	}),
) {}

/**
 * TSDoc and documentation-warning settings.
 *
 * @public
 */
export class TsdocConfig extends Schema.Class<TsdocConfig>("TsdocConfig")(
	Schema.Struct({
		/**
		 * API Extractor messages to suppress.
		 *
		 * @remarks
		 * Defaults to the `_base` forgotten-export every `Schema.Class` synthesizes. A list replaces the default
		 * rather than adding to it, so an empty list suppresses nothing.
		 */
		suppressWarnings: Schema.Array(WarningSuppressionRule)
			.annotate({
				description:
					"API Extractor messages to suppress. Defaults to the _base forgotten-export every Schema.Class synthesizes. A list replaces the default, so an empty list suppresses nothing.",
				default: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([{ messageId: "ae-forgotten-export", pattern: "_base" }]))),
		/** Custom TSDoc tags to register. */
		tagDefinitions: Schema.Array(TsdocTagDefinition)
			.annotate({ description: "Custom TSDoc tags to register.", default: [] })
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
	}).annotate({
		title: "TSDoc",
		description: "TSDoc and documentation-warning settings for the API model.",
	}),
) {}

/**
 * API model generation settings, the `[package.build.meta]` table.
 *
 * @public
 */
export class MetaConfig extends Schema.Class<MetaConfig>("MetaConfig")(
	Schema.Struct({
		/**
		 * Directories, relative to the package directory, that the canonical group's API model is copied into.
		 *
		 * @remarks
		 * For a docs site reading the model from its own tree. Each one receives the `.api.json`, the meta `package.json`
		 * and `tsconfig.json`, and `bundle.json` when one was emitted.
		 */
		localPaths: Schema.Array(Schema.String)
			.annotate({
				description:
					"Directories, relative to the package, that the canonical group's API model is copied into, for a docs site that reads the model from its own tree.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Forward-looks the meta bundle's own version and its workspace siblings' dependency versions to their
		 * next release versions from pending changesets.
		 *
		 * @remarks
		 * `"auto"` is `false` under CI and `true` locally, so a local bundle matches the CI release build.
		 */
		optimistic: Schema.Union([Schema.Literal("auto"), Schema.Boolean])
			.annotate({
				description:
					'Forward-looks the meta bundle\'s versions to their next release versions from pending changesets. "auto" is false under CI and true locally.',
				default: "auto",
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed("auto" as const))),
		/** TSDoc and documentation-warning settings. */
		tsdoc: TsdocConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	}).annotate({
		title: "API model",
		description: "API model generation settings, the [package.build.meta] table.",
	}),
) {}

/**
 * A single-executable (SEA) target platform and architecture.
 *
 * @public
 */
export class ExeTargetConfig extends Schema.Class<ExeTargetConfig>("ExeTargetConfig")(
	Schema.Struct({
		/** The platform, using tsdown's `win` token rather than `win32`. */
		platform: Schema.Literals(["darwin", "linux", "win"]).annotate({
			description: "The platform, using tsdown's win token rather than win32.",
			"x-taplo": { docs: { enumValues: ["macOS.", "Linux.", "Windows."] } },
		}),
		/** The CPU architecture. */
		arch: Schema.Literals(["arm64", "x64"]).annotate({
			description: "The CPU architecture.",
			"x-taplo": { docs: { enumValues: ["64-bit ARM.", "64-bit x86."] } },
		}),
	}).annotate({
		title: "Executable target",
		description: "A single-executable target platform and architecture.",
	}),
) {}

/**
 * Single-executable `seaConfig` overrides, merged over the defaults.
 *
 * @public
 */
export class ExeSeaConfig extends Schema.Class<ExeSeaConfig>("ExeSeaConfig")(
	Schema.Struct({
		/** Whether to silence Node's experimental SEA warning. */
		disableExperimentalSEAWarning: Schema.optionalKey(
			Schema.Boolean.annotate({ description: "Whether to silence Node's experimental SEA warning." }),
		),
		/** Whether to embed V8's code cache. */
		useCodeCache: Schema.optionalKey(Schema.Boolean.annotate({ description: "Whether to embed V8's code cache." })),
		/** Whether to embed a V8 startup snapshot. */
		useSnapshot: Schema.optionalKey(
			Schema.Boolean.annotate({ description: "Whether to embed a V8 startup snapshot." }),
		),
	}).annotate({
		title: "SEA config",
		description: "Single-executable seaConfig overrides, merged over the defaults.",
	}),
) {}

/**
 * One single-executable (SEA) binary to compile.
 *
 * @public
 */
export class ExeConfig extends Schema.Class<ExeConfig>("ExeConfig")(
	Schema.Struct({
		/** Output binary basename, with no extension or suffix. */
		fileName: Schema.String.annotate({
			description: "The output binary's basename, with no extension or suffix.",
			examples: ["effected"],
		}),
		/** The bin entry; `./src/bin.ts` when absent. */
		entry: Schema.optionalKey(
			Schema.String.annotate({ description: "The bin entry. ./src/bin.ts when absent.", examples: ["./src/bin.ts"] }),
		),
		/** The Node runtime to embed. */
		nodeVersion: Schema.optionalKey(Schema.String.annotate({ description: "The Node runtime version to embed." })),
		/** `seaConfig` overrides merged over the defaults. */
		seaConfig: Schema.optionalKey(ExeSeaConfig),
		/** Explicit targets; inferred from the package's `os` and `cpu` when absent. */
		targets: Schema.optionalKey(
			Schema.Array(ExeTargetConfig).annotate({
				description: "Explicit targets. Inferred from the package's os and cpu fields when absent.",
			}),
		),
	}).annotate({
		title: "Executable",
		description: "One single-executable (SEA) binary to compile.",
	}),
) {}

/**
 * The build settings of one package, the `[package.build]` table.
 *
 * @remarks
 * Every field has a default or is absent, so an empty table is a complete config.
 *
 * @public
 */
export class PackageBuildConfig extends Schema.Class<PackageBuildConfig>("PackageBuildConfig")(
	Schema.Struct({
		/** Output module formats. ESM-only by default; add `"cjs"` for a dual-format build. */
		format: Schema.Array(BuildFormat)
			.annotate({
				description: 'Output module formats. ESM-only by default; add "cjs" for a dual-format build.',
				default: ["esm"],
				examples: [["esm", "cjs"]],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed(["esm" as const]))),
		/** Packages kept external. */
		externals: Schema.Array(Schema.String)
			.annotate({ description: "Packages kept external.", default: [] })
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Packages force-bundled into the JS output, even ones declared in `package.json` that would otherwise be
		 * external.
		 *
		 * @remarks
		 * The inverse of `externals`. Declarations are not inlined by this; use `bundledPackages` to roll a
		 * package's types into the emitted `.d.ts` too.
		 */
		bundle: Schema.Array(Schema.String)
			.annotate({
				description:
					"Packages force-bundled into the JS output, even ones package.json declares. Declarations are not inlined; use bundledPackages for that.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * External packages whose declarations are inlined into the bundled `.d.ts`; all others stay external.
		 *
		 * @remarks
		 * A workspace sibling inlines from its built declarations, so it has to be built first; the build fails naming it
		 * when they are absent.
		 */
		bundledPackages: Schema.Array(Schema.String)
			.annotate({
				description:
					"External packages whose declarations are inlined into the bundled .d.ts. A workspace sibling inlines from its built declarations, so build it first.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Packages externalized in the declaration pass only: imported from the emitted `.d.ts` rather than
		 * inlined, while the JS pass still bundles them per `bundleNodeModules`.
		 *
		 * @remarks
		 * For a dependency whose types cannot be safely inlined, such as `effect`'s cross-module `declare module`
		 * augmentations. Declare these as package dependencies so consumers can resolve the emitted imports.
		 */
		dtsExternals: Schema.Array(Schema.String)
			.annotate({
				description:
					"Packages externalized in the declaration pass only. Declare them as dependencies so consumers can resolve the emitted imports.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Bundles `node_modules` and workspace dependencies that are not externalized into the JS output and the
		 * bundled declarations alike.
		 */
		bundleNodeModules: Schema.Boolean.annotate({
			description:
				"Bundles node_modules and workspace dependencies that are not external into the JS output and the declarations alike.",
			default: false,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
		/**
		 * Minifies the output.
		 *
		 * @remarks
		 * Off by default: minified Node libraries trip security scanners and degrade stack traces.
		 */
		minify: Schema.Boolean.annotate({
			description: "Minifies the output. Off by default: minified Node libraries trip security scanners.",
			default: false,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
		/**
		 * Runs the bundled `.d.ts` pass and, with it, the meta pass that reads those declarations.
		 *
		 * @remarks
		 * `false` is for JS-only artifacts that never consume declarations. It differs from `meta = false`, which
		 * disables only the API model and still runs the declaration pass.
		 */
		emitDts: Schema.Boolean.annotate({
			description:
				"Runs the declaration pass and, with it, the meta pass. false is for JS-only artifacts; meta = false disables only the API model.",
			default: true,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
		/**
		 * Compile-time global replacements forwarded to the build's `define`.
		 *
		 * @remarks
		 * Values are inserted verbatim, so a string literal must carry its own quotes.
		 */
		define: Schema.Record(Schema.String, Schema.String)
			.annotate({
				description:
					"Compile-time replacements forwarded to the build's define. Values are inserted verbatim, so a string literal carries its own quotes.",
				default: {},
				examples: [{ "process.env.FEATURE": '"on"' }],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** Modules whose default export is a rolldown plugin or a factory of one, as package-relative paths. */
		plugins: Schema.Array(Schema.String)
			.annotate({
				description: "Package-relative modules whose default export is a rolldown plugin or a factory of one.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/** Per-entry format and bundling overrides, layered onto the base build. */
		overrides: Schema.Array(EntryOverride)
			.annotate({
				description: "Format and bundling settings pinned to some export paths, layered onto the base build.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Standalone bundled output files emitted at literal paths, outside the exports, declaration and meta graph.
		 *
		 * @remarks
		 * Keys are literal output filenames; values are a source path or a {@link LooseFileSpec}. Pair with
		 * `bundleNodeModules` to make each file self-contained.
		 */
		looseFiles: Schema.Record(
			Schema.String,
			Schema.Union([Schema.String, LooseFileSpec]).annotate({
				description: "A source path, or a table naming the source and its format.",
			}),
		)
			.annotate({
				description:
					"Standalone files at literal output paths, outside the exports, declaration and meta graph. Each key is an output filename.",
				default: {},
				examples: [{ "hook.mjs": "src/hook.ts" }],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
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
		copy: Schema.Array(
			Schema.Union([Schema.String, CopyEntry]).annotate({
				description: "A path or glob copied into the pkg/ root, or a table with a destination.",
			}),
		)
			.annotate({
				description:
					"Non-module assets copied into each group's pkg/ directory. A directory keeps its basename. public/ is copied with no config.",
				default: [],
				examples: [["../../schemas"]],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/** JSX transform settings; inferred from the package's tsconfig when absent. */
		jsx: Schema.optionalKey(JsxConfig),
		/** What the build changes in the emitted `package.json`. */
		manifest: ManifestConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** API model generation: its settings, or `false` to opt out. Generated with defaults when absent. */
		meta: Schema.Union([Schema.Literal(false), MetaConfig])
			.annotate({
				description:
					"The API model's settings, or false to opt out and still run the declaration pass. Generated with defaults when absent.",
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** Single-executable binaries to compile: one, or a list. */
		exe: Schema.optionalKey(
			Schema.Union([ExeConfig, Schema.Array(ExeConfig)]).annotate({
				description: "Single-executable binaries to compile: one table, or a list of them.",
			}),
		),
	}).annotate({
		title: "Package build",
		description:
			"The build settings of one package, the [package.build] table. Every key has a default or is absent, so an empty table is a complete config.",
	}),
) {}

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
		path: Schema.optionalKey(
			Schema.String.annotate({ description: "A bundle-relative asset path. Mutually exclusive with url." }),
		),
		/** Absolute external URL, used verbatim. Mutually exclusive with `path`. */
		url: Schema.optionalKey(
			Schema.String.annotate({ description: "An absolute external URL, used verbatim. Mutually exclusive with path." }),
		),
		/** MIME type; inferred from the extension when absent. */
		type: Schema.optionalKey(
			Schema.String.annotate({
				description: "The MIME type. Inferred from the extension when absent.",
				examples: ["image/png"],
			}),
		),
		/** Pixel width. */
		width: Schema.optionalKey(Schema.Int.annotate({ description: "The width in pixels." })),
		/** Pixel height. */
		height: Schema.optionalKey(Schema.Int.annotate({ description: "The height in pixels." })),
		/** Alt text; inferred when absent. */
		alt: Schema.optionalKey(Schema.String.annotate({ description: "The alt text. Inferred when absent." })),
	})
		.annotate({
			title: "Open Graph image",
			description: "One Open Graph image the API docs declare. Exactly one of path and url must be present.",
		})
		.check(
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
export class BundleRegistryRef extends Schema.Class<BundleRegistryRef>("BundleRegistryRef")(
	Schema.Struct({
		/** The protocol family, e.g. `"npm"` or `"jsr"`. Unknown values are accepted. */
		type: Schema.String.annotate({
			description: "The protocol family. Unknown values are accepted.",
			examples: ["npm", "jsr"],
		}),
		/** The human instance label, e.g. `"npm"`. */
		name: Schema.String.annotate({ description: "The registry instance's human label.", examples: ["npm"] }),
		/** The package's URL on that registry instance. */
		url: Schema.String.annotate({ description: "The package's URL on that registry instance." }),
	}).annotate({
		title: "Registry",
		description: "One registry the documented package is published to.",
	}),
) {}

/**
 * The Open Graph settings of a package's API docs.
 *
 * @public
 */
export class BundleOpenGraphConfig extends Schema.Class<BundleOpenGraphConfig>("BundleOpenGraphConfig")(
	Schema.Struct({
		/** Static images, by path or url. Listed after a generated image. */
		images: Schema.optionalKey(
			Schema.Array(BundleOpenGraphImage).annotate({
				description: "Static images, by path or url. Listed after a generated image.",
			}),
		),
		/** Embed accent color, a CSS color string. */
		themeColor: Schema.optionalKey(
			Schema.String.annotate({ description: "The embed accent color, a CSS color string.", examples: ["#3178c6"] }),
		),
		/** Renders an image at build time, listed first. `"satori"` is the only renderer. */
		generate: Schema.optionalKey(
			Schema.Literal("satori").annotate({
				description: "Renders an image at build time, listed first.",
				"x-taplo": { docs: { enumValues: ["Renders the card with satori, the only renderer."] } },
			}),
		),
		/**
		 * The cross-build image cache's salt.
		 *
		 * @remarks
		 * A string caches under it, so change it whenever the renderer's output changes for the same input.
		 * `false` always regenerates. Absent, the renderer's own salt is used.
		 */
		cacheSalt: Schema.optionalKey(
			Schema.Union([Schema.String, Schema.Literal(false)]).annotate({
				description:
					"The generated image cache's salt: change it when the renderer's output changes. false always regenerates; absent uses the renderer's own salt.",
			}),
		),
	}).annotate({
		title: "Open Graph",
		description: "The Open Graph settings of the package's API docs.",
	}),
) {}

/**
 * The config tier of a package's emitted `bundle.json`, the `[package.bundle]` table.
 *
 * @public
 */
export class BundleConfig extends Schema.Class<BundleConfig>("BundleConfig")(
	Schema.Struct({
		/** The display name. */
		name: Schema.optionalKey(Schema.String.annotate({ description: "The display name." })),
		/** A one-line tagline. */
		tagline: Schema.optionalKey(Schema.String.annotate({ description: "A one-line tagline." })),
		/** A description. */
		description: Schema.optionalKey(Schema.String.annotate({ description: "A description of the package." })),
		/** The Open Graph settings. */
		openGraph: Schema.optionalKey(BundleOpenGraphConfig),
		/** Registries; `false` disables the default derived from `targets.json`. */
		registries: Schema.optionalKey(
			Schema.Union([Schema.Array(BundleRegistryRef), Schema.Literal(false)]).annotate({
				description:
					"The registries the package is published to. false disables the default derived from targets.json.",
			}),
		),
	}).annotate({
		title: "Bundle",
		description: "The config tier of the emitted bundle.json, the [package.bundle] table.",
	}),
) {}

/**
 * The `[package]` table of `effected.toml`.
 *
 * @public
 */
export class PackageConfig extends Schema.Class<PackageConfig>("PackageConfig")(
	Schema.Struct({
		/** The build settings. */
		build: PackageBuildConfig.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** The `bundle.json` config tier. */
		bundle: Schema.optionalKey(BundleConfig),
	}).annotate({
		title: "Package",
		description: "The [package] table: the package's build settings and its bundle.json config tier.",
	}),
) {}

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
