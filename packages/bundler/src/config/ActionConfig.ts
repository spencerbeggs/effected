import { Effect, Schema } from "effect";

// Every `title`, `description`, `default` and `examples` below is editor
// documentation for the published `effected.toml` JSON Schema; none of it
// changes decoding. See the note at the top of `BuildConfig.ts`.

/**
 * A worker written as a table, `[action.entries.workers.<name>]`, for a worker that needs more than its source.
 *
 * @remarks
 * A worker given as a plain string is its source, with every setting at its default.
 *
 * @public
 */
export class ActionWorker extends Schema.Class<ActionWorker>("ActionWorker")(
	Schema.Struct({
		/** The worker's source, relative to the package. */
		source: Schema.String.annotate({
			description: "The worker's source, relative to the package.",
			examples: ["src/worker.ts"],
		}),
		/**
		 * Whether this worker's bundle is imported after the build to prove it loads.
		 *
		 * @remarks
		 * For a worker that refuses to start at import by design, such as one that exits when the configuration its
		 * action passes through the environment is missing. `[action.build] importCheck = false` still turns the check off
		 * for every bundle, this one included.
		 */
		importCheck: Schema.Boolean.annotate({
			description:
				"Whether this worker's bundle is imported after the build to prove it loads. [action.build] importCheck = false turns the check off for every bundle, this one included.",
			default: true,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
	}).annotate({
		title: "Action worker",
		description:
			"A worker written as a table, for a worker that needs more than its source. A plain string is the source with every setting at its default.",
	}),
) {}

/**
 * The bundles a GitHub Action ships, the `[action.entries]` table.
 *
 * @remarks
 * `main`, `pre` and `post` are the lifecycle entries `action.yml` runs. A worker is a bundle outside that
 * lifecycle, which the action loads itself.
 *
 * @public
 */
export class ActionEntries extends Schema.Class<ActionEntries>("ActionEntries")(
	Schema.Struct({
		/** The main entry point's source. */
		main: Schema.String.annotate({ description: "The main entry point's source.", default: "src/main.ts" }).pipe(
			Schema.withDecodingDefaultKey(Effect.succeed("src/main.ts")),
		),
		/** The source of the entry that runs before `main`. */
		pre: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The source of the entry that runs before main. Absent, a conventional src/pre.ts builds when it exists.",
			}),
		),
		/** The source of the entry that runs after `main`, for cleanup. */
		post: Schema.optionalKey(
			Schema.String.annotate({
				description:
					"The source of the entry that runs after main, for cleanup. Absent, a conventional src/post.ts builds when it exists.",
			}),
		),
		/**
		 * Extra bundles outside the lifecycle, each emitted as `dist/<name>.js`: a name to its source, or to an
		 * {@link ActionWorker} table.
		 */
		workers: Schema.Record(
			Schema.String,
			Schema.Union([Schema.String, ActionWorker]).annotate({
				description: "The worker's source, or a table of its settings.",
			}),
		)
			.annotate({
				description:
					"Extra bundles outside the lifecycle, each emitted as dist/<name>.js: a name to its source, or to a table of its own.",
				default: {},
				examples: [{ telemetry: "src/telemetry.ts" }],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	}).annotate({
		title: "Action entries",
		description:
			"The bundles the action ships, the [action.entries] table. main, pre and post are the lifecycle entries action.yml runs; a worker is a bundle the action loads itself.",
	}),
) {}

/**
 * How an action's bundles are built, the `[action.build]` table.
 *
 * @remarks
 * There is no key for keeping a package's dynamic imports native, and writing one fails like any unknown key.
 * Rolldown leaves a computed `import()` native on its own, so a workaround for a bundler that compiles one into a
 * module that cannot find its target has no counterpart here.
 *
 * @public
 */
export class ActionBuildOptions extends Schema.Class<ActionBuildOptions>("ActionBuildOptions")(
	Schema.Struct({
		/** Whether to minify the bundles. */
		minify: Schema.Boolean.annotate({ description: "Whether to minify the bundles.", default: true }).pipe(
			Schema.withDecodingDefaultKey(Effect.succeed(true)),
		),
		/** Whether to generate source maps. */
		sourceMap: Schema.Boolean.annotate({ description: "Whether to generate source maps.", default: false }).pipe(
			Schema.withDecodingDefaultKey(Effect.succeed(false)),
		),
		/** Packages left out of the bundles and imported at runtime, in addition to `node:` builtins. */
		externals: Schema.Array(Schema.String)
			.annotate({
				description: "Packages left out of the bundles and imported at runtime, beside node: builtins.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Packages left out of the bundles and replaced with a stub that throws if it is ever loaded.
		 *
		 * @remarks
		 * For an optional transitive dependency the action never exercises, such as a native module.
		 */
		ignore: Schema.Array(Schema.String)
			.annotate({
				description:
					"Packages left out of the bundles and replaced with a stub that throws if loaded, for an optional dependency the action never exercises.",
				default: [],
			})
			.pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
		/**
		 * Whether to import each bundle in a fresh Node after building it, which proves it loads.
		 *
		 * @remarks
		 * A bundle can build cleanly and not load, and this is the only check that finds out. Turn it off for an action
		 * with no `GITHUB_ACTIONS` guard around its program, because the import runs that program for real. To exempt one
		 * worker and keep the check on the rest, set `importCheck = false` in that worker's own table instead.
		 */
		importCheck: Schema.Boolean.annotate({
			description:
				"Whether to import each bundle in a fresh Node after building it, proving it loads. Turn it off for an action with no GITHUB_ACTIONS guard, because the import runs it for real.",
			default: true,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
	}).annotate({
		title: "Action build",
		description: "How the action's bundles are built, the [action.build] table.",
	}),
) {}

/**
 * What an action build checks before it builds, the `[action.validation]` table.
 *
 * @public
 */
export class ActionValidationOptions extends Schema.Class<ActionValidationOptions>("ActionValidationOptions")(
	Schema.Struct({
		/** Whether `action.yml` must exist and be valid. */
		requireActionYml: Schema.Boolean.annotate({
			description: "Whether action.yml must exist and be valid.",
			default: true,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
		/** The size past which a bundle is reported, such as `"5mb"` or `"500kb"`. */
		maxBundleSize: Schema.optionalKey(
			Schema.String.annotate({
				description: "The size past which a bundle is reported.",
				examples: ["5mb", "500kb"],
			}),
		),
		/** Whether a warning is an error. Absent means it is under CI and is not locally. */
		strict: Schema.optionalKey(
			Schema.Boolean.annotate({
				description: "Whether a warning is an error. Absent, it is under CI and is not locally.",
			}),
		),
	}).annotate({
		title: "Action validation",
		description: "What an action build checks before it builds, the [action.validation] table.",
	}),
) {}

/**
 * The local copy of an action's build for testing with nektos/act, the `[action.persistLocal]` table.
 *
 * @public
 */
export class ActionPersistLocalOptions extends Schema.Class<ActionPersistLocalOptions>("ActionPersistLocalOptions")(
	Schema.Struct({
		/** Whether to copy the build output locally. */
		enabled: Schema.Boolean.annotate({ description: "Whether to copy the build output locally.", default: true }).pipe(
			Schema.withDecodingDefaultKey(Effect.succeed(true)),
		),
		/** The local action directory, relative to the package. */
		path: Schema.String.annotate({
			description: "The local action directory, relative to the package.",
			default: ".github/actions/local",
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(".github/actions/local"))),
		/** Whether to generate the act boilerplate, `.actrc` and `act-test.yml`, when those files do not exist. */
		actTemplate: Schema.Boolean.annotate({
			description: "Whether to generate the act boilerplate, .actrc and act-test.yml, when those files do not exist.",
			default: true,
		}).pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
	}).annotate({
		title: "Local action copy",
		description: "The local copy of the action's build for testing with nektos/act, the [action.persistLocal] table.",
	}),
) {}

/**
 * A GitHub Action's build settings, the `[action]` table of `effected.toml`.
 *
 * @remarks
 * Every field has a default, so an empty table is a complete config. An `effected.toml` with no `[action]` table
 * at all is a library rather than an action, which is why `config.action` stays absent in that case.
 *
 * @public
 */
export class ActionConfig extends Schema.Class<ActionConfig>("ActionConfig")(
	Schema.Struct({
		/** The bundles to build. */
		entries: ActionEntries.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** How to build them. */
		build: ActionBuildOptions.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** What to check before building. */
		validation: ActionValidationOptions.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
		/** The local copy for testing with nektos/act. */
		persistLocal: ActionPersistLocalOptions.pipe(Schema.withDecodingDefaultKey(Effect.succeed({}))),
	}).annotate({
		title: "Action",
		description:
			"A GitHub Action's build settings, the [action] table. Every key has a default, so an empty table is a complete config; a file with no [action] table is a library.",
	}),
) {}
