// The package-manager detection DECISION, shared by `PackageManagerDetector`
// (Effect) and `detectPackageManagerSync` (the sync facade).
//
// Pure over two inputs the callers gather with their own IO: the parsed root
// manifest and a presence predicate for the marker files. Keeping the priority
// order here, once, is what lets the two surfaces promise the same answer; the
// callers own only how a file is read and how a corrupt manifest is reported.
//
// Returns plain data rather than `DetectedPackageManager` so this module
// imports nothing from `PackageManagerName.ts`, which imports it.

import { PackageManager } from "@effected/package-json";
import { Option, Predicate, Schema } from "effect";

/** The marker FILES the decision may ask about, in the order it asks. */
export const MARKER_FILES = [
	"pnpm-workspace.yaml",
	"bun.lock",
	"bun.lockb",
	"yarn.lock",
	"pnpm-lock.yaml",
	"package-lock.json",
] as const;

/** One of {@link MARKER_FILES}. */
export type MarkerFile = (typeof MARKER_FILES)[number];

/** The four manager names, spelled locally to keep this module import-free of its caller. */
type ManagerName = "npm" | "pnpm" | "yarn" | "bun";

/** What a successful decision carries; the caller wraps it in `DetectedPackageManager`. */
export interface PackageManagerDecision {
	readonly name: ManagerName;
	readonly version: Option.Option<string>;
	readonly runtime: "node" | "bun";
	readonly evidence:
		| MarkerFile
		| "package.json#workspaces"
		| "package.json#devEngines.packageManager"
		| "package.json#packageManager";
}

/**
 * A manager named by one of the two manifest fields: the name, plus the exact
 * version when the field carries one that parses.
 */
interface ManagerHint {
	readonly name: string;
	readonly version: Option.Option<string>;
}

interface Hints {
	readonly devEngines: Option.Option<ManagerHint>;
	readonly corepack: Option.Option<ManagerHint>;
}

/**
 * The exact version a `name` + `version` pair denotes, or none when the version
 * is not an exact version.
 *
 * Reuses the corepack `name@version+integrity` grammar rather than a second
 * parser, so a `devEngines` version carrying a hash (`11.11.0+sha512.…`)
 * normalizes to the same `11.11.0` the
 * top-level field reports — and a *range* (`^11`, `11.x`) yields none, because a
 * range is not a version and corepack will not run one either.
 */
const exactVersionOf = (name: string, version: string): Option.Option<string> =>
	Schema.decodeUnknownOption(PackageManager.FromString)(`${name}@${version}`).pipe(Option.map((pm) => pm.version));

/**
 * The `devEngines.packageManager` hint, or none.
 *
 * Every malformed shape corepack itself tolerates is tolerated here by *ignoring
 * the field*, never by failing detection: a non-object `devEngines`, a
 * non-object `packageManager`, an **array** of them (corepack does not support
 * arrays in this slot and falls back), a missing or non-string `name`, and a
 * `name` containing `@`. A version that is not an exact version is dropped on its
 * own, keeping the name — the name is still a valid disambiguator.
 */
const devEnginesHint = (manifest: Record<string, unknown>): Option.Option<ManagerHint> => {
	const devEngines = manifest.devEngines;
	if (!Predicate.isObject(devEngines)) return Option.none();

	const slot = devEngines.packageManager;
	if (!Predicate.isObject(slot)) return Option.none();

	const name = slot.name;
	if (typeof name !== "string" || name === "" || name.includes("@")) return Option.none();

	const version = slot.version;
	return Option.some({
		name,
		version: typeof version === "string" && version !== "" ? exactVersionOf(name, version) : Option.none<string>(),
	});
};

/** The corepack top-level `packageManager` hint, or none when absent or malformed. */
const corepackHint = (manifest: Record<string, unknown>): Option.Option<ManagerHint> => {
	const raw = manifest.packageManager;
	if (typeof raw !== "string") return Option.none();
	return Schema.decodeUnknownOption(PackageManager.FromString)(raw).pipe(
		Option.map((pm) => ({ name: pm.name, version: Option.some(pm.version) })),
	);
};

/**
 * The manager name the manifest declares, if any.
 *
 * `devEngines` first — it is authoritative for the name, and corepack errors
 * when the top-level field contradicts it.
 */
const declaredName = (hints: Hints): Option.Option<string> =>
	Option.map(
		Option.orElse(hints.devEngines, () => hints.corepack),
		(hint) => hint.name,
	);

/** Whether the manifest declares `name` as its manager. */
const namesManager = (hints: Hints, name: ManagerName): boolean => Option.contains(declaredName(hints), name);

/**
 * The version to report for the manager that was detected — none unless a
 * field naming *that* manager carries one.
 *
 * The top-level `packageManager` wins when it names the manager, because it
 * is the field carrying the integrity hash; `devEngines` supplies the version
 * when it does not.
 */
const versionFor = (hints: Hints, name: ManagerName): Option.Option<string> => {
	if (!namesManager(hints, name)) return Option.none();
	const fromCorepack = Option.flatMap(hints.corepack, (hint) =>
		hint.name === name ? hint.version : Option.none<string>(),
	);
	return Option.orElse(fromCorepack, () =>
		Option.flatMap(hints.devEngines, (hint) => (hint.name === name ? hint.version : Option.none<string>())),
	);
};

/**
 * Decides which manager owns a root, or `undefined` when no evidence matches.
 *
 * @remarks
 * The priority order and its reasons are documented on
 * `PackageManagerDetector`; this is its single implementation. `has` is asked
 * about marker files only, so a caller may answer lazily (one `exists` per
 * question) or from a precomputed set.
 */
export const decidePackageManager = (
	manifest: Option.Option<Record<string, unknown>>,
	has: (file: MarkerFile) => boolean,
): PackageManagerDecision | undefined => {
	const hints: Hints = {
		devEngines: Option.flatMap(manifest, devEnginesHint),
		corepack: Option.flatMap(manifest, corepackHint),
	};
	const make = (name: ManagerName, evidence: PackageManagerDecision["evidence"]): PackageManagerDecision => ({
		name,
		version: versionFor(hints, name),
		runtime: name === "bun" ? "bun" : "node",
		evidence,
	});

	if (has("pnpm-workspace.yaml")) return make("pnpm", "pnpm-workspace.yaml");

	// Which bun lockfile is present, probed in priority order — the marker
	// itself is the evidence a success reports, so the OR is not collapsed
	// into a bare boolean.
	const bunLock: "bun.lock" | "bun.lockb" | undefined = has("bun.lock")
		? "bun.lock"
		: has("bun.lockb")
			? "bun.lockb"
			: undefined;
	if (bunLock !== undefined && namesManager(hints, "bun")) return make("bun", bunLock);

	if (has("yarn.lock") && namesManager(hints, "yarn")) return make("yarn", "yarn.lock");

	const workspaces = Option.map(manifest, (fields) => fields.workspaces);
	if (Option.isSome(workspaces) && workspaces.value !== undefined && workspaces.value !== null) {
		return make("npm", "package.json#workspaces");
	}

	// ── the standalone tier ────────────────────────────────────────────
	//
	// Every workspace marker has missed, so this is not a workspace. Most
	// repos are not: a single-package repo with a pnpm-lock.yaml and no
	// `workspaces` field must still be detectable.
	//
	// It runs after the workspace tier on purpose, so no input that
	// already resolved there can change its answer, and a stray package-lock.json
	// cannot turn a pnpm workspace into an npm repo.
	//
	// The conjunctions mirror the workspace tier exactly rather than
	// inventing a looser second rule: a pnpm or npm lockfile is written by
	// exactly one manager and stands alone, while a yarn or bun lockfile still
	// needs the manifest to name its manager, because a stray yarn.lock is as
	// common here as in a workspace. (The bun and yarn conjunctions repeat the
	// workspace tier's and so cannot newly match; they are kept so the tier
	// reads as the rule it states.)
	if (has("pnpm-lock.yaml")) return make("pnpm", "pnpm-lock.yaml");
	if (bunLock !== undefined && namesManager(hints, "bun")) return make("bun", bunLock);
	if (has("yarn.lock") && namesManager(hints, "yarn")) return make("yarn", "yarn.lock");
	if (has("package-lock.json")) return make("npm", "package-lock.json");

	// ── the declaration tier ───────────────────────────────────────────
	//
	// No lockfile at all. A fresh clone before its first install has none to
	// read, but its manifest still says plainly which manager is meant to
	// run — weaker evidence than a lockfile, which is why it is consulted
	// last, but evidence nonetheless.
	const declared = declaredName(hints);
	if (Option.isSome(declared)) {
		const name = declared.value;
		if (name === "pnpm" || name === "npm" || name === "yarn" || name === "bun") {
			// The field that supplied the name — `declaredName` believes
			// devEngines first, so the evidence mirrors that precedence.
			return make(
				name,
				Option.isSome(hints.devEngines) ? "package.json#devEngines.packageManager" : "package.json#packageManager",
			);
		}
	}

	// Nothing matched, and the decision REFUSES TO GUESS: a default is policy,
	// not detection.
	return undefined;
};
