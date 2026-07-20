// The synchronous escape hatch — over CONSUMER-SUPPLIED operations.
//
// Vitest's config-time project discovery cannot await, and it is the reason
// this module exists — a Vitest plugin building its project list has nowhere to
// run an Effect. The v3 README claimed "no node: imports leak into your code"
// while its own sync module imported node:fs from the main entry; this one
// imports NOTHING platform-shaped: the caller passes the file and path
// operations (`node:fs` / `node:path` satisfy them one-liner each), so the kit
// source never touches `node:*` and never assumes posix. Windows correctness is
// the consumer passing a win32-appropriate `path` (`node:path` on Windows, or
// `node:path/win32` explicitly) — the `TsconfigLoaderSync` convention.
//
// What it does NOT do is keep a third pattern semantic. v3's sync module
// hand-rolled its own YAML scrape and its own pattern expander (no `?` support,
// different negation) in defiance of glob-core's own anti-drift mandate. This
// compiles through the same `GlobSet` and walks the same worklist, so
// `packages/**` means the same thing in both worlds — the issue-#62 fix
// included.

import type { GlobPattern } from "@effected/glob";
import { GlobSet } from "@effected/glob";
import { Yaml } from "@effected/yaml";
import { Effect, Exit, Schema } from "effect";
import { MAX_ENUMERATION_DEPTH } from "./internal/limits.js";
import { manifestPatternsOf, pnpmPatternsOf } from "./internal/patterns.js";
import { Traversal, badMaxDepthMessage, isPruned, isValidMaxDepth, joinRelative } from "./internal/traverse.js";
import { PublishConfig, WorkspacePackage } from "./WorkspacePackage.js";

/**
 * The synchronous file operations the sync entry points need, supplied by the
 * consumer. Node's built-ins satisfy it directly:
 *
 * ```ts
 * import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
 *
 * const fileSystem: SyncFileSystem = {
 * 	exists: existsSync,
 * 	readFile: (p) => readFileSync(p, "utf8"),
 * 	readDirectory: (p) => readdirSync(p),
 * 	isDirectory: (p) => statSync(p).isDirectory(),
 * };
 * ```
 *
 * `exists` must return a boolean and not throw (Node's `existsSync` never
 * does). The other three may throw — `statSync` on a missing path, a
 * permission error mid-read — and every throw is absorbed into the documented
 * degraded-skip semantics: a throwing `readFile` reads as an unusable
 * manifest, a throwing `readDirectory` as an unreadable directory, a throwing
 * `isDirectory` as "not a directory". Nothing propagates.
 *
 * @public
 */
export interface SyncFileSystem {
	/** Whether a file or directory exists at `path`. Must not throw. */
	readonly exists: (path: string) => boolean;
	/** Read the file at `path` as text. May throw; a throw degrades to a skip. */
	readonly readFile: (path: string) => string;
	/** The entry names inside the directory at `path`. May throw; a throw skips the directory. */
	readonly readDirectory: (path: string) => ReadonlyArray<string>;
	/** Whether `path` is a directory. May throw; a throw reads as `false`. */
	readonly isDirectory: (path: string) => boolean;
}

/**
 * The synchronous path operations the sync entry points need, supplied by the
 * consumer. Deliberately a structural subset of `node:path`, so the built-in
 * module (and its `win32` / `posix` variants, or a Bun / Deno equivalent)
 * satisfies it verbatim:
 *
 * ```ts
 * import * as path from "node:path";
 *
 * const options: WorkspacesSyncOptions = {
 * 	fileSystem: { exists: existsSync, readFile: (p) => readFileSync(p, "utf8"), readDirectory: (p) => readdirSync(p), isDirectory: (p) => statSync(p).isDirectory() },
 * 	path, // node:path IS a SyncPath
 * };
 * ```
 *
 * These operations shape only the ABSOLUTE paths handed back to the consumer
 * (and to its own `fileSystem`); workspace-relative pattern matching is POSIX
 * by the `packages:` contract and never routes through here. Windows
 * correctness comes from supplying a win32-appropriate implementation, not
 * from anything in this module.
 *
 * @public
 */
export interface SyncPath {
	/** Join segments with the implementation's separator (like `path.join`). */
	readonly join: (...segments: ReadonlyArray<string>) => string;
	/** The directory portion of `p` (like `path.dirname`). */
	readonly dirname: (p: string) => string;
	/** Resolve segments to an absolute path (rightmost-wins, like `path.resolve`). */
	readonly resolve: (...segments: ReadonlyArray<string>) => string;
}

/**
 * The consumer-supplied operations backing one sync call: the file operations
 * and the path implementation. Both are required — this package never imports
 * `node:*` and never assumes posix, so the platform binding is entirely the
 * caller's.
 *
 * @public
 */
export interface WorkspacesSyncOptions {
	/** The synchronous file operations (Node: `existsSync` / `readFileSync` / `readdirSync` / `statSync`). */
	readonly fileSystem: SyncFileSystem;
	/** The synchronous path implementation (Node: the `node:path` module itself). */
	readonly path: SyncPath;
}

/**
 * Read and JSON-parse a file into a plain object, or `undefined`. Never throws.
 *
 * The non-object check is load-bearing, not defensive noise. `JSON.parse`
 * returns `undefined` for *nothing* — a `package.json` whose entire content is
 * `null`, `42` or `"x"` parses successfully to that value, so a caller guarding
 * only on `undefined` sails straight into `raw.name` and throws a `TypeError`.
 * These functions are documented as total and are reached from a Vitest config,
 * which has nowhere to put a crash: malformed input must be *skipped*, never a
 * defect. A throwing consumer `readFile` lands in the same catch as a JSON
 * syntax error — an unusable manifest either way.
 */
const readJson = (fileSystem: SyncFileSystem, file: string): Record<string, unknown> | undefined => {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fileSystem.readFile(file));
	} catch {
		return undefined;
	}
	return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
		? (parsed as Record<string, unknown>)
		: undefined;
};

/** Whether `dir` is a directory. Never throws — a throwing consumer op reads as `false`. */
const isDirectory = (fileSystem: SyncFileSystem, dir: string): boolean => {
	try {
		return fileSystem.isDirectory(dir);
	} catch {
		return false;
	}
};

/** Whether `dir` holds a `package.json`. */
const isPackage = (options: WorkspacesSyncOptions, dir: string): boolean =>
	options.fileSystem.exists(options.path.join(dir, "package.json"));

/**
 * The nearest workspace root at or above `cwd`, or `null`.
 *
 * @remarks
 * **Synchronous.** The Effect surface is `WorkspaceRoot`; reach for this one
 * only where you genuinely cannot run an Effect — a Vitest config being the
 * motivating case. The file and path operations are the caller's
 * ({@link WorkspacesSyncOptions}); this module imports no `node:*` and
 * assumes no posix.
 *
 * The signature is path-first, options second — the same shape as
 * {@link getWorkspacePackagesSync} and the rest of the kit's sync facades
 * (`TsconfigLoaderSync.load(configPath, options)`). `cwd` is required and
 * positional: the earlier options-bag form defaulted it to an ambient
 * `process.cwd()` read, which both broke the symmetry with its sibling and
 * was the module's one platform assumption.
 *
 * Markers match the async service exactly: a `pnpm-workspace.yaml`, or a
 * `package.json` carrying a `workspaces` field.
 *
 * @param cwd - Where to start the ascent (typically `process.cwd()`),
 *   matching the Effect layers' `{ cwd }` option.
 * @param options - The consumer-supplied file and path operations.
 *
 * @example
 * ```ts
 * import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
 * import * as path from "node:path";
 * import { findWorkspaceRootSync } from "@effected/workspaces";
 *
 * const root = findWorkspaceRootSync(process.cwd(), {
 * 	fileSystem: {
 * 		exists: existsSync,
 * 		readFile: (p) => readFileSync(p, "utf8"),
 * 		readDirectory: (p) => readdirSync(p),
 * 		isDirectory: (p) => statSync(p).isDirectory(),
 * 	},
 * 	path,
 * });
 * ```
 *
 * @public
 */
export const findWorkspaceRootSync = (cwd: string, options: WorkspacesSyncOptions): string | null => {
	const { fileSystem, path } = options;
	let current = path.resolve(cwd);
	// Bounded twice over: `dirname` is a fixpoint at the filesystem root, and the
	// depth cap guards a pathological path implementation that never reaches one.
	for (let depth = 0; depth < MAX_ENUMERATION_DEPTH * 8; depth++) {
		if (fileSystem.exists(path.join(current, "pnpm-workspace.yaml"))) return current;
		const manifest = readJson(fileSystem, path.join(current, "package.json"));
		if (manifest?.workspaces !== undefined && manifest.workspaces !== null) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
};

/** The workspace `packages:` patterns for `root`, matching `internal/patterns.ts`'s precedence. */
const readPatternsSync = (options: WorkspacesSyncOptions, root: string): ReadonlyArray<string> => {
	const { fileSystem, path } = options;
	const workspaceYaml = path.join(root, "pnpm-workspace.yaml");
	if (fileSystem.exists(workspaceYaml)) {
		let text = "";
		try {
			text = fileSystem.readFile(workspaceYaml);
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
	return manifestPatternsOf(readJson(fileSystem, path.join(root, "package.json")) ?? {});
};

/** Build a `WorkspacePackage` from a directory, or `null` if its manifest is unusable. */
const readPackageSync = (
	options: WorkspacesSyncOptions,
	root: string,
	directory: string,
	relativePath: string,
): WorkspacePackage | null => {
	const packageJsonPath = options.path.join(directory, "package.json");
	const raw = readJson(options.fileSystem, packageJsonPath);
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
		// Carried exactly as the Effect enumerator carries it — the two entry
		// points must not disagree about what a discovered package knows.
		workspaceRoot: root,
		private: raw.private === true,
		dependencies: stringRecord(raw.dependencies) ?? {},
		devDependencies: stringRecord(raw.devDependencies) ?? {},
		peerDependencies: stringRecord(raw.peerDependencies) ?? {},
		optionalDependencies: stringRecord(raw.optionalDependencies) ?? {},
		// The as-read record rides along, exactly as the Effect enumerator's
		// projection does — one read, tolerant access to the rest of the manifest.
		manifestRecord: raw,
		...(config !== undefined && Exit.isSuccess(config) ? { publishConfig: config.value } : {}),
	});
};

/**
 * Options for {@link getWorkspacePackagesSync}: the required consumer-supplied
 * operations plus the traversal bound.
 *
 * @public
 */
export interface GetWorkspacePackagesSyncOptions extends WorkspacesSyncOptions {
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
 * **Synchronous.** The Effect surface is `WorkspaceDiscovery`. The file and
 * path operations are the caller's ({@link GetWorkspacePackagesSyncOptions}
 * extends {@link WorkspacesSyncOptions}); this module imports no `node:*` and
 * assumes no posix.
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
 * @param options - The consumer-supplied operations and traversal bounds; see
 *   {@link GetWorkspacePackagesSyncOptions}.
 *
 * @example
 * ```ts
 * import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
 * import * as path from "node:path";
 * import { findWorkspaceRootSync, getWorkspacePackagesSync } from "@effected/workspaces";
 *
 * const ops = {
 * 	fileSystem: {
 * 		exists: existsSync,
 * 		readFile: (p: string) => readFileSync(p, "utf8"),
 * 		readDirectory: (p: string) => readdirSync(p),
 * 		isDirectory: (p: string) => statSync(p).isDirectory(),
 * 	},
 * 	path,
 * };
 * const root = findWorkspaceRootSync(process.cwd(), ops);
 * const packages = root === null ? [] : getWorkspacePackagesSync(root, ops);
 * ```
 *
 * @public
 */
export const getWorkspacePackagesSync = (
	root: string,
	options: GetWorkspacePackagesSyncOptions,
): ReadonlyArray<WorkspacePackage> => {
	const { fileSystem, path } = options;
	const maxDepth = options.maxDepth ?? MAX_ENUMERATION_DEPTH;
	// A bad bound is a PROGRAMMER error, not a data condition. This function is
	// total over *data*, not over caller mistakes — so it throws here, mirroring
	// the enumerator's `Effect.die`. Same predicate, same message, one rule.
	if (!isValidMaxDepth(maxDepth)) {
		throw new RangeError(`getWorkspacePackagesSync: ${badMaxDepthMessage(maxDepth)}`);
	}

	const patterns = readPatternsSync(options, root);

	// The same GlobSet the async enumerator compiles. An uncompilable set yields
	// no members rather than throwing — see the totality note above.
	const compiled = Effect.runSyncExit(GlobSet.compile(patterns));
	if (Exit.isFailure(compiled)) return [];
	const globs = compiled.value;

	const included = new Map<string, string>();

	for (const literal of globs.literals) {
		const absolute = path.join(root, literal);
		if (isPackage(options, absolute)) included.set(literal, absolute);
	}

	for (const wildcard of globs.wildcards) {
		const base = wildcard.enumerationPrefix.replace(/\/$/, "");
		const absoluteBase = path.join(root, base);
		if (!isDirectory(fileSystem, absoluteBase)) continue;

		// THE shared traversal — the same state machine `internal/enumerate.ts`
		// drives. The ONLY difference between the two entry points is what happens
		// to a `TraversalStop`: the Effect path fails typed, this one truncates,
		// because a Vitest config has nowhere to put an error. Depth, budget,
		// prune and dequeue are not re-decided here.
		const traversal = new Traversal(base, absoluteBase, maxDepth);

		let stopped = false;
		for (let current = traversal.next(); current !== undefined && !stopped; current = traversal.next()) {
			if (traversal.charge() !== undefined) break;

			let entries: ReadonlyArray<string> = [];
			try {
				entries = fileSystem.readDirectory(current.absolute);
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (isPruned(entry)) continue;
				const relative = joinRelative(current.relative, entry);
				const absolute = path.join(current.absolute, entry);
				if (!isDirectory(fileSystem, absolute)) continue;

				// Depth BEFORE acceptance, exactly as the Effect enumerator does it.
				// Gating only the descent is what made this function return a package
				// one level beyond the cap that the Effect API rejected on the same
				// tree — the drift that motivated the shared traversal.
				if (wildcard.crossesSegments && !traversal.admits(current)) {
					stopped = true;
					break;
				}

				if (wildcard.matches(relative) && isPackage(options, absolute)) included.set(relative, absolute);
				if (!wildcard.crossesSegments) continue;

				traversal.push(current, relative, absolute);
			}
		}
	}

	const members: Array<WorkspacePackage> = [];
	for (const [relativePath, absolute] of [...included.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		if (relativePath === "." || absolute === root) continue;
		if (globs.excludes.some((exclude: GlobPattern) => exclude.matches(relativePath))) continue;
		const pkg = readPackageSync(options, root, absolute, relativePath);
		if (pkg !== null) members.push(pkg);
	}

	const rootPackage = readPackageSync(options, root, root, ".");
	return rootPackage === null ? members : [rootPackage, ...members];
};
