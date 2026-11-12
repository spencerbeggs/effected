// Which directories a workspace's patterns declare as members — THE decision
// `WorkspaceDiscovery`, `WorkspacesSync` and `WorkspaceSnapshots` share, so the
// three cannot disagree about a root (#1329).
//
// pnpm, yarn and bun roots read their patterns with `GlobSet` set semantics.
// An npm root reads its `package.json#workspaces` the way npm itself does,
// through `@effected/npm`'s `NpmWorkspacePatterns` (`@npmcli/map-workspaces`'
// rules): ordered negation, a trailing `/`, an even run of `!`, a backslash as
// a separator. The two disagree on real fields, and npm's answer is what npm
// installs and records.
//
// A membership is two things. `candidates` is the `GlobSet` an enumerator
// walks — for npm, the field's positive patterns normalized the way npm reads
// them, with no exclusions, so it is a superset of the members. `matches` is
// the whole decision for one root-relative directory, applied to every
// candidate (and, at a git ref, to every directory `ls-tree` lists).

import type { GlobPatternError } from "@effected/glob";
import { GlobSet } from "@effected/glob";
import type { NpmWorkspacePatternsError } from "@effected/npm";
import { NpmWorkspacePatterns } from "@effected/npm";
import { Option, Result } from "effect";
import type { MarkerFile } from "./packageManagerDecision.js";
import { decidePackageManager } from "./packageManagerDecision.js";

/** The directories a root's patterns declare: what to enumerate, and what to keep. */
export interface Membership {
	/** The set an enumerator walks: its literals and wildcards bound the descent. */
	readonly candidates: GlobSet;
	/** Whether a root-relative POSIX directory is a member. The whole decision. */
	readonly matches: (relative: string) => boolean;
}

/**
 * Why the patterns yield no membership: the pattern the reader stopped at
 * (verbatim, or `package.json#workspaces` for an npm ceiling no one pattern
 * passed), a one-line detail, and the originating typed error.
 */
export interface MembershipFailure {
	readonly pattern: string;
	readonly detail: string;
	readonly cause: GlobPatternError | NpmWorkspacePatternsError;
}

/** How the patterns are read: as a `GlobSet`, or as npm reads a `workspaces` field. */
export type MembershipRules = { readonly _tag: "glob" } | { readonly _tag: "npm"; readonly field: unknown };

/** The rules for a root that is not npm's. */
export const GLOB_RULES: MembershipRules = { _tag: "glob" };

/**
 * The rules a root's patterns are read under.
 *
 * `manifest` is the root `package.json` when it is the pattern source — none
 * when `pnpm-workspace.yaml` supplied the patterns. The manager is decided the
 * way `PackageManagerDetector` decides it, over the same `has` the caller
 * answers with its own IO, so "npm root" here and there are one answer.
 */
export const rulesFor = (
	manifest: Option.Option<Record<string, unknown>>,
	has: (file: MarkerFile) => boolean,
): MembershipRules => {
	if (Option.isNone(manifest)) return GLOB_RULES;
	const decision = decidePackageManager(manifest, has);
	return decision?.name === "npm" ? { _tag: "npm", field: manifest.value.workspaces } : GLOB_RULES;
};

/**
 * A positive npm pattern as npm reads it, as a `GlobSet` include, or
 * `undefined` for a negation or an empty pattern: an even `!` run dropped, one
 * leading `./` or `/` run stripped, backslashes turned to `/`, and a trailing
 * `/.` run and `/` dropped (npm matches directories, so `packages/*\/` is
 * `packages/*`).
 */
const npmCandidateOf = (entry: string): string | undefined => {
	const bangs = /^!+/.exec(entry)?.[0].length ?? 0;
	if (bangs % 2 === 1) return undefined;
	let pattern = entry
		.slice(bangs)
		.replace(/^\.?\/+/, "")
		.replace(/\\/g, "/");
	// A trailing run of `/.` and `/` — linear, from the end, on untrusted input.
	let end = pattern.length;
	for (;;) {
		if (end >= 1 && pattern.charCodeAt(end - 1) === 47) end -= 1;
		else if (end >= 2 && pattern.charCodeAt(end - 1) === 46 && pattern.charCodeAt(end - 2) === 47) end -= 2;
		else break;
	}
	pattern = pattern.slice(0, end);
	return pattern === "" ? undefined : pattern;
};

/** The `GlobSet` compile failure, materialized. */
const globFailure = (error: GlobPatternError): MembershipFailure => ({
	pattern: error.pattern,
	detail: error.message,
	cause: error,
});

/**
 * The membership `patterns` declare under `rules`, or the failure that stops
 * them being read. There is no fallback reading: an npm field past one of
 * `NpmWorkspacePatterns`' ceilings fails rather than being read as a `GlobSet`,
 * which would silently decide members by other rules.
 */
export const membershipOf = (
	patterns: ReadonlyArray<string>,
	rules: MembershipRules,
): Result.Result<Membership, MembershipFailure> => {
	if (rules._tag === "glob") {
		const compiled = GlobSet.compileResult(patterns);
		if (Result.isFailure(compiled)) return Result.fail(globFailure(compiled.failure));
		const globs = compiled.success;
		return Result.succeed({ candidates: globs, matches: (relative) => globs.matches(relative) });
	}

	const matcher = NpmWorkspacePatterns.matcherResult(rules.field);
	if (Result.isFailure(matcher)) {
		const error = matcher.failure;
		const at = error.index === undefined ? undefined : declaredAt(rules.field, error.index);
		return Result.fail({ pattern: at ?? "package.json#workspaces", detail: error.message, cause: error });
	}
	const candidates: Array<string> = [];
	for (const entry of patterns) {
		const candidate = npmCandidateOf(entry);
		if (candidate !== undefined) candidates.push(candidate);
	}
	const compiled = GlobSet.compileResult(candidates);
	if (Result.isFailure(compiled)) return Result.fail(globFailure(compiled.failure));
	return Result.succeed({ candidates: compiled.success, matches: matcher.success });
};

/** The string entry at `index` of a `workspaces` field, in either shape. */
const declaredAt = (field: unknown, index: number): string | undefined => {
	const packages =
		typeof field === "object" && field !== null && !Array.isArray(field) && Object.hasOwn(field, "packages")
			? (field as { readonly packages: unknown }).packages
			: undefined;
	const declared = Array.isArray(packages) ? packages : field;
	if (!Array.isArray(declared)) return undefined;
	const entry: unknown = declared[index];
	return typeof entry === "string" ? entry : undefined;
};
