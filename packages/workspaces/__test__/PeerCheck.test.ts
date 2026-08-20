// PeerCheck, including the differential oracle against `pnpm peers check --json`.
//
// The oracle is COMMITTED, not shelled out to. This package forbids new local
// subprocess seams, and a test needing a live pnpm on PATH is neither hermetic
// nor reproducible in CI — so the check is run at fixture-generation time and
// its verdict lands beside the lockfile it describes. Provenance, including the
// pnpm version, is in `__test__/fixtures/peers/README.md`.
//
// The lockfiles are real pnpm output; no `FileSystem` service is involved, since
// PeerCheck is a pure value over an already-parsed Lockfile.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Lockfile } from "@effected/lockfiles";
import { Effect } from "effect";
import { NoPeerDependencyRules } from "../src/ConfigDependencyHooks.js";
import type { UnsatisfiedPeer } from "../src/PeerCheck.js";
import { PeerCheck } from "../src/PeerCheck.js";

const fixture = (relative: string): string => readFileSync(join(import.meta.dirname, "fixtures", relative), "utf8");

const parse = (dir: string) => Lockfile.parse(fixture(`peers/${dir}/pnpm-lock.yaml`), { format: "pnpm" });

/** One normalized row, comparable across both sides of the oracle. */
interface Row {
	readonly importer: string;
	readonly dependency: string;
	readonly wanted: string;
	readonly found: string | null;
	readonly optional: boolean;
	readonly parents: ReadonlyArray<string>;
}

const order = (rows: ReadonlyArray<Row>): ReadonlyArray<Row> =>
	[...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

const ours = (rows: ReadonlyArray<UnsatisfiedPeer>): ReadonlyArray<Row> =>
	order(
		rows.map((row) => ({
			importer: row.importer,
			dependency: row.dependency,
			wanted: row.wanted,
			found: row.found,
			optional: row.optional,
			parents: row.parents.map((p) => `${p.name}@${p.version}`),
		})),
	);

/** pnpm's own shape, narrowed to the fields the comparison uses. */
interface OracleEntry {
	readonly parents: ReadonlyArray<{ readonly name: string; readonly version: string }>;
	readonly optional: boolean;
	readonly wantedRange: string;
	readonly foundVersion?: string;
}
type Oracle = Readonly<
	Record<
		string,
		{
			readonly bad: Record<string, ReadonlyArray<OracleEntry>>;
			readonly missing: Record<string, ReadonlyArray<OracleEntry>>;
		}
	>
>;

const theirs = (dir: string, file = "peers-check.json"): ReadonlyArray<Row> => {
	const oracle = JSON.parse(fixture(`peers/${dir}/${file}`)) as Oracle;
	const rows: Array<Row> = [];
	for (const [importer, report] of Object.entries(oracle)) {
		// A clean importer still emits its key with empty objects, so emptiness
		// here is a verdict, not an absence.
		for (const section of [report.bad, report.missing]) {
			for (const [dependency, entries] of Object.entries(section ?? {})) {
				for (const entry of entries) {
					rows.push({
						importer,
						dependency,
						wanted: entry.wantedRange,
						// `missing` entries carry no foundVersion — the same distinction
						// our `found: null` makes, which is why no extra discriminant is
						// needed on either side.
						found: entry.foundVersion ?? null,
						optional: entry.optional,
						parents: entry.parents.map((p) => `${p.name}@${p.version}`),
					});
				}
			}
		}
	}
	return order(rows);
};

describe("PeerCheck.run", () => {
	it.effect("agrees with pnpm peers check on a workspace mixing all four verdicts", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("mixed"));
			assert.isTrue(report.supported);
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("mixed"));
		}),
	);

	it.effect("agrees with pnpm peers check on unresolvable peers, transitive ones included", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("missing"));
			assert.isTrue(report.supported);
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("missing"));
		}),
	);

	it.effect("reports an unmet required peer with the version that actually resolved", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("mixed"));
			const row = report.unsatisfied.find((r) => r.importer === "packages/unmet" && r.dependency === "react");

			assert.isDefined(row);
			assert.strictEqual(row?.wanted, "^18.3.1");
			assert.strictEqual(row?.found, "17.0.2");
			assert.isFalse(row?.optional);
			assert.deepStrictEqual(
				row?.parents.map((p) => `${p.name}@${p.version}`),
				["react-dom@18.3.1"],
			);
		}),
	);

	it.effect("distinguishes an unmet OPTIONAL peer, and keeps it out of `required`", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("mixed"));
			const row = report.unsatisfied.find((r) => r.importer === "packages/optional" && r.dependency === "redux");

			assert.isDefined(row);
			assert.isTrue(row?.optional);
			assert.strictEqual(row?.found, "4.2.1");
			// The consumer's gate fires on required peers only, so an optional row
			// must never reach it.
			assert.isTrue(report.required.every((r) => !r.optional));
			assert.isUndefined(report.required.find((r) => r.dependency === "redux"));
		}),
	);

	it.effect("collapses a DIAMOND to one row per package, as pnpm does", () =>
		Effect.gen(function* () {
			// `use-sync-external-store@1.2.2` is reached twice from one importer —
			// via react-redux and via zustand (an override pins both to one version,
			// which is what makes it a diamond rather than two instances) — and it
			// declares an unsatisfied `react` peer.
			//
			// pnpm reports that peer ONCE, carrying the react-redux chain, and says
			// nothing about the zustand chain: it collapses per (importer, peer,
			// package) rather than emitting one row per parent chain. The oracle is
			// the decision here, not our preference, and this fixture exists because
			// no other one has two chains to a single peer-declaring package.
			const report = PeerCheck.run(yield* parse("diamond"));
			assert.isTrue(report.supported);
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("diamond"));

			// Stated directly as well, because the oracle comparison above would
			// also pass if BOTH sides grew the second chain.
			const rows = report.unsatisfied.filter(
				(r) => r.dependency === "react" && r.parents.some((p) => p.name === "use-sync-external-store"),
			);
			assert.strictEqual(rows.length, 1);
			assert.deepStrictEqual(
				rows[0]?.parents.map((p) => p.name),
				["react-redux", "use-sync-external-store"],
			);
			// The other chain really is reachable — without this the assertion above
			// could pass because zustand never reaches the package at all.
			// Compare against the provider's own instanceId rather than spelling one:
			// the id is opaque, and hardcoding its shape would couple this test to a
			// spelling @effected/lockfiles is free to change while PeerCheck stays correct.
			const lockfile = yield* parse("diamond");
			const zustand = lockfile.packagesNamed("zustand")[0];
			const provider = lockfile.packagesNamed("use-sync-external-store").find((p) => p.version === "1.2.2");
			assert.isDefined(provider);
			assert.strictEqual(zustand?.resolved["use-sync-external-store"], provider?.instanceId);
		}),
	);

	it.effect("reports `found: null` for a peer nothing resolved, with no extra discriminant", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("missing"));
			const rows = report.unsatisfied.filter((r) => r.dependency === "react");

			assert.strictEqual(rows.length, 3);
			assert.isTrue(rows.every((r) => r.found === null));
			// One of the three is TRANSITIVE — declared by a dependency of a
			// dependency — which is why `parents` is a path, not one package.
			const transitive = rows.find((r) => r.parents.length === 2);
			assert.isDefined(transitive);
			assert.deepStrictEqual(
				transitive?.parents.map((p) => p.name),
				["react-redux", "use-sync-external-store"],
			);
		}),
	);

	it.effect("finds nothing for a satisfied importer, and says so as a verdict", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("mixed"));
			assert.isUndefined(report.unsatisfied.find((r) => r.importer === "packages/ok"));
			// pnpm resolves peers from the workspace root, so this importer's
			// react-dom is satisfied by a SIBLING's react. A checker reasoning over
			// importer manifests rather than resolved instances would report a false
			// positive here; the oracle agrees it is clean.
			assert.isUndefined(report.unsatisfied.find((r) => r.importer === "packages/missing"));
		}),
	);

	it.effect("agrees with pnpm peers check on a ROOT importer with real dependencies", () =>
		Effect.gen(function* () {
			// The root importer has no package row under any format, so it is
			// answered by joining its recorded per-dependency version to an
			// instance. Both earlier oracle fixtures declare `.: {}`, so this is
			// the only fixture that exercises that join productively — and it is
			// the common case, not an edge case: this repository's own lockfile has
			// a root importer with real dependencies.
			const report = PeerCheck.run(yield* parse("rootimporter"));
			assert.isTrue(report.supported);
			assert.deepStrictEqual(report.unresolvedImporters, []);
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("rootimporter"));

			const row = report.required.find((r) => r.importer === ".");
			assert.isDefined(row);
			assert.strictEqual(row?.dependency, "react");
			assert.strictEqual(row?.found, "17.0.2");
		}),
	);

	it.effect("disambiguates two peer variants of one name@version by the recorded suffix", () =>
		Effect.gen(function* () {
			// react-dom@18.3.1 exists twice, resolved against react@17.0.2 and
			// react@18.3.1. The root took the 17.0.2 variant and the importer entry
			// says so through its peer suffix. Joining on name+version alone cannot
			// tell them apart, and skipping would silently drop a real unmet peer —
			// which is what the oracle comparison above would then catch.
			const report = PeerCheck.run(yield* parse("rootimporter"));
			const row = report.unsatisfied.find((r) => r.importer === "." && r.dependency === "react");

			assert.isDefined(row);
			// The 17.0.2 variant's peer, not the 18.3.1 variant's (which is satisfied).
			assert.strictEqual(row?.found, "17.0.2");
			assert.strictEqual(row?.wanted, "^18.3.1");
			// The sibling importer resolved the OTHER variant and is clean.
			assert.isUndefined(report.unsatisfied.find((r) => r.importer === "packages/other"));
		}),
	);

	it.effect("skips an ambiguous join rather than guessing a variant", () =>
		Effect.gen(function* () {
			// Hand-authored: the importer entry records a version with NO suffix
			// while two variants of that name@version exist, so nothing says which
			// was taken. Guessing the first would attribute one variant's unmet peer
			// to an importer that may have resolved the other — a fabricated finding,
			// which is worse than a missing one.
			const report = PeerCheck.run(yield* parse("ambiguous"));

			assert.isUndefined(report.unsatisfied.find((r) => r.importer === "."));
			// The importer still counts as resolvable — its react joined fine — so
			// it is not reported as unresolvable either.
			assert.deepStrictEqual(report.unresolvedImporters, []);
			// The sibling, whose entry does carry a suffix, is unaffected.
			assert.isUndefined(report.unsatisfied.find((r) => r.importer === "packages/other"));
		}),
	);

	it.effect("answers identically for npm and bun, with no per-format branch", () =>
		Effect.gen(function* () {
			// The same workspace shape written by three managers. If any per-format
			// knowledge had leaked into PeerCheck, these two would not agree with
			// the pnpm verdict on the equivalent tree.
			const npm = PeerCheck.run(yield* Lockfile.parse(fixture("peers/npm/package-lock.json"), { format: "npm" }));
			const bun = PeerCheck.run(yield* Lockfile.parse(fixture("peers/bun/bun.lock"), { format: "bun" }));

			for (const [name, report] of [
				["npm", npm],
				["bun", bun],
			] as const) {
				assert.isTrue(report.supported, name);
				const row = report.required.find(
					(r) => r.dependency === "react" && r.parents.some((pp) => pp.name === "react-dom"),
				);
				assert.isDefined(row, `${name}: react-dom's unmet peer`);
				assert.strictEqual(row?.wanted, "^18.3.1", name);
				assert.strictEqual(row?.found, "17.0.2", name);
				assert.deepStrictEqual(
					row?.parents.map((pp) => pp.name),
					["react-dom"],
					name,
				);
			}
		}),
	);

	it.effect("names the importers it could not resolve rather than passing them silently", () =>
		Effect.gen(function* () {
			// Neither npm nor bun records a resolved version per importer
			// dependency, and neither emits a package row for the root — so the root
			// importer cannot be joined to instances. It is REPORTED, because a gate
			// that sees no rows for an importer is entitled to know whether that
			// means "clean" or "not looked at".
			const npm = PeerCheck.run(yield* Lockfile.parse(fixture("peers/npm-root/package-lock.json"), { format: "npm" }));
			assert.include(npm.unresolvedImporters, ".");
			// pnpm records the version, so it has no unresolvable importers.
			const pnpm = PeerCheck.run(yield* parse("mixed"));
			assert.deepStrictEqual(pnpm.unresolvedImporters, []);
			// A root with NO dependencies is legitimately clean, not unresolvable —
			// there is nothing to fail to resolve.
			const rootless = PeerCheck.run(yield* Lockfile.parse(fixture("peers/npm/package-lock.json"), { format: "npm" }));
			assert.deepStrictEqual(rootless.unresolvedImporters, []);
		}),
	);

	it.effect("sees a workspace package's OWN unmet peer, which pnpm structurally cannot", () =>
		Effect.gen(function* () {
			// npm and bun record a workspace package's peer declarations; pnpm does
			// not record them at all, and `pnpm peers check` does not report them
			// either. So this row exists under npm and has no pnpm counterpart —
			// a capability difference, not a disagreement.
			const npm = PeerCheck.run(yield* Lockfile.parse(fixture("peers/npm/package-lock.json"), { format: "npm" }));
			const own = npm.required.find((r) => r.importer === "packages/lib" && r.dependency === "react");

			assert.isDefined(own);
			assert.strictEqual(own?.wanted, "^18.0.0");
			assert.strictEqual(own?.found, "17.0.2");
			assert.deepStrictEqual(own?.parents, []); // declared by the importer itself
		}),
	);

	it.effect("cannot answer for yarn, and says so rather than returning an empty pass", () =>
		Effect.gen(function* () {
			// yarn resolves peers virtually and records no peer edges, so a bare
			// empty array would be indistinguishable from a clean workspace.
			const lockfile = yield* Lockfile.parse(["__metadata:", "  version: 8", "  cacheKey: 10c0"].join("\n"), {
				format: "yarn",
			});
			const report = PeerCheck.run(lockfile);

			assert.isFalse(report.supported);
			assert.deepStrictEqual(report.unsatisfied, []);
			assert.deepStrictEqual(report.required, []);
		}),
	);
});

// pnpm's suppression policy, and the fail-closed states. pnpm computes the same
// violations we do and then hides the ones `peerDependencyRules.allowedVersions`
// permits, so a checker without the rules reports findings pnpm calls clean.
describe("PeerCheck.run — peerDependencyRules and the unverified states", () => {
	const rules = (allowedVersions: Record<string, string>) => ({
		allowedVersions,
		ignoreMissing: [],
		allowAny: [],
	});

	it.effect("omitting the option always reports peerRulesNotApplied", () =>
		Effect.gen(function* () {
			// "Nobody looked" — the report may contain rows pnpm would suppress.
			const report = PeerCheck.run(yield* parse("mixed"));
			assert.include(report.unverified, "peerRulesNotApplied");
		}),
	);

	it.effect("supplying empty rules asserts there are none, and is verified", () =>
		Effect.gen(function* () {
			// "I looked, and this workspace has none" — a different fact from the
			// test above, and it must produce a different result or a gate cannot
			// tell clean from unchecked.
			const report = PeerCheck.run(yield* parse("mixed"), { peerDependencyRules: NoPeerDependencyRules });
			assert.notInclude(report.unverified, "peerRulesNotApplied");
			// The rows themselves are unchanged; only the verification state moves.
			assert.strictEqual(report.required.length, PeerCheck.run(yield* parse("mixed")).required.length);
		}),
	);

	it.effect("a non-empty ignoreMissing reports peerRulesNotApplied", () =>
		Effect.gen(function* () {
			// Wrong in exactly ONE way against the verified case below: only
			// `ignoreMissing` is populated. Only `allowedVersions` is applied, so a
			// workspace suppressing missing optional peers this way has a policy we
			// did not replicate — the report must fail closed rather than present
			// rows pnpm hides.
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: { allowedVersions: {}, ignoreMissing: ["react"], allowAny: [] },
			});
			assert.include(report.unverified, "peerRulesNotApplied");
		}),
	);

	it.effect("a non-empty allowAny reports peerRulesNotApplied", () =>
		Effect.gen(function* () {
			// The OTHER path to the same outcome, mutated independently: two code
			// paths implementing one rule are two things to pin, so dropping either
			// check must turn a different test red.
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: { allowedVersions: {}, ignoreMissing: [], allowAny: ["react"] },
			});
			assert.include(report.unverified, "peerRulesNotApplied");
		}),
	);

	it.effect("rules with both unapplied axes EMPTY stay verified", () =>
		Effect.gen(function* () {
			// The regression guard for the two tests above: the overwhelmingly
			// common shape — real `allowedVersions`, both other axes empty — is
			// fully applied and must not be dragged into fail-closed. This goes red
			// if the check fires on presence rather than on non-emptiness.
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: rules({ "react-dom>react": "17.0.2" }),
			});
			assert.notInclude(report.unverified, "peerRulesNotApplied");
		}),
	);

	it.effect("a rule suppresses the row pnpm suppresses", () =>
		Effect.gen(function* () {
			const before = PeerCheck.run(yield* parse("mixed"), { peerDependencyRules: NoPeerDependencyRules });
			assert.isDefined(before.required.find((r) => r.importer === "packages/unmet" && r.dependency === "react"));

			const after = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: rules({ "react-dom@18.3.1>react": "17.0.2" }),
			});
			assert.isUndefined(after.required.find((r) => r.importer === "packages/unmet" && r.dependency === "react"));
		}),
	);

	it.effect("a rule whose PARENT VERSION is wrong still suppresses — pnpm ignores it", () =>
		Effect.gen(function* () {
			// The quirk, wrong in exactly one way: the key names react-dom@99.0.0
			// while the instance is 18.3.1. pnpm ignores the parent version, so
			// matching on it would suppress a strictly smaller set than pnpm does
			// and every row in the difference is a false positive.
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: rules({ "react-dom@99.0.0>react": "17.0.2" }),
			});
			assert.isUndefined(report.required.find((r) => r.importer === "packages/unmet" && r.dependency === "react"));
		}),
	);

	it.effect("an UNVERSIONED rule key suppresses too — the spelling a plugin injects", () =>
		Effect.gen(function* () {
			// The other path through the same rule: `pnpm:export` materializes
			// versioned keys into pnpm-workspace.yaml, a config-dependency plugin
			// injects unversioned ones. A matcher that only ever strips a version
			// passes the versioned test and fails this one.
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: rules({ "react-dom>react": "17.0.2" }),
			});
			assert.isUndefined(report.required.find((r) => r.importer === "packages/unmet" && r.dependency === "react"));
		}),
	);

	it.effect("a rule for a DIFFERENT parent leaves the row alone", () =>
		Effect.gen(function* () {
			// Wrong in exactly one way against the suppressing case: same peer, same
			// permitted version, different parent. Ignoring the parent version must
			// not become ignoring the parent.
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: rules({ "something-else@1.0.0>react": "17.0.2" }),
			});
			assert.isDefined(report.required.find((r) => r.importer === "packages/unmet" && r.dependency === "react"));
		}),
	);

	it.effect("a rule permitting a DIFFERENT version leaves the row alone", () =>
		Effect.gen(function* () {
			const report = PeerCheck.run(yield* parse("mixed"), {
				peerDependencyRules: rules({ "react-dom>react": "16.0.0" }),
			});
			assert.isDefined(report.required.find((r) => r.importer === "packages/unmet" && r.dependency === "react"));
		}),
	);

	it.effect("a BARE rule key suppresses too — pnpm applies it to every parent", () =>
		Effect.gen(function* () {
			// The third spelling. `pnpm-workspace.yaml` writes `parent@version>peer`,
			// a plugin injects `parent>peer`, and pnpm's own documented form is a
			// parentless `peer` that applies project-wide. Measured against pnpm
			// 11.22.0 on the fixture's own workspace: with `{ react: "17" }` and
			// nothing else, `pnpm peers check --json` reports it clean — the oracle
			// beside the lockfile IS that run. Skipping bare keys reports a row pnpm
			// suppresses while `rulesApplied` claims the policy was applied.
			const report = PeerCheck.run(yield* parse("barerule"), {
				peerDependencyRules: rules({ react: "17" }),
			});
			assert.isUndefined(report.required.find((r) => r.dependency === "react"));
			assert.deepStrictEqual(report.unverified, []);
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("barerule"));
		}),
	);

	it.effect("a bare rule permitting a DIFFERENT version leaves the row alone", () =>
		Effect.gen(function* () {
			// Wrong in exactly one way against the test above: same bare key, same
			// lockfile, a range that does not cover the version that resolved. Its
			// oracle is a SECOND pnpm run over the same workspace with `react: "16"`,
			// and pnpm reports the row — so "bare keys suppress unconditionally"
			// fails here while passing above.
			const report = PeerCheck.run(yield* parse("barerule"), {
				peerDependencyRules: rules({ react: "16" }),
			});
			assert.isDefined(report.required.find((r) => r.dependency === "react"));
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("barerule", "peers-check-nonmatching.json"));
		}),
	);

	it.effect("a bare rule naming a DIFFERENT peer leaves the row alone", () =>
		Effect.gen(function* () {
			// Wrong in the other single way: a permitting range, but the key names a
			// peer this row is not about. Matching bare keys must not become
			// matching every bare key.
			const report = PeerCheck.run(yield* parse("barerule"), {
				peerDependencyRules: rules({ redux: "17" }),
			});
			assert.isDefined(report.required.find((r) => r.dependency === "react"));
		}),
	);

	it.effect("a rule key that names no parent at all suppresses nothing", () =>
		Effect.gen(function* () {
			// `">react"` is neither spelling: a separator with an empty parent. It
			// is malformed, and a malformed rule must not degrade into the bare-key
			// case, which would silently widen suppression past what pnpm does.
			const report = PeerCheck.run(yield* parse("barerule"), {
				peerDependencyRules: rules({ ">react": "17" }),
			});
			assert.isDefined(report.required.find((r) => r.dependency === "react"));
		}),
	);

	it.effect("declines a peer whose edge the model could not name", () =>
		Effect.gen(function* () {
			// react-redux's peer `react` is satisfied by `link:vendor/react-stub`,
			// a directory that is no importer. Reporting it unsatisfied is the false
			// positive; reporting nothing silently would be the other failure. This
			// test pins the declining half ONLY — the name deliberately stops there,
			// because a name that also claimed the `unverified` half would outlive
			// the test below and go on advertising coverage nothing checks.
			const report = PeerCheck.run(yield* parse("unnameable"), {
				peerDependencyRules: NoPeerDependencyRules,
			});
			assert.isUndefined(report.required.find((r) => r.dependency === "react"));
			// pnpm's own verdict on the workspace that produced this lockfile: clean.
			// Declining is therefore agreement, not a gap — the `unverified` marker
			// the next test pins is what keeps the agreement honest.
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("unnameable"));
		}),
	);

	it.effect("and says the report is unverified rather than declining silently", () =>
		Effect.gen(function* () {
			// The other half of the same behaviour, as its OWN test: declining the
			// row without saying why would turn a false positive into a false
			// negative. Two rules, two assertions — a single test asserting both
			// would go red for either, pinning neither.
			const report = PeerCheck.run(yield* parse("unnameable"), {
				peerDependencyRules: NoPeerDependencyRules,
			});
			assert.include(report.unverified, "unresolvedEdge");
		}),
	);

	it.effect("accepts a peer satisfied by a WORKSPACE package without version-comparing it", () =>
		Effect.gen(function* () {
			// react-redux wants react `^18.0 || ^19` and pnpm resolved it to the
			// workspace package `packages/fakereact` — which pnpm calls clean.
			//
			// A workspace row carries the placeholder version "0.0.0", because pnpm
			// records no version for an importer. Comparing against it would report
			// `found: "0.0.0"` against a real range — a false answer dressed as a
			// finding. An edge exists and a provider exists, so nothing indicates
			// dissatisfaction; the check declines rather than inventing a verdict.
			// This is why it is not a hole.
			const report = PeerCheck.run(yield* parse("workspacepeer"), {
				peerDependencyRules: NoPeerDependencyRules,
			});

			assert.isUndefined(report.required.find((r) => r.dependency === "react"));
			assert.deepStrictEqual(report.unverified, []);
			// pnpm calls this workspace clean, and so do we. Agreement here is
			// agreement by silence — that both sides emit nothing — which is why the
			// `unverified` assertion above sits next to it: the interesting claim is
			// that we are silent for a reason, not merely silent.
			assert.deepStrictEqual(ours(report.unsatisfied), theirs("workspacepeer"));
			// The edge really does point at a workspace row at the placeholder
			// version — without that, the assertion above could pass for the wrong
			// reason.
			const lockfile = yield* parse("workspacepeer");
			const stub = lockfile.packagesNamed("packages/fakereact")[0];
			assert.isTrue(stub?.isWorkspace);
			assert.strictEqual(stub?.version, "0.0.0");
		}),
	);

	it.effect("npm and bun need no rules input to be fully answerable", () =>
		Effect.gen(function* () {
			// `peerDependencyRules` is pnpm-only; npm and bun have no equivalent
			// suppression, so their computation is already complete. Supplying empty
			// rules must leave them verified.
			const npm = PeerCheck.run(yield* Lockfile.parse(fixture("peers/npm/package-lock.json"), { format: "npm" }), {
				peerDependencyRules: NoPeerDependencyRules,
			});
			assert.deepStrictEqual(npm.unverified, []);
		}),
	);
});
