import { assert, describe, it } from "@effect/vitest";
import { Epic, VersioningConfig } from "@effected/pnpm";
import { WorkspacePackage } from "@effected/workspaces";
import { Result, Schema } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { Ledger, LedgerEntry } from "../src/Ledger.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

// pnpm's own engine tests, ported case for case from
// .repos/pnpm/pnpm/crates/versioning/src/plan/tests/{dependencies,behavior}.rs
// (pnpm 12.20.0), with their helpers (plan/tests.rs): `make_project` is a
// public project at `/ws/<name>`, so its directory is its name; `ledger` writes
// bare-list entries, matched by name. Each test names the Rust test it ports.
// `filter_narrows_the_plan_…` is not ported: `assemble` has no `--filter`.

type Bump = "none" | "patch" | "minor" | "major";

const project = (name: string, version: string, deps: Record<string, string> = {}, dir = name): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version,
		path: `/ws/${dir}`,
		packageJsonPath: `/ws/${dir}/package.json`,
		relativePath: dir,
		workspaceRoot: "/ws",
		dependencies: deps,
	});

const intent = (id: string, releases: Record<string, Bump>): PendingChangeset =>
	PendingChangeset.make({ file: `${id}.md`, releases: new Map(Object.entries(releases)), summary: `summary of ${id}` });

const ledger = (entries: Record<string, ReadonlyArray<string>>): Ledger =>
	Ledger.make({
		entries: Object.entries(entries).map(([key, intents]) => {
			const at = key.lastIndexOf("@");
			return LedgerEntry.make({ name: key.slice(0, at), version: key.slice(at + 1), intents: [...intents] });
		}),
	});

const versioning = (fields: Partial<VersioningConfig>): VersioningConfig => VersioningConfig.make(fields);
const onLane = (name: string, lane: string) => versioning({ lanes: { [name]: lane } });
const epic = (lead: string, packages: ReadonlyArray<string>) => Epic.make({ lead, packages: [...packages] });

const config = Schema.decodeUnknownSync(ChangesetConfig)({});

const assemble = (
	packages: ReadonlyArray<WorkspacePackage>,
	changesets: ReadonlyArray<PendingChangeset>,
	options: {
		readonly ledger?: Ledger;
		readonly versioning?: VersioningConfig;
		readonly unpublished?: ReadonlyArray<string>;
	} = {},
) =>
	ReleasePlan.assemble({
		packages,
		changesets,
		config,
		manager: "pnpm",
		...(options.ledger === undefined ? {} : { ledger: options.ledger }),
		...(options.versioning === undefined ? {} : { versioning: options.versioning }),
		// `assemble_with_unpublished`: the registry has every manifest version but the unpublished ones.
		...(options.unpublished === undefined
			? {}
			: {
					published: new Set(
						packages.map((pkg) => pkg.relativePath).filter((dir) => !options.unpublished?.includes(dir)),
					),
				}),
	});

const plan = (...args: Parameters<typeof assemble>): ReleasePlan => {
	const result = assemble(...args);
	if (Result.isFailure(result)) throw new Error(`the plan should assemble: ${result.failure.message}`);
	return result.success;
};

const failure = (...args: Parameters<typeof assemble>) => {
	const result = assemble(...args);
	if (Result.isSuccess(result)) throw new Error("the plan should fail");
	return result.failure;
};

const next = (released: ReleasePlan, name: string): string | undefined =>
	released.releases.find((release) => release.name === name)?.newVersion;
const names = (released: ReleasePlan): ReadonlyArray<string> => released.releases.map((release) => release.name);

describe("pnpm's engine tests: dependencies.rs", () => {
	it("direct_bumps_highest_pending_bump_type_wins_per_package", () => {
		const released = plan(
			[project("a", "1.0.0"), project("b", "2.3.4")],
			[intent("one", { a: "patch", b: "minor" }), intent("two", { a: "minor" })],
		);
		assert.deepStrictEqual(
			released.releases.map((r) => [r.name, r.newVersion, r.type]),
			[
				["a", "1.1.0", "minor"],
				["b", "2.4.0", "minor"],
			],
		);
	});

	it("a_none_bump_type_releases_nothing", () => {
		assert.deepStrictEqual(names(plan([project("a", "1.0.0")], [intent("one", { a: "none" })])), []);
	});

	it("fixed_groups_release_together_at_one_shared_version", () => {
		const released = plan([project("a", "1.2.0"), project("b", "1.0.5")], [intent("one", { a: "minor" })], {
			versioning: versioning({ fixed: [["a", "b"]] }),
		});
		assert.deepStrictEqual([next(released, "a"), next(released, "b")], ["1.3.0", "1.3.0"]);
	});

	it("max_bump_rejects_a_plan_whose_effective_bump_exceeds_the_cap", () => {
		const error = failure([project("lib", "1.0.0")], [intent("one", { lib: "minor" })], {
			versioning: versioning({ maxBump: "patch" }),
		});
		assert.isTrue(error._tag === "VersioningError" && error.reason === "maxBumpExceeded");
		assert.isTrue(error._tag === "VersioningError" && error.raisedBy?.join() === ".changeset/one.md");
	});

	it("max_bump_measures_the_real_version_distance_including_fixed_group_jumps", () => {
		// a's own bump is a minor, but the shared version takes it from 1.0.5 to 2.1.0: a major.
		const error = failure([project("a", "1.0.5"), project("b", "2.0.0")], [intent("one", { a: "minor" })], {
			versioning: versioning({ fixed: [["a", "b"]], maxBump: "minor" }),
		});
		assert.isTrue(
			error._tag === "VersioningError" &&
				error.reason === "maxBumpExceeded" &&
				error.package === "a" &&
				error.bump === "major" &&
				error.raisedBy?.join() === "fixed,intent",
		);
	});

	it("a_package_on_a_lane_emits_tagged_versions_with_an_incrementing_counter", () => {
		const lane = onLane("cli", "alpha");
		assert.strictEqual(
			next(plan([project("cli", "2.0.0")], [intent("one", { cli: "minor" })], { versioning: lane }), "cli"),
			"2.1.0-alpha.0",
		);
		const second = plan(
			[project("cli", "2.1.0-alpha.0")],
			[intent("one", { cli: "minor" }), intent("two", { cli: "patch" })],
			{ versioning: lane, ledger: ledger({ "cli@2.1.0-alpha.0": ["one"] }) },
		);
		assert.strictEqual(next(second, "cli"), "2.1.0-alpha.1");
	});

	it("a_bigger_bump_landing_later_escalates_the_stable_target_of_the_lane", () => {
		const released = plan(
			[project("cli", "2.1.0-alpha.1")],
			[intent("one", { cli: "minor" }), intent("two", { cli: "major" })],
			{ versioning: onLane("cli", "alpha"), ledger: ledger({ "cli@2.1.0-alpha.0": ["one"], "cli@2.1.0-alpha.1": [] }) },
		);
		assert.strictEqual(next(released, "cli"), "3.0.0-alpha.0");
	});

	it("packages_on_the_main_lane_release_stable_versions_from_the_same_run", () => {
		const released = plan(
			[project("cli", "2.0.0"), project("lib", "1.0.0")],
			[intent("one", { cli: "minor", lib: "minor" })],
			{
				versioning: onLane("cli", "alpha"),
			},
		);
		assert.deepStrictEqual([next(released, "cli"), next(released, "lib")], ["2.1.0-alpha.0", "1.1.0"]);
	});

	it("returning_to_the_main_lane_releases_the_accumulated_stable_version_even_without_pending_intents", () => {
		const released = plan(
			[project("cli", "2.1.0-alpha.2")],
			[intent("one", { cli: "minor" }), intent("two", { cli: "patch" })],
			{ ledger: ledger({ "cli@2.1.0-alpha.0": ["one"], "cli@2.1.0-alpha.2": ["two"] }) },
		);
		assert.deepStrictEqual(
			released.releases.map((r) => [r.newVersion, [...r.changesets].sort()]),
			[["2.1.0", ["one", "two"]]],
		);
	});

	it("snapshot_plans_release_the_same_set_under_snapshot_versions", () => {
		const result = ReleasePlan.assemble({
			packages: [project("lib", "1.0.0"), project("cli", "1.0.0", { lib: "workspace:*" })],
			changesets: [intent("one", { lib: "patch" })],
			config,
			manager: "pnpm",
			snapshot: { tag: "preview", timestamp: new Date("2026-07-12T00:00:00Z") },
		});
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.deepStrictEqual(
				result.success.releases.map((r) => r.newVersion),
				["0.0.0-preview-20260712000000", "0.0.0-preview-20260712000000"],
			);
		}
	});

	it("two_same_named_projects_releasing_to_the_same_version_is_a_hard_error", () => {
		const error = failure(
			[project("@scope/util", "1.0.0", {}, "a/util"), project("@scope/util", "1.0.0", {}, "b/util")],
			[intent("one", { "./a/util": "patch", "./b/util": "patch" })],
		);
		assert.isTrue(
			error._tag === "VersioningError" &&
				error.reason === "duplicateRelease" &&
				error.code === "ERR_PNPM_VERSIONING_DUPLICATE_RELEASE" &&
				`${error.package}@${error.version}` === "@scope/util@1.0.1" &&
				error.directories?.join() === "a/util,b/util",
		);
	});

	it("epic_members_move_independently_inside_the_band_while_the_lead_major_holds", () => {
		const released = plan(
			[project("pnpm", "11.2.0"), project("lib", "1101.4.2")],
			[intent("one", { pnpm: "patch", lib: "minor" })],
			{
				versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
			},
		);
		assert.deepStrictEqual([next(released, "pnpm"), next(released, "lib")], ["11.2.1", "1101.5.0"]);
	});

	it("a_major_intent_bumps_a_member_to_the_next_major_inside_the_band", () => {
		const released = plan([project("pnpm", "11.0.0"), project("lib", "1101.4.2")], [intent("one", { lib: "major" })], {
			versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
		});
		assert.deepStrictEqual(names(released), ["lib"]);
		assert.strictEqual(next(released, "lib"), "1102.0.0");
	});

	const scoped = [
		project("pnpm", "11.0.0", {}, "pnpm"),
		project("@scope/a", "1100.0.0", {}, "pkgs/a"),
		project("@scope/b", "1100.0.0", {}, "pkgs/b"),
	];

	it("epic_membership_resolves_directory_globs_and_honors_negations", () => {
		const released = plan(
			[...scoped, project("@scope/tool", "5.0.0", {}, "tools/tool")],
			[intent("one", { pnpm: "major" })],
			{
				versioning: versioning({ epics: [epic("./pnpm", ["./pkgs/**", "!./pkgs/b"])] }),
			},
		);
		assert.deepStrictEqual(names(released), ["@scope/a", "pnpm"]);
		assert.strictEqual(next(released, "@scope/a"), "1200.0.0");
	});

	it("epic_selectors_are_order_dependent_a_later_include_overrides_an_earlier_negation", () => {
		const released = plan(scoped, [intent("one", { pnpm: "major" })], {
			versioning: versioning({ epics: [epic("./pnpm", ["!./pkgs/b", "./pkgs/**"])] }),
		});
		assert.deepStrictEqual(names(released), ["@scope/a", "@scope/b", "pnpm"]);
	});

	it("negative_only_epic_selectors_do_not_include_other_packages", () => {
		const released = plan(scoped, [intent("one", { pnpm: "major" })], {
			versioning: versioning({ epics: [epic("./pnpm", ["!./pkgs/b"])] }),
		});
		assert.deepStrictEqual(names(released), ["pnpm"]);
	});

	it("a_member_major_bump_that_would_exceed_the_band_ceiling_is_rejected", () => {
		const error = failure([project("pnpm", "11.0.0"), project("lib", "1199.4.2")], [intent("one", { lib: "major" })], {
			versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
		});
		assert.isTrue(
			error._tag === "VersioningError" &&
				error.reason === "epicOutOfBand" &&
				error.version === "1200.0.0" &&
				error.bandMajor === 11 &&
				error.lead === "pnpm",
		);
	});

	it("a_member_below_its_epic_band_is_rejected_when_it_releases", () => {
		const error = failure([project("pnpm", "11.0.0"), project("lib", "5.0.0")], [intent("one", { lib: "patch" })], {
			versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
		});
		assert.isTrue(
			error._tag === "VersioningError" && error.reason === "epicOutOfBand" && error.message.includes("1100-1199"),
		);
	});

	it("an_epic_whose_lead_is_not_a_releasable_project_fails_the_plan", () => {
		const error = failure([project("lib", "1101.0.0")], [], {
			versioning: versioning({ epics: [epic("ghost", ["lib"])] }),
		});
		assert.isTrue(
			error._tag === "VersioningError" &&
				error.reason === "epicUnknownLead" &&
				error.code === "ERR_PNPM_VERSIONING_EPIC_UNKNOWN_LEAD" &&
				error.lead === "ghost",
		);
	});

	it("a_first_release_publishes_the_current_version_verbatim_ignoring_the_intent_bump", () => {
		const released = plan([project("newpkg", "1100.0.0")], [intent("one", { newpkg: "minor" })], {
			unpublished: ["newpkg"],
		});
		assert.deepStrictEqual(
			released.releases.map((r) => [r.newVersion, r.type, r.changesets.join()]),
			[["1100.0.0", "minor", "one"]],
		);
	});

	it("a_published_current_version_bumps_normally_on_the_second_release", () => {
		const released = plan([project("newpkg", "1100.0.0")], [intent("one", { newpkg: "minor" })], { unpublished: [] });
		assert.strictEqual(next(released, "newpkg"), "1100.1.0");
	});

	it("a_first_release_does_not_propagate_to_dependents_since_its_version_does_not_move", () => {
		const released = plan(
			[project("lib", "1100.0.0"), project("cli", "3.0.0", { lib: "workspace:^" })],
			[intent("one", { lib: "minor" })],
			{ unpublished: ["lib"] },
		);
		assert.deepStrictEqual(
			released.releases.map((r) => [r.name, r.newVersion]),
			[["lib", "1100.0.0"]],
		);
	});

	it("a_first_release_on_a_lane_debuts_at_a_prerelease_of_the_current_version", () => {
		const released = plan([project("cli", "12.0.0")], [intent("one", { cli: "minor" })], {
			versioning: onLane("cli", "alpha"),
			unpublished: ["cli"],
		});
		assert.strictEqual(next(released, "cli"), "12.0.0-alpha.0");
	});

	it("an_unpublished_epic_member_re_bases_to_the_new_band_floor_when_the_lead_crosses_a_major", () => {
		const released = plan(
			[project("pnpm", "11.0.0"), project("lib", "1100.0.0")],
			[intent("one", { pnpm: "major", lib: "minor" })],
			{
				versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
				unpublished: ["lib"],
			},
		);
		assert.deepStrictEqual([next(released, "pnpm"), next(released, "lib")], ["12.0.0", "1200.0.0"]);
	});

	it("a_lane_named_main_is_rejected_as_the_reserved_default_lane (VersioningConfig refuses it)", () => {
		assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(VersioningConfig)({ lanes: { cli: "Main" } })));
		assert.isTrue(Result.isSuccess(Schema.decodeUnknownResult(VersioningConfig)({ lanes: { cli: "alpha" } })));
	});

	it("a fixed group split across lanes fails conflictingConfig (check_versioning_invariants_rejects_a_fixed_group_split_across_lanes)", () => {
		const error = failure([project("pnpm", "11.15.1"), project("@pnpm/exe", "11.15.1")], [], {
			versioning: versioning({ fixed: [["pnpm", "@pnpm/exe"]], lanes: { pnpm: "alpha" } }),
		});
		assert.isTrue(
			error._tag === "VersioningError" &&
				error.reason === "conflictingConfig" &&
				error.code === "ERR_PNPM_VERSIONING_CONFLICTING_CONFIG" &&
				error.group?.join() === "pnpm,@pnpm/exe",
		);
	});
});

describe("pnpm's engine tests: behavior.rs", () => {
	it("intents_already_recorded_in_the_ledger_are_not_consumed_again", () => {
		assert.deepStrictEqual(
			names(plan([project("a", "1.0.1")], [intent("one", { a: "patch" })], { ledger: ledger({ "a@1.0.1": ["one"] }) })),
			[],
		);
	});

	it("propagation_cascades_through_chains_of_dependents", () => {
		const released = plan(
			[
				project("core", "1.0.0"),
				project("mid", "1.0.0", { core: "workspace:*" }),
				project("top", "1.0.0", { mid: "workspace:*" }),
			],
			[intent("one", { core: "patch" })],
		);
		assert.deepStrictEqual(
			released.releases.map((r) => [r.name, r.newVersion, r.causes.join()]),
			[
				["core", "1.0.1", "intent"],
				["mid", "1.0.1", "dependencies"],
				["top", "1.0.1", "dependencies"],
			],
		);
	});

	it("an_intent_demanding_a_release_of_an_unreleasable_package_fails_the_plan", () => {
		const error = failure(
			[project("lib", "1.0.0"), project("frozen", "1.0.0")],
			[intent("one", { frozen: "patch", lib: "patch" })],
			{
				versioning: versioning({ ignore: ["frozen"] }),
			},
		);
		assert.isTrue(
			error._tag === "VersioningError" &&
				error.reason === "unreleasablePackage" &&
				error.package === "frozen" &&
				error.bump === "patch" &&
				error.changeset === "one.md",
		);
	});

	it("a_none_decline_for_an_unreleasable_package_is_accepted", () => {
		assert.deepStrictEqual(
			names(
				plan([project("lib", "1.0.0"), project("frozen", "1.0.0")], [intent("one", { frozen: "none", lib: "patch" })], {
					versioning: versioning({ ignore: ["frozen"] }),
				}),
			),
			["lib"],
		);
	});

	it("an_intent_naming_an_unknown_package_fails_the_plan", () => {
		const error = failure([project("lib", "1.0.0")], [intent("one", { ghost: "patch" })]);
		assert.isTrue(
			error._tag === "UnknownPackageError" && error.packageName === "ghost" && error.changeset === "one.md",
		);
	});

	it("an_intent_naming_a_main_lane_and_a_lane_package_is_consumed_half_by_half", () => {
		const released = plan(
			[project("cli", "2.0.0"), project("lib", "1.0.1")],
			[intent("one", { cli: "minor", lib: "patch" })],
			{
				versioning: onLane("cli", "alpha"),
				ledger: ledger({ "lib@1.0.1": ["one"] }),
			},
		);
		assert.deepStrictEqual(
			released.releases.map((r) => [r.name, r.newVersion]),
			[["cli", "2.1.0-alpha.0"]],
		);
	});

	it("when_the_lead_reaches_a_new_stable_major_every_member_re_bases_to_the_band_floor", () => {
		const released = plan(
			[project("pnpm", "11.9.9"), project("lib", "1101.4.2"), project("ui", "1105.0.0")],
			[intent("one", { pnpm: "major" })],
			{ versioning: versioning({ epics: [epic("pnpm", ["lib", "ui"])] }) },
		);
		assert.deepStrictEqual(
			released.releases.map((r) => [r.name, r.newVersion, r.causes.join()]),
			[
				["lib", "1200.0.0", "epic"],
				["pnpm", "12.0.0", "intent"],
				["ui", "1200.0.0", "epic"],
			],
		);
	});

	it("a_member_on_a_lane_re_bases_to_a_prerelease_of_the_band_floor", () => {
		const released = plan([project("pnpm", "11.0.0"), project("lib", "1101.2.0")], [intent("one", { pnpm: "major" })], {
			versioning: versioning({ epics: [epic("pnpm", ["lib"])], lanes: { lib: "alpha" } }),
		});
		assert.strictEqual(next(released, "lib"), "1200.0.0-alpha.0");
	});

	it("the_re_base_waits_while_the_lead_is_on_a_prerelease_lane", () => {
		const released = plan(
			[project("pnpm", "11.0.0"), project("lib", "1101.2.0")],
			[intent("one", { pnpm: "major", lib: "patch" })],
			{
				versioning: versioning({ epics: [epic("pnpm", ["lib"])], lanes: { pnpm: "alpha" } }),
			},
		);
		assert.deepStrictEqual([next(released, "pnpm"), next(released, "lib")], ["12.0.0-alpha.0", "1101.2.1"]);
	});

	it("the_members_re_base_when_a_prerelease_lead_graduates_to_its_new_major", () => {
		const released = plan(
			[project("pnpm", "12.0.0-alpha.0"), project("lib", "1101.2.0")],
			[intent("one", { pnpm: "major" })],
			{
				versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
			},
		);
		assert.deepStrictEqual([next(released, "pnpm"), next(released, "lib")], ["12.0.0", "1200.0.0"]);
	});

	it("the_top_of_the_band_takes_a_minor_without_tripping_the_ceiling_guard", () => {
		const released = plan([project("pnpm", "11.0.0"), project("lib", "1199.4.2")], [intent("one", { lib: "minor" })], {
			versioning: versioning({ epics: [epic("pnpm", ["lib"])] }),
		});
		assert.strictEqual(next(released, "lib"), "1199.5.0");
	});
});
