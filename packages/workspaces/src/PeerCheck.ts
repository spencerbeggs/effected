// Unsatisfied peer-dependency detection over a parsed lockfile — a pure
// VALUE, not a service. No IO, nothing in `R`, no error channel.
//
// The computation is FORMAT-FREE. `@effected/lockfiles` normalizes every
// manager's lockfile into package *instances* carrying `instanceId`,
// `peerDependencies`, `peerDependenciesMeta` and `resolved` (name → the
// instanceId that name actually resolved to), so this module never learns
// which manager wrote the file. That is the whole point of the model work
// behind it: shelling out to each package manager's own peer command cannot
// deliver bun (which reports nothing on a no-op install and never records the
// wanted range), so the answer has to come from the graph.
//
// `instanceId` is OPAQUE here — looked up, never parsed. Splitting one on "@"
// or "(" would re-introduce the format knowledge this module exists without.

import type { Lockfile, ResolvedPackage } from "@effected/lockfiles";
import { Range, SemVer } from "@effected/semver";
import { Result, Schema } from "effect";
import type { PeerDependencyRules } from "./ConfigDependencyHooks.js";

/**
 * Why a report is not a complete answer.
 *
 * @remarks
 * Closed at exactly two, by measurement rather than by guess:
 *
 * - `"peerRulesNotApplied"` — the effective suppression policy was not applied,
 *   so pnpm's post-hoc suppression could not be replicated and some reported
 *   rows may be ones pnpm hides. **Omitting the option always produces this**,
 *   because "nobody looked" and "I looked and there are none" are different
 *   facts. Supplied rules with a non-empty `ignoreMissing` or `allowAny` also
 *   produce it: only `allowedVersions` is applied, so an unimplemented axis
 *   degrades to fail-closed rather than to a wrong answer.
 * - `"unresolvedEdge"` — some instance records an edge this model could not
 *   name (`ResolvedPackage.unresolvedEdges`), so a peer that edge satisfies
 *   cannot be verified either way.
 *
 * Both mean **fail closed**: a gate should treat an unverified report as "not
 * proven clean" rather than as a pass.
 *
 * @public
 */
export type UnverifiedReason = "peerRulesNotApplied" | "unresolvedEdge";

/**
 * Options for {@link PeerCheck.run}.
 *
 * @remarks
 * **Presence of `peerDependencyRules` is the assertion; its contents are the
 * value.** Supplying `NoPeerDependencyRules` asserts the workspace has none and
 * yields a verified report; omitting the key entirely says nothing was looked
 * up and always yields `"peerRulesNotApplied"`. The two are deliberately
 * different results, because a gate must be able to tell "clean" from
 * "unchecked".
 *
 * **Only `allowedVersions` is applied.** Rules whose `ignoreMissing` or
 * `allowAny` is non-empty describe a suppression policy this module does not
 * implement, so they also yield `"peerRulesNotApplied"` — the unimplemented
 * axes fail closed instead of being silently ignored.
 *
 * @public
 */
export interface PeerCheckOptions {
	/** The workspace's effective rules, from `WorkspaceCatalogs.peerDependencyRules()`. */
	readonly peerDependencyRules?: PeerDependencyRules;
}

/**
 * One link in the chain from an importer to the package that declared an
 * unsatisfied peer.
 *
 * @remarks
 * Mirrors the shape `pnpm peers check --json` reports, so the two can be
 * compared directly.
 *
 * @public
 */
export class PeerParent extends Schema.Class<PeerParent>("PeerParent")({
	/** The package name. */
	name: Schema.NonEmptyString,
	/** The resolved version of that package. */
	version: Schema.String,
}) {}

/**
 * One peer dependency that is declared but not satisfied.
 *
 * @remarks
 * `found` carries the version that actually resolved, or `null` when nothing
 * resolved at all. There is deliberately **no separate discriminant** between
 * "missing" and "unmet": `found === null` is the whole distinction, and a
 * renderer reads it directly.
 *
 * `optional` must be respected by any gate — an unsatisfied *optional* peer is
 * normal and should not fail a build, which is why the flag travels with the
 * row rather than being filtered out here. {@link PeerCheck.required} is the
 * convenience for the common case.
 *
 * `parents` is the path from the importer down to the package that declared
 * the peer, nearest-to-the-importer first. It is a path rather than a single
 * package because a peer declared by a transitive dependency is still that
 * importer's problem, and the chain is what makes the report actionable.
 *
 * A package an importer reaches by more than one path yields **one** row, not
 * one per path, carrying the path the walk reached first — which is what
 * `pnpm peers check` reports for the same graph. Read `parents` as *a* route to
 * the declaring package, never as the complete set of them.
 *
 * @public
 */
export class UnsatisfiedPeer extends Schema.Class<UnsatisfiedPeer>("UnsatisfiedPeer")({
	/** The importer path the problem belongs to (`"."` for the root). */
	importer: Schema.NonEmptyString,
	/** The peer dependency's name. */
	dependency: Schema.NonEmptyString,
	/** The range the declaring package asked for. */
	wanted: Schema.String,
	/** The version that resolved, or `null` when nothing resolved. */
	found: Schema.NullOr(Schema.String),
	/** Whether the declaring package marked the peer optional. */
	optional: Schema.Boolean,
	/** The path from the importer to the declaring package. */
	parents: Schema.Array(PeerParent),
}) {}

/** The formats whose lockfiles record peer resolution. @internal */
const supportsPeerResolution = (format: Lockfile["format"]): boolean => format !== "yarn";

interface Walk {
	readonly instance: ResolvedPackage;
	readonly path: ReadonlyArray<PeerParent>;
}

/**
 * The result of checking a lockfile for unsatisfied peer dependencies.
 *
 * @remarks
 * A report rather than a bare array, because an empty array is the most
 * dangerous success shape this domain has: it is indistinguishable from "this
 * format cannot be checked". `supported` and `unresolvedImporters` make the
 * difference legible, so a consumer cannot read a limitation as a clean bill
 * of health.
 *
 * Pure and total — construct it with {@link PeerCheck.run}, which never fails.
 *
 * @example
 * ```ts
 * import { PeerCheck } from "@effected/workspaces";
 * import { Lockfile } from "@effected/lockfiles";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const lockfile = yield* Lockfile.parse(text, { format: "pnpm" });
 *   const report = PeerCheck.run(lockfile);
 *   return report.supported ? report.required : [];
 * });
 * ```
 *
 * @public
 */
export class PeerCheck extends Schema.Class<PeerCheck>("PeerCheck")({
	/**
	 * Whether the lockfile's format records peer resolution at all.
	 *
	 * `false` for yarn: yarn resolves peers **virtually**, giving a
	 * peer-bearing package one `@virtual:` locator per consumer, and the
	 * lockfile does not record which virtual instance satisfied which peer.
	 * The answer is not recoverable, so it is not fabricated — `unsatisfied`
	 * is empty and this flag says why.
	 */
	supported: Schema.Boolean,
	/** Every unsatisfied peer found, optional ones included. */
	unsatisfied: Schema.Array(UnsatisfiedPeer),
	/**
	 * Importers whose dependencies could not be resolved to instances, so no
	 * verdict was reached for them.
	 *
	 * @remarks
	 * In practice this is the **root importer under npm and bun**: neither
	 * records a resolved version per importer dependency, and neither emits a
	 * package row for the root, so there is nothing to join on. pnpm records a
	 * version per importer dependency and is unaffected.
	 *
	 * Reported rather than silently skipped, for the same reason `supported`
	 * exists: a gate that sees no rows is entitled to know whether that means
	 * "clean" or "not looked at".
	 */
	unresolvedImporters: Schema.Array(Schema.String),
	/**
	 * Why this report is not a complete answer, or empty when it is.
	 *
	 * @remarks
	 * See {@link UnverifiedReason}. A gate must treat a non-empty `unverified`
	 * as **not proven clean** rather than as a pass: both reasons mean some
	 * finding may be missing or spurious, and failing closed is the requirement.
	 */
	unverified: Schema.Array(Schema.Literals(["peerRulesNotApplied", "unresolvedEdge"])),
}) {
	/** The unsatisfied peers a gate should act on — the non-optional ones. */
	get required(): ReadonlyArray<UnsatisfiedPeer> {
		return this.unsatisfied.filter((row) => !row.optional);
	}

	/**
	 * Compute the unsatisfied peer dependencies of a parsed lockfile.
	 *
	 * @remarks
	 * Pure, total and format-free: no IO, no error channel, and no knowledge of
	 * which package manager wrote the file. Range satisfaction is
	 * `@effected/semver`'s, never hand-rolled.
	 *
	 * The walk starts at each importer's resolved dependencies and follows
	 * `resolved` edges, so a peer declared by a *transitive* dependency is
	 * attributed to the importer that pulls it in, with the chain in
	 * `parents` — matching how `pnpm peers check` attributes them.
	 *
	 * Three judgements are deliberate:
	 *
	 * - **A required peer with nothing resolved is reported** (`found: null`),
	 *   whether or not the declared range is parseable — a peer with no
	 *   provider is a fact about the graph that needs no range arithmetic.
	 * - **An ABSENT optional peer is not reported at all**, because that is
	 *   what optional means. An optional peer resolved at the *wrong* version
	 *   still is, carrying `optional: true`. Both halves match
	 *   `pnpm peers check`, whose `missing` section contains only required
	 *   peers while its `bad` section carries optional ones.
	 * - **An unparseable range or version with something resolved is skipped.**
	 *   The check cannot judge it, and asserting "unsatisfied" on a comparison
	 *   that was never performed would be a wrong answer rather than a gap.
	 * - **A workspace-linked provider counts.** Resolution is followed through
	 *   whatever the edge names, including a workspace row.
	 *
	 * Known limits it does not paper over: yarn (see `supported`), the npm and
	 * bun root importer (see `unresolvedImporters`), and pnpm recording no peer
	 * declarations for workspace projects themselves — under pnpm a workspace
	 * package's *own* unsatisfied peers are not in the lockfile at all, and
	 * `pnpm peers check` does not report them either.
	 *
	 * @param lockfile - a lockfile parsed by `@effected/lockfiles`
	 * @returns the report; never fails
	 */
	static run(lockfile: Lockfile, options?: PeerCheckOptions): PeerCheck {
		// PRESENCE of the key is the assertion, not its contents: supplying
		// `NoPeerDependencyRules` asserts the workspace has none, while omitting
		// the option says nothing was looked up. Collapsing the two would tell a
		// gate that an unchecked workspace is clean.
		const keySupplied = options !== undefined && "peerDependencyRules" in options;
		const rules = options?.peerDependencyRules;
		// Only `allowedVersions` is applied. A workspace whose rules populate
		// `ignoreMissing` or `allowAny` has a suppression policy this module cannot
		// replicate, so claiming the policy was applied would report rows pnpm
		// hides — the exact false-positive class this work removes. An unimplemented
		// axis degrades to FAIL CLOSED rather than to a wrong answer, reusing the
		// existing reason ("the effective suppression policy was not applied")
		// rather than growing the deliberately closed union.
		const axesUnapplied = rules !== undefined && (rules.ignoreMissing.length > 0 || rules.allowAny.length > 0);
		const rulesApplied = keySupplied && !axesUnapplied;
		const allowed = rules?.allowedVersions ?? {};
		const unverified: Array<UnverifiedReason> = rulesApplied ? [] : ["peerRulesNotApplied"];

		if (!supportsPeerResolution(lockfile.format)) {
			return PeerCheck.make({ supported: false, unsatisfied: [], unresolvedImporters: [], unverified });
		}

		const byId = new Map(lockfile.packages.map((pkg) => [pkg.instanceId, pkg]));
		const workspaceByPath = new Map<string, ResolvedPackage>();
		for (const pkg of lockfile.packages) {
			if (pkg.isWorkspace && pkg.relativePath !== undefined) workspaceByPath.set(pkg.relativePath, pkg);
		}

		const rows: Array<UnsatisfiedPeer> = [];
		const unresolved: Array<string> = [];
		const seen = new Set<string>();

		for (const importer of lockfile.importers) {
			const roots = rootInstances(lockfile, importer.path, workspaceByPath, byId);
			if (roots === undefined) {
				unresolved.push(importer.path);
				continue;
			}
			collect(importer.path, roots, byId, rows, seen, allowed);
		}

		// An edge the lockfile records but the model could not name means some
		// peer may be satisfied by something invisible here — so the report is
		// incomplete, and says so rather than presenting its rows as the answer.
		if (lockfile.packages.some((pkg) => pkg.unresolvedEdges.length > 0)) unverified.push("unresolvedEdge");

		return PeerCheck.make({
			supported: true,
			unsatisfied: rows,
			unresolvedImporters: unresolved,
			unverified,
		});
	}
}

/**
 * The instances an importer's dependencies resolved to, plus the importer's own
 * workspace row when the lockfile records one.
 *
 * Returns `undefined` when the importer cannot be resolved at all, which the
 * caller reports rather than treating as "no problems here".
 *
 * @internal
 */
const rootInstances = (
	lockfile: Lockfile,
	importerPath: string,
	workspaceByPath: ReadonlyMap<string, ResolvedPackage>,
	byId: ReadonlyMap<string, ResolvedPackage>,
): ReadonlyArray<Walk> | undefined => {
	const own = workspaceByPath.get(importerPath);
	if (own !== undefined) {
		// The importer's own row carries both its declared peers (npm, bun) and
		// its resolved edges, so it is the walk's first node.
		return [{ instance: own, path: [] }];
	}

	// No row for this importer — the root under every format, and any importer
	// whose row the lockfile omits. Fall back to what the importer entry records
	// about each dependency.
	const importer = lockfile.importer(importerPath);
	if (importer._tag === "None") return undefined;

	const walks: Array<Walk> = [];
	let resolvable = false;
	for (const dep of importer.value.dependencies) {
		if (dep.version === undefined) continue;

		// Compose the identity the importer entry describes, then VERIFY it
		// against the real id set — the same compose-then-verify rule the
		// lockfile's own edge resolution follows. A composed string matching
		// nothing is discarded and the dependency is skipped; there is no
		// name-and-version fallback, because guessing between two peer variants
		// of one name@version would attribute one variant's peers to an importer
		// that resolved the other, and a fabricated finding is worse than a
		// missing one.
		//
		// This is not parsing an instanceId: nothing is split, indexed or
		// pattern-matched. `peerSuffix` is a field the lockfile hands us
		// precisely because a version alone cannot name a peer-resolved
		// instance, and dropping it is what made the root importer of a
		// workspace with two peer variants silently unanswerable.
		const composed = byId.get(`${dep.name}@${dep.version}${dep.peerSuffix ?? ""}`);
		if (composed === undefined) continue;
		resolvable = true;
		walks.push({ instance: composed, path: [PeerParent.make({ name: composed.name, version: composed.version })] });
	}

	// An importer with no dependencies at all is legitimately clean, not
	// unresolvable; one whose every dependency failed to join is not.
	if (!resolvable && importer.value.dependencies.length > 0) return undefined;
	return walks;
};

/**
 * Walk the resolution graph from an importer's roots, emitting a row for every
 * unsatisfied peer declared anywhere along the way.
 *
 * @internal
 */
const collect = (
	importerPath: string,
	roots: ReadonlyArray<Walk>,
	byId: ReadonlyMap<string, ResolvedPackage>,
	rows: Array<UnsatisfiedPeer>,
	seen: Set<string>,
	allowed: Readonly<Record<string, string>>,
): void => {
	const visited = new Set<string>();
	const queue: Array<Walk> = [...roots];

	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;
		if (visited.has(current.instance.instanceId)) continue;
		visited.add(current.instance.instanceId);

		for (const [peer, wanted] of Object.entries(current.instance.peerDependencies)) {
			if (peer === "") continue;
			const optional = current.instance.peerDependenciesMeta[peer]?.optional === true;
			const verdict = judge(current.instance, peer, wanted, optional, byId);
			if (verdict === undefined) continue;
			// pnpm computes the same violation and then SUPPRESSES it when a rule
			// permits the version that resolved. Replicating that is the whole
			// point: without it we report findings pnpm calls clean.
			if (suppressedByRule(allowed, current.instance.name, peer, verdict.found)) continue;
			// One row per (importer, peer, declaring INSTANCE) — which is what pnpm
			// reports. Measured on `peers/diamond`, where one importer reaches
			// `use-sync-external-store@1.2.2` through both react-redux and zustand:
			// `pnpm peers check --json` emits that package's unsatisfied `react`
			// once, carrying the chain it reached first, and says nothing about the
			// other. So a second chain is not a second fact, and the walk below
			// judges each instance once per importer for the same reason.
			//
			// The set is a guard rather than a live filter under the current walk —
			// the per-importer `visited` set already admits each instance once, and
			// deleting the guard changes no test. It earns its place by holding the
			// invariant at the point the row is emitted: swap the walk for a
			// per-chain one and this is what still collapses the diamond, which is
			// mutation-checked in both directions.
			const key = `${importerPath}\u0000${peer}\u0000${current.instance.instanceId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			rows.push(
				UnsatisfiedPeer.make({
					importer: importerPath,
					dependency: peer,
					wanted,
					found: verdict.found,
					optional,
					parents: current.path,
				}),
			);
		}

		for (const targetId of Object.values(current.instance.resolved)) {
			const next = byId.get(targetId);
			if (next === undefined || visited.has(targetId)) continue;
			queue.push({
				instance: next,
				path: [...current.path, PeerParent.make({ name: next.name, version: next.version })],
			});
		}
	}
};

/**
 * The parent name a `peerDependencyRules.allowedVersions` key names, with the
 * parent's version stripped.
 *
 * @remarks
 * **pnpm ignores the parent version in a rule key**, so
 * `"react-dom@18.0.0>react"` suppresses a `react-dom@18.3.1` instance too.
 * Replicating that is not optional: matching on the version would suppress a
 * strictly smaller set than pnpm does, and every row in the difference is a
 * false positive.
 *
 * Both spellings occur in the wild and both must work — parent-versioned, as
 * `pnpm:export` materializes into `pnpm-workspace.yaml`, and unversioned, as a
 * config-dependency plugin injects. A scoped name keeps its leading `@`, so the
 * version separator is the LAST `@`, and only when it is not the first
 * character.
 *
 * A key naming no parent at all (`"react"`, with no `>`) never reaches this
 * function: {@link suppressedByRule} matches it against every parent, which is
 * what pnpm does with it.
 *
 * @internal
 */
const ruleParentName = (parent: string): string => {
	const at = parent.lastIndexOf("@");
	return at > 0 ? parent.slice(0, at) : parent;
};

/**
 * Whether a rule permits the version that actually resolved for this peer.
 *
 * @remarks
 * Only `allowedVersions` is consulted. `ignoreMissing` and `allowAny` are
 * carried through the seam **unmeasured and unwired** — an unmeasured
 * suppression is exactly what produced the false positives this work removes,
 * so no code acts on them until someone measures them. Non-empty, they make the
 * whole report `"peerRulesNotApplied"` (see {@link PeerCheck.run}) rather than
 * being ignored here.
 *
 * A rule cannot rescue a peer that resolved to nothing: with no version there
 * is nothing for the rule to permit, and pnpm's own `missing` section is not
 * suppressed by `allowedVersions` either.
 *
 * @internal
 */
const suppressedByRule = (
	allowed: Readonly<Record<string, string>>,
	parentName: string,
	peer: string,
	found: string | null,
): boolean => {
	if (found === null) return false;
	const version = SemVer.parseResult(found);
	if (Result.isFailure(version)) return false;
	for (const [key, permitted] of Object.entries(allowed)) {
		const separator = key.indexOf(">");
		// A key starting with ">" names no parent at all — malformed, and a
		// malformed rule suppresses nothing.
		if (separator === 0) continue;
		if (separator === -1) {
			// A BARE key applies to every parent that declares this peer. Measured
			// against pnpm 11.22.0: with `allowedVersions: { react: "17" }` and
			// nothing else, `pnpm peers check --json` reports the same workspace
			// clean that it reports `react-dom>react` for — and still reports the
			// row when the bare key's range does not cover the found version.
			// Skipping bare keys therefore reports rows pnpm suppresses, while
			// `rulesApplied` claims the policy was applied.
			if (key !== peer) continue;
		} else {
			if (key.slice(separator + 1) !== peer) continue;
			if (ruleParentName(key.slice(0, separator)) !== parentName) continue;
		}
		const range = Range.parseResult(permitted);
		// A rule whose own value is unparseable suppresses nothing — it cannot be
		// evaluated, and treating it as a wildcard would hide real findings.
		if (Result.isFailure(range)) continue;
		if (Range.satisfies(version.success, range.success)) return true;
	}
	return false;
};

/**
 * Decide whether one declared peer is unsatisfied.
 *
 * Returns `undefined` for "satisfied, or not judgeable" — the two cases that
 * produce no row. They are deliberately merged here and separated in the
 * TSDoc on {@link PeerCheck.run}, since neither yields output.
 *
 * @internal
 */
const judge = (
	instance: ResolvedPackage,
	peer: string,
	wanted: string,
	optional: boolean,
	byId: ReadonlyMap<string, ResolvedPackage>,
): { readonly found: string | null } | undefined => {
	const providerId = instance.resolved[peer];
	const provider = providerId === undefined ? undefined : byId.get(providerId);
	if (provider === undefined) {
		// An ABSENT optional peer is satisfied by definition — that is what
		// "optional" means, and reporting it would be a false positive. An
		// optional peer installed at the WRONG version still is one, and is
		// reported below with the flag set. Confirmed against `pnpm peers check`,
		// whose `missing` section carries only non-optional entries while its
		// `bad` section carries optional ones.
		if (optional) return undefined;
		// The edge IS recorded — the lockfile just spells its target in a way
		// the model could not name (a `link:` into a build-output directory, say).
		// So this peer may well be satisfied, and reporting it as unsatisfied is
		// precisely the false positive `unresolvedEdges` exists to prevent. It is
		// declined here and surfaced on the report's `unverified` instead: not
		// proven clean, but not falsely accused either.
		if (instance.unresolvedEdges.includes(peer)) return undefined;
		// Nothing resolved for a required peer, and nothing recorded either:
		// reportable without any range arithmetic, and reported even when the
		// range itself is junk — "no provider" is a fact about the graph, not
		// about the range.
		return { found: null };
	}

	// A peer satisfied by a WORKSPACE package is accepted without a version
	// check, and that is correct rather than a hole: pnpm records no version for
	// an importer, so a workspace row carries the placeholder `"0.0.0"` and any
	// comparison would be against a placeholder rather than the real version.
	// An edge exists and a provider exists, so nothing indicates dissatisfaction
	// — a declined answer beats a false one, and reporting `found: "0.0.0"`
	// against a real range would be exactly that false answer.
	if (provider.isWorkspace) return undefined;

	const range = Range.parseResult(wanted);
	const version = SemVer.parseResult(provider.version);
	// Something resolved but the comparison cannot be performed. Claiming
	// "unsatisfied" here would assert the result of a test that never ran.
	if (Result.isFailure(range) || Result.isFailure(version)) return undefined;
	if (Range.satisfies(version.success, range.success)) return undefined;
	return { found: provider.version };
};
