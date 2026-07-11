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
import { MAX_ENUMERATION_DEPTH, MAX_ENUMERATION_ENTRIES, PRUNED_DIRECTORIES } from "./internal/limits.js";
import { manifestPatternsOf, pnpmPatternsOf } from "./internal/patterns.js";
import { PublishConfig, WorkspacePackage } from "./WorkspacePackage.js";

/** Read and JSON-parse a file, or `undefined`. Never throws. */
const readJson = (file: string): Record<string, unknown> | undefined => {
	try {
		return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
	} catch {
		return undefined;
	}
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
 * Every workspace package under `root`, root package first.
 *
 * @remarks
 * **Synchronous and Node-only.** The Effect surface is `WorkspaceDiscovery`.
 *
 * Pattern semantics are shared with the async enumerator, right down to the
 * bounded descent for segment-crossing patterns — a `packages/**` finds a
 * package two levels down here exactly as it does there.
 *
 * Unlike the Effect surface, this one is **total**: an unenumerable pattern or
 * an unreadable manifest is skipped, not raised. A function that cannot return
 * an error channel should not pretend to have one, and a Vitest config has
 * nowhere to put a failure anyway.
 *
 * @param root - The workspace root, from {@link findWorkspaceRootSync}.
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
export const getWorkspacePackagesSync = (root: string): ReadonlyArray<WorkspacePackage> => {
	const patterns = readPatternsSync(root);

	// The same GlobSet the async enumerator compiles. An uncompilable set yields
	// no members rather than throwing — see the totality note above.
	const compiled = Effect.runSyncExit(GlobSet.compile(patterns));
	if (Exit.isFailure(compiled)) return [];
	const globs = compiled.value;

	const included = new Map<string, string>();
	let visited = 0;

	for (const literal of globs.literals) {
		const absolute = join(root, literal);
		if (isPackage(absolute)) included.set(literal, absolute);
	}

	for (const wildcard of globs.wildcards) {
		const base = wildcard.enumerationPrefix.replace(/\/$/, "");
		const absoluteBase = join(root, base);
		if (!isDirectory(absoluteBase)) continue;

		const queue: Array<{ readonly relative: string; readonly absolute: string; readonly depth: number }> = [
			{ relative: base, absolute: absoluteBase, depth: 0 },
		];

		while (queue.length > 0) {
			const current = queue.shift();
			/* v8 ignore next */
			if (current === undefined) break;
			if (++visited > MAX_ENUMERATION_ENTRIES) break;

			let entries: Array<string> = [];
			try {
				entries = readdirSync(current.absolute);
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (PRUNED_DIRECTORIES.has(entry)) continue;
				const relative = current.relative === "" ? entry : `${current.relative}/${entry}`;
				const absolute = join(current.absolute, entry);
				if (!isDirectory(absolute)) continue;
				if (wildcard.matches(relative) && isPackage(absolute)) included.set(relative, absolute);
				if (!wildcard.crossesSegments) continue;
				const depth = current.depth + 1;
				if (depth > MAX_ENUMERATION_DEPTH) continue;
				queue.push({ relative, absolute, depth });
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
