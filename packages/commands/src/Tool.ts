import { Schema } from "effect";

/**
 * Where a tool must be found for a resolution to succeed.
 *
 * @remarks
 * `"any"` (the default) accepts either location, choosing between them by
 * `Tool.prefer` when both exist; `"local"` and `"global"` require that
 * location specifically; `"both"` requires the tool in both places.
 *
 * @public
 */
export const ToolSource = Schema.Literals(["any", "global", "local", "both"]);

/**
 * The decoded type of {@link (ToolSource:variable)}.
 *
 * @public
 */
export type ToolSource = typeof ToolSource.Type;

/**
 * What to do when the global and project-local copies report different
 * versions.
 *
 * @remarks
 * `"preferLocal"` and `"preferGlobal"` pick a winner; `"fail"` refuses to
 * resolve. The fact of a mismatch is reported by `ResolvedTool.mismatch`
 * whichever policy is in force, so no separate "report only" policy exists.
 *
 * @public
 */
export const MismatchPolicy = Schema.Literals(["preferLocal", "preferGlobal", "fail"]);

/**
 * The decoded type of {@link (MismatchPolicy:variable)}.
 *
 * @public
 */
export type MismatchPolicy = typeof MismatchPolicy.Type;

/**
 * Which copy wins when a tool is found in both locations and the versions do
 * not force a choice.
 *
 * @remarks
 * Consulted only for `source: "any"` or `"both"` with both copies present.
 * When the two copies report different versions, `onMismatch` decides
 * instead; `Tool.named` defaults `onMismatch` to follow this preference, so a
 * tool named with `prefer: "global"` keeps the global copy either way.
 *
 * @public
 */
export const ToolPreference = Schema.Literals(["local", "global"]);

/**
 * The decoded type of {@link (ToolPreference:variable)}.
 *
 * @public
 */
export type ToolPreference = typeof ToolPreference.Type;

/**
 * Ask the tool for its version with a flag and read the answer out of stdout.
 *
 * @public
 */
export class VersionFlag extends Schema.TaggedClass<VersionFlag>()("VersionFlag", {
	/** The flag to pass, e.g. `"--version"`. Split on spaces into argv. */
	flag: Schema.String,
	/**
	 * A regular-expression source whose **first capture group** is the version.
	 *
	 * @remarks
	 * Omitted, the default pattern takes the first version-shaped token in the
	 * output, which handles the common noisy forms (`Version: 2.3.1 (build …)`,
	 * `v22.1.0`) without configuration. The pattern is developer-supplied and
	 * therefore trusted; it is never built from a tool's output.
	 */
	pattern: Schema.optionalKey(Schema.String),
}) {}

/**
 * Ask the tool for JSON and read the version from a dotted path within it.
 *
 * @public
 */
export class VersionJson extends Schema.TaggedClass<VersionJson>()("VersionJson", {
	/** The flag(s) to pass, e.g. `"info --json"`. Split on spaces into argv. */
	flag: Schema.String,
	/**
	 * Dotted path to the version, e.g. `"deno.version"`; a numeric segment
	 * indexes an array (`"versions.0"`). Only own properties are followed, and
	 * a leaf that is not a string, or stdout that is not JSON, is no version.
	 */
	path: Schema.String,
}) {}

/**
 * Do not ask for a version; presence is the only question.
 *
 * @remarks
 * Presence is still proven by RUNNING the tool, with `flag` (default
 * `--version`) as its arguments. Globally, any completed run counts. Through a
 * project-local launcher (`pnpm exec`, `npx --no --`, …) the run must exit 0,
 * because a launcher reports a missing tool as a non-zero exit, the same code
 * a tool that rejects its arguments returns. So a local tool that rejects
 * `--version` reads as absent: give it a `flag` it accepts with exit 0.
 *
 * @example
 * ```ts
 * // A tool with no --version, probed with an argument it accepts.
 * const tool = Tool.named("legacy-cli", { version: VersionNone.make({ flag: "--help" }) });
 * ```
 *
 * @public
 */
export class VersionNone extends Schema.TaggedClass<VersionNone>()("VersionNone", {
	/**
	 * The argument(s) the presence probe passes, split on spaces into argv.
	 * Omitted means `"--version"`. Locally the probe must exit 0 with them.
	 */
	flag: Schema.optionalKey(Schema.String),
}) {}

/**
 * How to learn a tool's version.
 *
 * @remarks
 * A probe is plain data, so it is serializable and inspectable. A capture
 * `pattern` on {@link VersionFlag} handles unusual output formats, and the
 * default pattern handles most tools with no configuration at all.
 *
 * @public
 */
export const VersionProbe = Schema.Union([VersionFlag, VersionJson, VersionNone]);

/**
 * The decoded type of {@link (VersionProbe:variable)}.
 *
 * @public
 */
export type VersionProbe = typeof VersionProbe.Type;

/**
 * A CLI tool to resolve, and the constraints resolution must satisfy.
 *
 * @public
 */
export class Tool extends Schema.Class<Tool>("Tool")({
	/** The executable name, e.g. `"biome"`. */
	name: Schema.String,
	/** How to learn its version. */
	version: VersionProbe,
	/** Where it must be found. */
	source: ToolSource,
	/** What to do when the two locations disagree on the version. */
	onMismatch: MismatchPolicy,
	/**
	 * Which copy wins when both exist and agree (or report no version).
	 * Omitted means `"local"` — the version the repository's own lockfile pins.
	 */
	prefer: Schema.optionalKey(ToolPreference),
}) {
	/**
	 * Builds a `Tool` from a name, with defaults for everything else
	 * (`--version`, `source: "any"`, `prefer: "local"`, and an `onMismatch`
	 * that follows `prefer`: `"preferLocal"`, or `"preferGlobal"` for
	 * `prefer: "global"`).
	 *
	 * @example
	 * ```ts
	 * const biome = Tool.named("biome");
	 * const localOnly = Tool.named("biome", { source: "local" });
	 * const globalFirst = Tool.named("biome", { prefer: "global" });
	 * ```
	 */
	static readonly named = (
		name: string,
		overrides?: {
			readonly version?: VersionProbe | undefined;
			readonly source?: ToolSource | undefined;
			readonly onMismatch?: MismatchPolicy | undefined;
			readonly prefer?: ToolPreference | undefined;
		},
	): Tool => {
		const prefer = overrides?.prefer ?? "local";
		return Tool.make({
			name,
			version: overrides?.version ?? VersionFlag.make({ flag: "--version" }),
			source: overrides?.source ?? "any",
			onMismatch: overrides?.onMismatch ?? (prefer === "global" ? "preferGlobal" : "preferLocal"),
			prefer,
		});
	};
}
