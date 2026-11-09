import { posix } from "node:path";
import { GlobPattern } from "@effected/glob";
import { Range, SemVer } from "@effected/semver";
import type { WorkspacePackage } from "@effected/workspaces";
import { Result } from "effect";
import type { BumpType, ReleaseType } from "../BumpType.js";

/**
 * Version and range helpers the planner and the release edits share, each
 * reading a version or range as node-semver does.
 *
 * @internal
 */

export const DEPENDENCY_KINDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

/**
 * A package version as node-semver reads one without `loose`: surrounding
 * whitespace and a single leading `v` are dropped, so `v1.0.0` is `1.0.0`. Any
 * other prefix, `=1.2.0` among them, stays and fails to parse.
 */
export const cleanVersion = (version: string): string => {
	const trimmed = version.trim();
	return trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
};

export const WORKSPACE = /^workspace:/;

/** A range, also as node-semver reads a `v` before a version in one: `^v1.0.0` is `^1.0.0`. */
export const parseRange = (specifier: string): Range | undefined => {
	if (specifier.includes(":")) return undefined;
	const parsed = Range.parseResult(specifier);
	if (Result.isSuccess(parsed)) return parsed.success;
	return Result.getOrUndefined(Range.parseResult(specifier.replace(/(^|[\s^~<>=])v(?=\d)/g, "$1")));
};

export const satisfies = (version: string, specifier: string): boolean => {
	const range = parseRange(specifier);
	const parsed = Result.getOrUndefined(SemVer.parseResult(cleanVersion(version)));
	return range !== undefined && parsed !== undefined && Range.satisfies(parsed, range);
};

/**
 * `semver.inc`'s rule, which `SemVerBump` deliberately does not follow: a bump
 * a prerelease is already heading for completes it rather than incrementing.
 */
export const increment = (version: SemVer, type: BumpType): SemVer => {
	const completes =
		version.prerelease.length > 0 &&
		(type === "patch" || (version.patch === 0 && (type === "minor" || version.minor === 0)));
	return completes ? SemVer.truncate(version, "prerelease") : version.bump[type]();
};

/** The workspace's names a list of globs selects, `!` negation applying in order, in workspace order. */
export const matchNames = (
	packages: ReadonlyArray<WorkspacePackage>,
	patterns: ReadonlyArray<string>,
): ReadonlyArray<string> => {
	const matchers = patterns.map((source) => {
		const negated = source.startsWith("!");
		const glob = negated ? source.slice(1) : source;
		const compiled = Result.getOrUndefined(GlobPattern.compileResult(glob));
		return { negated, matches: (name: string) => compiled?.matches(name) ?? name === glob };
	});
	const selected: Array<string> = [];
	for (const { name } of packages) {
		let passed = false;
		for (const { negated, matches } of matchers) {
			if (!passed && !negated && matches(name)) passed = true;
			else if (passed && negated && matches(name)) passed = false;
		}
		if (passed) selected.push(name);
	}
	return selected;
};

const BUMP_LEVEL: Record<ReleaseType, number> = { none: 0, patch: 1, minor: 2, major: 3 };

/**
 * `apply-release-plan`'s `shouldUpdateDependencyBasedOnConfig`: whether a
 * dependent's specifier on `release` is one `changeset version` updates. A
 * `workspace:` path answers whether it points at the dependency
 * (`dependencyPath`, relative to the workspace root); the edits never rewrite
 * one whatever the answer, but the changelog's dependency lines read it.
 */
export const shouldUpdate = (
	release: { readonly type: ReleaseType; readonly oldVersion: string; readonly newVersion: string },
	specifier: string,
	kind: DependencyKind,
	options: { readonly minimum: "patch" | "minor"; readonly onlyPeersOutOfRange: boolean },
	dependencyPath: string,
): boolean => {
	let range = specifier;
	if (WORKSPACE.test(range)) {
		range = range.replace(WORKSPACE, "");
		if (range === "*") return true;
		if (range === "^" || range === "~") range = `${range}${release.oldVersion}`;
		else if (parseRange(range) === undefined) return posix.normalize(range) === dependencyPath;
	}
	if (!satisfies(release.newVersion, range)) return true;
	if (kind === "peerDependencies") return !options.onlyPeersOutOfRange;
	return BUMP_LEVEL[release.type] >= BUMP_LEVEL[options.minimum];
};
