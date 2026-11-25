/**
 * Which packages the Full Tests workflow runs at full depth (#1415).
 *
 * @remarks
 * Prints `--project <name>` flags for `pnpm run ci:test:full`, space-separated on one line, or nothing.
 *
 * - `--changed-against <ref>`: the packages `git diff <ref>...HEAD` touches, plus every package that depends on one,
 *   kept when they have depth-aware tests. On the release pull request that diff is version bumps and changelogs,
 *   so a touched package is a package in the release.
 * - `--packages "a,b"`: the named packages, refusing a name that is unknown or has no depth-aware tests. An empty
 *   list means every package with depth-aware tests.
 * - `--all`: every package with depth-aware tests.
 */
import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isDepthAware } from "./test-tiers.js";

/** What the selection needs to know about one workspace package. */
export interface PackageFacts {
	readonly name: string;
	/** Repo-relative directory, such as `packages/markdown`. */
	readonly dir: string;
	/** Names from `dependencies`, `peerDependencies` and `optionalDependencies`. */
	readonly dependsOn: ReadonlyArray<string>;
	readonly hasDepthAwareTests: boolean;
}

/**
 * The packages `changedPaths` touch plus their transitive dependents, kept when depth-aware, sorted by name.
 *
 * @remarks
 * A dependent is included because a release of the parser can break the parity of the linter built on it.
 */
export const affectedProjects = (
	packages: ReadonlyArray<PackageFacts>,
	changedPaths: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const affected = new Set<string>();
	for (const each of packages) {
		// The trailing slash keeps `packages/markdown-lint/...` from counting as a change to `packages/markdown`.
		if (changedPaths.some((path) => path.startsWith(`${each.dir}/`))) affected.add(each.name);
	}
	for (let grew = true; grew; ) {
		grew = false;
		for (const each of packages) {
			if (affected.has(each.name)) continue;
			if (each.dependsOn.some((name) => affected.has(name))) {
				affected.add(each.name);
				grew = true;
			}
		}
	}
	return packages
		.filter((each) => each.hasDepthAwareTests && affected.has(each.name))
		.map((each) => each.name)
		.sort();
};

/**
 * Every depth-aware package when `requested` is empty, and otherwise the packages it names, sorted.
 *
 * @throws When a name is not a workspace package, or names one with no depth-aware tests: a run that was asked for
 *   and would test nothing must fail, not pass.
 */
export const requestedProjects = (
	packages: ReadonlyArray<PackageFacts>,
	requested: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	if (requested.length === 0) {
		return packages
			.filter((each) => each.hasDepthAwareTests)
			.map((each) => each.name)
			.sort();
	}
	const byName = new Map(packages.map((each) => [each.name, each]));
	const unknown = requested.filter((name) => !byName.has(name));
	if (unknown.length > 0) throw new Error(`not a workspace package: ${unknown.join(", ")}`);
	const empty = requested.filter((name) => byName.get(name)?.hasDepthAwareTests !== true);
	if (empty.length > 0) {
		throw new Error(
			`no depth-aware tests (.parity, .corpus or .property test files) in: ${empty.join(", ")}; nothing would run`,
		);
	}
	return [...new Set(requested)].sort();
};

/** One `--project` flag per name, space-separated, or the empty string. */
export const projectFlags = (names: ReadonlyArray<string>): string =>
	names.map((name) => `--project ${name}`).join(" ");

interface Manifest {
	readonly name?: string;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** The facts of every package under `packages/`, read from disk. */
const readPackages = (root: string): ReadonlyArray<PackageFacts> =>
	readdirSync(join(root, "packages"))
		.sort()
		.flatMap((entry) => {
			const dir = `packages/${entry}`;
			const manifestPath = join(root, dir, "package.json");
			if (!existsSync(manifestPath)) return [];
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
			if (manifest.name === undefined) return [];
			return [
				{
					name: manifest.name,
					dir,
					dependsOn: [
						...Object.keys(manifest.dependencies ?? {}),
						...Object.keys(manifest.peerDependencies ?? {}),
						...Object.keys(manifest.optionalDependencies ?? {}),
					],
					hasDepthAwareTests: globSync("__test__/**/*.test.{ts,tsx}", { cwd: join(root, dir) }).some(isDepthAware),
				},
			];
		});

const main = (): void => {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
	const { values: flags } = parseArgs({
		options: {
			"changed-against": { type: "string" },
			packages: { type: "string" },
			all: { type: "boolean", default: false },
		},
	});
	const packages = readPackages(root);
	const ref = flags["changed-against"];
	const given = [ref !== undefined, flags.packages !== undefined, flags.all].filter(Boolean).length;
	if (given !== 1) throw new Error("pass exactly one of --changed-against <ref>, --packages <a,b> or --all");
	let names: ReadonlyArray<string>;
	if (ref !== undefined) {
		const changed = execFileSync("git", ["diff", "--name-only", `${ref}...HEAD`], { cwd: root, encoding: "utf8" })
			.split("\n")
			.filter((line) => line !== "");
		names = affectedProjects(packages, changed);
	} else {
		const requested = (flags.packages ?? "")
			.split(",")
			.map((name) => name.trim())
			.filter((name) => name !== "");
		names = requestedProjects(packages, requested);
	}
	process.stdout.write(`${projectFlags(names)}\n`);
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
	try {
		main();
	} catch (error) {
		process.stderr.write(`full-test-projects: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}
