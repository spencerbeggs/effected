// The pure core of tool discovery, shared by `ToolDiscovery` (Effect) and
// `makeToolDiscoverySync` (the sync facade).
//
// Everything here is decided from EVIDENCE — what probing each location
// learned — and never spawns. The two surfaces differ only in how they spawn a
// probe and how they cache the evidence; the refusal, the version reading, the
// presence rule and the selection all live here once, so they cannot drift.
//
// The decision returns plain data rather than `ResolvedTool` or the error
// classes, so this module imports nothing from `ToolDiscovery.ts`, which
// imports it.

import { Option, Predicate, Schema } from "effect";
import type { ExecContext } from "../LocalExec.js";
import type { Tool, VersionProbe } from "../Tool.js";

/** First version-shaped token: `1.2.3`, `v22.1.0`, `2.3.1-beta.4`. */
const DEFAULT_VERSION_PATTERN = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/;

/** What one probe learned about one location. */
export interface Probe {
	readonly found: boolean;
	readonly version: Option.Option<string>;
}

/** A location that was not found, or was never probed. */
export const ABSENT: Probe = { found: false, version: Option.none() };

/** What probing learned about a tool. Cached; policy is applied to it per call. */
export interface Evidence {
	readonly global: Probe;
	readonly local: Probe;
	readonly context: Option.Option<ExecContext>;
}

/**
 * Whether a name may be spawned at all.
 *
 * @remarks
 * Pre-spawn guard: argv position zero is not a place to accept a flag, and an
 * empty name is no executable.
 */
export const isRefusedName = (name: string): boolean => name === "" || name.startsWith("-");

/** Whether discovery would memoize this evidence: only a tool that was found. */
export const isPositive = (evidence: Evidence): boolean => evidence.global.found || evidence.local.found;

/** argv for a probe: the flag string split on whitespace; a presence-only probe defaults to `--version`. */
export const probeArgs = (probe: VersionProbe): ReadonlyArray<string> =>
	(probe.flag ?? "--version").split(/\s+/).filter((part) => part.length > 0);

/**
 * Decodes a probe's stdout as JSON text, `None` when it is not JSON.
 *
 * @remarks
 * Schema's own JSON codec in place of a `JSON.parse` in a `try`: the outcome is
 * a value rather than a control-flow exception, and it agrees with
 * `JSON.parse` on every input (surrounding whitespace accepted; empty text,
 * trailing garbage and a leading BOM rejected).
 */
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

/**
 * Steps one dotted-path segment into a decoded JSON value.
 *
 * @remarks
 * Objects and arrays are both stepped into (`versions.0` indexes an array), and
 * only an OWN property is followed: a plain index read resolves inherited
 * members, so a string planted on `Object.prototype` would be reported as the
 * version of any tool whose JSON lacks the key.
 */
const step = (current: unknown, key: string): Option.Option<unknown> =>
	Predicate.isObjectOrArray(current) && Object.hasOwn(current, key)
		? Option.some((current as Readonly<Record<string, unknown>>)[key])
		: Option.none();

/** Reads a version out of one probe's captured stdout. */
export const extractVersion = (probe: VersionProbe, stdout: string): Option.Option<string> => {
	if (probe._tag === "VersionNone") return Option.none();
	if (probe._tag === "VersionFlag") {
		const pattern = probe.pattern === undefined ? DEFAULT_VERSION_PATTERN : new RegExp(probe.pattern);
		const match = pattern.exec(stdout);
		// Group 1 when the pattern captures, else the whole match.
		return Option.fromUndefinedOr(match?.[1] ?? match?.[0]);
	}
	return decodeJson(stdout).pipe(
		Option.flatMap((root) =>
			probe.path
				.split(".")
				.reduce<Option.Option<unknown>>(
					(current, key) => Option.flatMap(current, (value) => step(value, key)),
					Option.some(root),
				),
		),
		Option.filter(Predicate.isString),
	);
};

/**
 * What a probe that RAN proves, by location.
 *
 * @remarks
 * Presence is decided by whether the process ran, never by a shell lookup —
 * but the two locations read an exit code differently:
 *
 * - **global** spawns the tool itself, so a completed run proves the tool
 *   exists whatever its exit code (a `--version` that exits 1 still ran);
 * - **local** spawns the LAUNCHER (`pnpm exec`, `npx --no --`, …), which runs
 *   whether or not the tool is installed and reports a missing one as a
 *   non-zero exit (`pnpm exec missing` exits 1, "Command not found"). A run
 *   alone proves only the launcher, so the local copy counts as found only on
 *   exit 0.
 *
 * The launchers give a missing tool and a tool that rejects its arguments the
 * same exit code (pnpm, npx and bun all exit 1 for both); only their stderr,
 * which differs per launcher and version, tells them apart. So the local rule
 * also requires the probe's arguments to succeed: a presence-only probe whose
 * tool rejects `--version` must name an accepted argument with
 * `VersionNone.flag`.
 */
export const probeFromRun = (
	location: "global" | "local",
	probe: VersionProbe,
	run: { readonly exitCode: number; readonly stdout: string },
): Probe =>
	location === "local" && run.exitCode !== 0 ? ABSENT : { found: true, version: extractVersion(probe, run.stdout) };

/** The outcome of applying a tool's policy to its evidence. */
export type ResolutionDecision =
	| { readonly _tag: "NotFound"; readonly searched: ReadonlyArray<"global" | "local"> }
	| { readonly _tag: "Mismatch"; readonly globalVersion: string; readonly localVersion: string }
	| {
			readonly _tag: "Resolved";
			readonly source: "global" | "local";
			readonly version: Option.Option<string>;
			readonly mismatch: boolean;
			readonly context: ExecContext | undefined;
	  };

/**
 * Applies a tool's `source`, `onMismatch` and `prefer` to probe evidence.
 *
 * @remarks
 * Which copy runs: an explicit `source` of `"global"` or `"local"` decides;
 * otherwise, when both exist and disagree on the version, `onMismatch`
 * decides; otherwise, when both exist, `prefer` decides (omitted is
 * `"local"`); otherwise whichever exists.
 */
export const decideResolution = (tool: Tool, evidence: Evidence): ResolutionDecision => {
	const searched: ReadonlyArray<"global" | "local"> =
		tool.source === "any" || tool.source === "both" ? ["global", "local"] : [tool.source];

	const satisfied =
		tool.source === "any"
			? evidence.global.found || evidence.local.found
			: tool.source === "both"
				? evidence.global.found && evidence.local.found
				: tool.source === "global"
					? evidence.global.found
					: evidence.local.found;
	if (!satisfied) return { _tag: "NotFound", searched };

	const bothFound = evidence.global.found && evidence.local.found;
	const mismatch =
		bothFound &&
		Option.isSome(evidence.global.version) &&
		Option.isSome(evidence.local.version) &&
		evidence.global.version.value !== evidence.local.version.value;

	if (mismatch && tool.onMismatch === "fail") {
		return {
			_tag: "Mismatch",
			globalVersion: Option.getOrElse(evidence.global.version, () => ""),
			localVersion: Option.getOrElse(evidence.local.version, () => ""),
		};
	}

	const source: "global" | "local" =
		tool.source === "global" || tool.source === "local"
			? tool.source
			: mismatch
				? tool.onMismatch === "preferGlobal"
					? "global"
					: "local"
				: bothFound
					? (tool.prefer ?? "local")
					: evidence.local.found
						? "local"
						: "global";

	return {
		_tag: "Resolved",
		source,
		version: source === "local" ? evidence.local.version : evidence.global.version,
		mismatch,
		context: source === "local" ? Option.getOrUndefined(evidence.context) : undefined,
	};
};
