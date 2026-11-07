import { resolve } from "node:path";
import { Effect, Predicate, Schema } from "effect";
import { createJiti } from "jiti";
import type { Plugin } from "rolldown";
import { causeMessage } from "../internal/causeMessage.js";

/**
 * A module named in `package.build.plugins` could not be loaded as a rolldown plugin.
 *
 * @public
 */
export class PluginLoadError extends Schema.TaggedError<PluginLoadError>()("PluginLoadError", {
	/** The module's resolved path. */
	path: Schema.String,
	/** What was wrong with it. */
	reason: Schema.String,
}) {
	override get message(): string {
		return `Failed to load plugin ${this.path}: ${this.reason}`;
	}
}

/**
 * The default importer's jiti, with the options the schema config loader uses, so a `.ts` module loads.
 *
 * @remarks
 * Built per load because `moduleCache` and `fsCache` are off and the importer's base path is the module's own.
 */
const importWithJiti = (path: string): Promise<unknown> =>
	createJiti(path, { interopDefault: true, moduleCache: false, fsCache: false }).import(path);

const isPlugin = (value: unknown): value is Plugin =>
	typeof value === "object" && Predicate.hasProperty(value, "name") && Predicate.isString(value.name);

/** Turns a module's default export into its plugin. */
const pluginOf = (path: string, value: unknown): Effect.Effect<Plugin, PluginLoadError> => {
	if (!Predicate.hasProperty(value, "default")) {
		return Effect.fail(new PluginLoadError({ path, reason: "the module has no default export" }));
	}
	const exported = value.default;
	if (isPlugin(exported)) return Effect.succeed(exported);
	if (typeof exported !== "function") {
		return Effect.fail(
			new PluginLoadError({ path, reason: "the default export is not a rolldown plugin or a factory of one" }),
		);
	}
	return Effect.try({
		try: (): unknown => exported(),
		catch: (cause) =>
			new PluginLoadError({
				path,
				reason: `the default export factory threw: ${causeMessage(cause) ?? String(cause)}`,
			}),
	}).pipe(
		Effect.flatMap((made) =>
			isPlugin(made)
				? Effect.succeed(made)
				: Effect.fail(
						new PluginLoadError({ path, reason: "the default export factory did not return a rolldown plugin" }),
					),
		),
	);
};

/**
 * Loads the rolldown plugins named in `package.build.plugins`, in order.
 *
 * @remarks
 * Each module path resolves against `cwd`, so a bare `build/plugin.ts` is a file in the package rather than a
 * package name. A module's default export is a plugin, or a factory of one that is called once. Loading runs
 * the module's code, and stops at the first module that fails.
 *
 * @param options - `cwd` is the package directory and `modules` the paths to load. `importModule` replaces the
 * default importer, jiti, which loads TypeScript directly.
 *
 * @public
 */
export const loadPlugins = Effect.fn("loadPlugins")(function* (options: {
	readonly cwd: string;
	readonly modules: ReadonlyArray<string>;
	readonly importModule?: (path: string) => Promise<unknown>;
}) {
	const importModule = options.importModule ?? importWithJiti;
	return yield* Effect.forEach(options.modules, (module) => {
		const path = resolve(options.cwd, module);
		return Effect.tryPromise({
			try: () => importModule(path),
			catch: (cause) => new PluginLoadError({ path, reason: causeMessage(cause) ?? String(cause) }),
		}).pipe(Effect.flatMap((value) => pluginOf(path, value)));
	});
});
