// The synchronous escape hatch. Node-only, and labelled as such.
//
// Vitest's config-time project discovery cannot await, and it is the reason
// this module exists — a Vitest plugin building its project list has nowhere to
// run an Effect. The v3 README claimed "no node: imports leak into your code"
// while its own sync module imported node:fs from the main entry; this one says
// what it is instead.
//
// What it does NOT do is keep a third pattern semantic. v3's sync module
// hand-rolled its own YAML scrape and its own pattern expander (no `?` support,
// different negation) in defiance of glob-core's own anti-drift mandate. This
// compiles through the same `GlobSet` and walks the same worklist, so
// `packages/**` means the same thing in both worlds — the issue-#62 fix
// included.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { GlobPattern } from "@effected/glob";
import { GlobSet } from "@effected/glob";
import { Yaml } from "@effected/yaml";
import { Effect, Exit, Schema } from "effect";
import { MAX_ENUMERATION_DEPTH } from "./internal/limits.js";
import { manifestPatternsOf, pnpmPatternsOf } from "./internal/patterns.js";
import { Traversal, badMaxDepthMessage, isPruned, isValidMaxDepth, joinRelative } from "./internal/traverse.js";
import { PublishConfig, WorkspacePackage } from "./WorkspacePackage.js";

/**
 * Read and JSON-parse a file into a plain object, or `undefined`. Never throws.
 *
 * The non-object check is load-bearing, not defensive noise. `JSON.parse`
 * returns `undefined` for *nothing* — a `package.json` whose entire content is
 * `null`, `42` or `"x"` parses successfully to that value, so a caller guarding
 * only on `undefined` sails straight into `raw.name` and throws a `TypeError`.
 * These functions are documented as total and are reached from a Vitest config,
 * which has nowhere to put a crash: malformed input must be *skipped*, never a
 * defect.
 */
const readJson = (file: string): Record<string, unknown> | undefined => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: undefined;
};

/** Whether `dir` is a directory. Never throws. */
const isDirectory = (dir: string): boolean => {
	try {
		return statSync(dir).isDirectory();
	} catch {
		return false;
	}
};

/** Whether `dir` holds a `package.json`. */
const isPackage = (dir: string): boolean => existsSync(join(dir, "package.json"));

/**
 * The nearest workspace root at or above `cwd`, or `null`.
 *
 * @remarks
 * **Synchronous and Node-only.** The Effect surface is `WorkspaceRoot`; reach
 * for this one only where you genuinely cannot run an Effect — a Vitest config
 * being the motivating case.
 *
 * Markers match the async service exactly: a `pnpm-workspace.yaml`, or a
 * `package.json` carrying a `workspaces` field.
 *
 * @param cwd - Where to start the ascent. Defaults to `process.cwd()`.
 *
 * @example
 * ```ts
 * import { findWorkspaceRootSync } from "@effected/workspaces";
 *
 * const root = findWorkspaceRootSync();
 * ```
 *
 * @public
 */
export const findWorkspaceRootSync = (cwd?: string): string | null => {
	let current = resolve(cwd ?? process.cwd());
	// Bounded twice over: `dirname` is a fixpoint at the filesystem root, and the
	// depth cap guards a pathological path implementation that never reaches one.
	for (let depth = 0; depth < MAX_ENUMERATION_DEPTH * 8; depth++) {
		if (existsSync(join(current, "pnpm-workspace.yaml"))) return current;
		const manifest = readJson(join(current, "package.json"));
		if (manifest?.workspaces !== undefined && manifest.workspaces !== null) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
};

/** The workspace `packages:` patterns for `root`, matching `internal/patterns.ts`'s precedence. */
const readPatternsSync = (root: string): ReadonlyArray<string> => {
	const workspaceYaml = join(root, "pnpm-workspace.yaml");
	if (existsSync(workspaceYaml)) {
		let text = "";
		try {
			text = readFileSync(workspaceYaml, "utf8");
		} catch {
			text = "";
		}
		// `Yaml.parse` is an Effect and this function is not; the parse is pure and
		// synchronous underneath, so running it to an Exit here is the one honest
		// bridge. A parse failure is an empty pattern list, not a throw.
		const exit = Effect.runSyncExit(Yaml.parse(text));
		if (Exit.isSuccess(exit)) {
			const patterns = pnpmPatternsOf(exit.value);
			if (patterns.length > 0) return patterns;
		}
	}
	return manifestPatternsOf(readJson(join(root, "package.json")) ?? {});
};

/** Build a `WorkspacePackage` from a directory, or `null` if its manifest is unusable. */
const readPackageSync = (directory: string, relativePath: string): WorkspacePackage | null => {
	const packageJsonPath = join(directory, "package.json");
	const raw = readJson(packageJsonPath);
	if (raw === undefined) return null;

	const name = raw.name;
	const version = raw.version;
	if (typeof name !== "string" || name.length === 0) return null;
	if (typeof version !== "string" || version.length === 0) return null;

	const stringRecord = (value: unknown): Record<string, string> | undefined =>
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string")
			? (value as Record<string, string>)
			: undefined;

	const publishConfig = raw.publishConfig;
	const config =
		publishConfig !== null && typeof publishConfig === "object"
			? Effect.runSyncExit(Schema.decodeUnknownEffect(PublishConfig)(publishConfig))
			: undefined;

	return WorkspacePackage.make({
		name,
		version,
		path: directory,
		packageJsonPath,
		relativePath,
		private: raw.private === true,
		dependencies: stringRecord(raw.dependencies) ?? {},
		devDependencies: stringRecord(raw.devDependencies) ?? {},
		peerDependencies: stringRecord(raw.peerDependencies) ?? {},
		optionalDependencies: stringRecord(raw.optionalDependencies) ?? {},
		...(config !== undefined && Exit.isSuccess(config) ? { publishConfig: config.value } : {}),
	});
};

/**
 * Options for {@link getWorkspacePackagesSync}.
 *
 * @public
 */
export interface GetWorkspacePackagesSyncOptions {
	/**
	 * Descent cap below a wildcard's enumeration prefix, mirroring
	 * `WorkspaceDiscovery.layer({ maxDepth })`.
	 *
	 * @defaultValue 32
	 */
	readonly maxDepth?: number;
}

/**
 * Every workspace package under `root`, root package first.
 *
 * @remarks
 * **Synchronous and Node-only.** The Effect surface is `WorkspaceDiscovery`.
 *
 * Pattern semantics are not merely "shared" with the Effect enumerator — both
 * drive the **same traversal state machine** (`internal/traverse.ts`), so the
 * dequeue order, the depth rule, the visit budget and the prune list cannot
 * drift apart. A `packages/**` finds exactly the same packages here as there,
 * including at the depth boundary.
 *
 * The one deliberate difference is what happens at a bound: the Effect surface
 * fails typed (`depthExceeded` / `budgetExceeded`), while this one is **total**
 * and truncates. An unenumerable pattern or an unreadable manifest is skipped,
 * not raised — a function with no error channel should not pretend to have one,
 * and a Vitest config has nowhere to put a failure. Totality covers *data*, not
 * caller mistakes: a `maxDepth` that is not a positive integer throws, matching
 * the enumerator's defect.
 *
 * @param root - The workspace root, from {@link findWorkspaceRootSync}.
 * @param options - Traversal bounds; see {@link GetWorkspacePackagesSyncOptions}.
 *
 * @example
 * ```ts
 * import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
 *
 * const root = findWorkspaceRootSync();
 * const packages = root === null ? [] : getWorkspacePackagesSync(root);
 * ```
 *
 * @public
 */
export const getWorkspacePackagesSync = (
	root: string,
	options?: GetWorkspacePackagesSyncOptions,
): ReadonlyArray<WorkspacePackage> => {
	const maxDepth = options?.maxDepth ?? MAX_ENUMERATION_DEPTH;
	// A bad bound is a PROGRAMMER error, not a data condition. This function is
	// total over *data*, not over caller mistakes — so it throws here, mirroring
	// the enumerator's `Effect.die`. Same predicate, same message, one rule.
	if (!isValidMaxDepth(maxDepth)) {
		throw new RangeError(`getWorkspacePackagesSync: ${badMaxDepthMessage(maxDepth)}`);
	}

	const patterns = readPatternsSync(root);

	// The same GlobSet the async enumerator compiles. An uncompilable set yields
	// no members rather than throwing — see the totality note above.
	const compiled = Effect.runSyncExit(GlobSet.compile(patterns));
	if (Exit.isFailure(compiled)) return [];
	const globs = compiled.value;

	const included = new Map<string, string>();

	for (const literal of globs.literals) {
		const absolute = join(root, literal);
		if (isPackage(absolute)) included.set(literal, absolute);
	}

	for (const wildcard of globs.wildcards) {
		const base = wildcard.enumerationPrefix.replace(/\/$/, "");
		const absoluteBase = join(root, base);
		if (!isDirectory(absoluteBase)) continue;

		// THE shared traversal — the same state machine `internal/enumerate.ts`
		// drives. The ONLY difference between the two entry points is what happens
		// to a `TraversalStop`: the Effect path fails typed, this one truncates,
		// because a Vitest config has nowhere to put an error. Depth, budget,
		// prune and dequeue are not re-decided here.
		const traversal = new Traversal(base, absoluteBase, maxDepth);

		let stopped = false;
		for (let current = traversal.next(); current !== undefined && !stopped; current = traversal.next()) {
			if (traversal.charge() !== undefined) break;

			let entries: Array<string> = [];
			try {
				entries = readdirSync(current.absolute);
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (isPruned(entry)) continue;
				const relative = joinRelative(current.relative, entry);
				const absolute = join(current.absolute, entry);
				if (!isDirectory(absolute)) continue;

				// Depth BEFORE acceptance, exactly as the Effect enumerator does it.
				// Gating only the descent is what made this function return a package
				// one level beyond the cap that the Effect API rejected on the same
				// tree — the drift that motivated the shared traversal.
				if (wildcard.crossesSegments && !traversal.admits(current)) {
					stopped = true;
					break;
				}

				if (wildcard.matches(relative) && isPackage(absolute)) included.set(relative, absolute);
				if (!wildcard.crossesSegments) continue;

				traversal.push(current, relative, absolute);
			}
		}
	}

	const members: Array<WorkspacePackage> = [];
	for (const [relativePath, absolute] of [...included.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		if (relativePath === "." || absolute === root) continue;
		if (globs.excludes.some((exclude: GlobPattern) => exclude.matches(relativePath))) continue;
		const pkg = readPackageSync(absolute, relativePath);
		if (pkg !== null) members.push(pkg);
	}

	const rootPackage = readPackageSync(root, ".");
	return rootPackage === null ? members : [rootPackage, ...members];
};
