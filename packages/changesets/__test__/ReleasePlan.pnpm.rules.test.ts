import { assert, describe, it } from "@effect/vitest";
import { Epic, VersioningConfig } from "@effected/pnpm";
import { WorkspacePackage } from "@effected/workspaces";
import { Result, Schema } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { Ledger, LedgerEntry } from "../src/Ledger.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

// The pnpm planner's refusals and edges the oracle fixtures do not reach, each
// cited to the pnpm 12.20.0 source it restates (.repos/pnpm/pnpm/crates/versioning/src).

type Bump = "none" | "patch" | "minor" | "major";

const at = (
	name: string,
	dir: string,
	fields: { readonly version?: string; readonly private?: boolean } & Partial<
		Pick<WorkspacePackage, "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies">
	> = {},
): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version: "1.0.0",
		...fields,
		path: `/ws/${dir}`,
		packageJsonPath: `/ws/${dir}/package.json`,
		relativePath: dir,
		workspaceRoot: "/ws",
	});

const versionless = (name: string, dir: string): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		path: `/ws/${dir}`,
		packageJsonPath: `/ws/${dir}/package.json`,
		relativePath: dir,
		workspaceRoot: "/ws",
	});

const intent = (file: string, releases: Record<string, Bump>): PendingChangeset =>
	PendingChangeset.make({ file, releases: new Map(Object.entries(releases)), summary: "Summary." });

const config = Schema.decodeUnknownSync(ChangesetConfig)({});

const assemble = (
	packages: ReadonlyArray<WorkspacePackage>,
	changesets: ReadonlyArray<PendingChangeset>,
	options: {
		readonly versioning?: Partial<VersioningConfig>;
		readonly ledger?: ReadonlyArray<LedgerEntry>;
		readonly currentVersions?: ReadonlyMap<string, string>;
		readonly enforceWorkspaceProtocol?: boolean;
	} = {},
) =>
	ReleasePlan.assemble({
		packages,
		changesets,
		config,
		manager: "pnpm",
		...(options.versioning === undefined ? {} : { versioning: VersioningConfig.make(options.versioning) }),
		...(options.ledger === undefined ? {} : { ledger: Ledger.make({ entries: [...options.ledger] }) }),
		...(options.currentVersions === undefined ? {} : { currentVersions: options.currentVersions }),
		...(options.enforceWorkspaceProtocol === undefined
			? {}
			: { enforceWorkspaceProtocol: options.enforceWorkspaceProtocol }),
	});

const releases = (result: ReturnType<typeof assemble>) => {
	assert.isTrue(Result.isSuccess(result), Result.isFailure(result) ? result.failure.message : "");
	return Result.isSuccess(result)
		? result.success.releases.map((r) => [r.name, r.dir, r.newVersion, r.causes.join("+")] as const)
		: [];
};

const versioningError = (result: ReturnType<typeof assemble>) => {
	assert.isTrue(Result.isFailure(result), "the plan should fail");
	const failure = Result.isFailure(result) ? result.failure : undefined;
	assert.strictEqual(failure?._tag, "VersioningError");
	return failure?._tag === "VersioningError" ? failure : undefined;
};

const twins = [at("util", "a/util"), at("util", "b/util", { version: "2.0.0" })];

describe("pnpm refusals", () => {
	it("a bare-list ledger entry naming a shared name is ambiguousLedgerEntry (ledger.rs:350-363)", () => {
		const error = versioningError(
			assemble(twins, [], { ledger: [LedgerEntry.make({ name: "util", version: "1.0.0", intents: ["x"] })] }),
		);
		assert.strictEqual(error?.reason, "ambiguousLedgerEntry");
		assert.strictEqual(error?.code, "ERR_PNPM_INVALID_VERSIONING_LEDGER");
		assert.strictEqual(error?.ledgerKey, "util@1.0.0");
		assert.deepStrictEqual(error?.directories, ["a/util", "b/util"]);
	});

	it("an attributed ledger entry for a shared name is matched by its dir and plans", () => {
		const entry = LedgerEntry.make({ name: "util", version: "1.0.1", dir: "a/util", intents: ["one"] });
		assert.deepStrictEqual(
			releases(assemble(twins, [intent("one.md", { "./a/util": "patch", "./b/util": "patch" })], { ledger: [entry] })),
			[["util", "b/util", "2.0.1", "intent"]],
		);
	});

	it("a shared name in a versioning setting is ambiguousPackage (project_refs.rs:242-256)", () => {
		const error = versioningError(assemble(twins, [], { versioning: { ignore: ["util"] } }));
		assert.isTrue(
			error?.reason === "ambiguousPackage" &&
				error.code === "ERR_PNPM_VERSIONING_AMBIGUOUS_PACKAGE" &&
				error.context === "versioning.ignore" &&
				error.package === "util",
		);
	});

	it("a dependency on a shared name is ambiguousPackage naming the dependent (project_refs.rs:164-201)", () => {
		const error = versioningError(
			assemble([...twins, at("app", "app", { dependencies: { util: "workspace:^" } })], []),
		);
		assert.isTrue(error?.reason === "ambiguousPackage" && error.context === "Package app (./app)");
	});

	it("a project in two epics is epicOverlap (configuration.rs:165-182)", () => {
		const error = versioningError(
			assemble([at("one", "one"), at("two", "two"), at("lib", "lib", { version: "100.0.0" })], [], {
				versioning: {
					epics: [Epic.make({ lead: "one", packages: ["lib"] }), Epic.make({ lead: "two", packages: ["lib"] })],
				},
			}),
		);
		assert.isTrue(
			error?.reason === "epicOverlap" &&
				error.code === "ERR_PNPM_VERSIONING_EPIC_OVERLAP" &&
				error.directories?.join() === "lib" &&
				error.lead === "one" &&
				error.secondLead === "two",
		);
	});

	it("a fixed group straddling an epic is epicFixedGroupConflict (configuration.rs:186-208)", () => {
		const error = versioningError(
			assemble([at("app", "app"), at("lib", "lib", { version: "100.0.0" }), at("other", "other")], [], {
				versioning: { epics: [Epic.make({ lead: "app", packages: ["lib"] })], fixed: [["lib", "other"]] },
			}),
		);
		assert.isTrue(
			error?.reason === "epicFixedGroupConflict" &&
				error.code === "ERR_PNPM_VERSIONING_EPIC_FIXED_GROUP_CONFLICT" &&
				error.directories?.join() === "other",
		);
	});

	it("a version-less project asked for a real bump is unreleasablePackage (configuration.rs:261-267)", () => {
		const error = versioningError(assemble([versionless("ghost", "ghost")], [intent("one.md", { ghost: "patch" })]));
		assert.isTrue(error?.reason === "unreleasablePackage" && error.code === "ERR_PNPM_VERSIONING_UNRELEASABLE_PACKAGE");
	});

	it("a consumed intent still resolves its keys, as resolve_intents runs before consumption (plan.rs:137)", () => {
		const result = assemble([at("lib", "lib")], [intent("old.md", { ghost: "patch" })], {
			ledger: [LedgerEntry.make({ name: "lib", version: "1.0.0", dir: "lib", intents: ["old"] })],
		});
		assert.isTrue(Result.isFailure(result) && result.failure._tag === "UnknownPackageError");
	});

	it("enforceWorkspaceProtocol refuses a plain internal range as internalRange (project_refs.rs:258-274)", () => {
		const packages = [at("lib", "lib"), at("app", "app", { peerDependencies: { lib: "^1.0.0" } })];
		const error = versioningError(assemble(packages, [], { enforceWorkspaceProtocol: true }));
		assert.isTrue(
			error?.reason === "internalRange" &&
				error.code === "ERR_PNPM_VERSIONING_INTERNAL_RANGE" &&
				error.dependency?.field === "peerDependencies" &&
				error.dependency.specifier === "^1.0.0",
		);
		// Off (pnpm change status's reading) the same workspace plans.
		assert.isTrue(Result.isSuccess(assemble(packages, [])));
	});
});

describe("pnpm propagation", () => {
	const lib = at("lib", "lib");

	it("a plain range constrains nothing: only workspace: specs materialise (versions.rs:348-360)", () => {
		assert.deepStrictEqual(
			releases(
				assemble([lib, at("app", "app", { dependencies: { lib: "^1.0.0" } })], [intent("one.md", { lib: "major" })]),
			),
			[["lib", "lib", "2.0.0", "intent"]],
		);
	});

	it("devDependencies never ripple (plan.rs:28-32)", () => {
		assert.deepStrictEqual(
			releases(
				assemble(
					[lib, at("app", "app", { devDependencies: { lib: "workspace:*" } })],
					[intent("one.md", { lib: "patch" })],
				),
			),
			[["lib", "lib", "1.0.1", "intent"]],
		);
	});

	it("workspace:^ holds a 1.x minor and breaks on a major; workspace:* breaks on any bump", () => {
		const caret = at("caret", "caret", { dependencies: { lib: "workspace:^" } });
		const exact = at("exact", "exact", { optionalDependencies: { lib: "workspace:*" } });
		assert.deepStrictEqual(releases(assemble([lib, caret, exact], [intent("one.md", { lib: "minor" })])), [
			["exact", "exact", "1.0.1", "dependencies"],
			["lib", "lib", "1.1.0", "intent"],
		]);
		assert.deepStrictEqual(releases(assemble([lib, caret, exact], [intent("one.md", { lib: "major" })])), [
			["caret", "caret", "1.0.1", "dependencies"],
			["exact", "exact", "1.0.1", "dependencies"],
			["lib", "lib", "2.0.0", "intent"],
		]);
	});

	it("a lane prerelease leaves workspace:^, which admits no prerelease", () => {
		assert.deepStrictEqual(
			releases(
				assemble(
					[lib, at("app", "app", { dependencies: { lib: "workspace:^" } })],
					[intent("one.md", { lib: "minor" })],
					{
						versioning: { lanes: { lib: "alpha" } },
					},
				),
			),
			[
				["app", "app", "1.0.1", "dependencies"],
				["lib", "lib", "1.1.0-alpha.0", "intent"],
			],
		);
	});

	it("an aliased workspace:alias@range spec targets its alias (project_refs.rs:208-236)", () => {
		assert.deepStrictEqual(
			releases(
				assemble(
					[lib, at("app", "app", { dependencies: { renamed: "workspace:lib@^1.0.0" } })],
					[intent("one.md", { lib: "major" })],
				),
			),
			[
				["app", "app", "1.0.1", "dependencies"],
				["lib", "lib", "2.0.0", "intent"],
			],
		);
	});

	it("a private project is a participant and releases (project_refs.rs:117-144)", () => {
		assert.deepStrictEqual(
			releases(assemble([at("lib", "lib", { private: true })], [intent("one.md", { lib: "patch" })])),
			[["lib", "lib", "1.0.1", "intent"]],
		);
	});

	it("the workspace root is the project at the empty directory", () => {
		const root = at("root", ".");
		assert.deepStrictEqual(releases(assemble([root, lib], [intent("one.md", { "./": "minor" })])), [
			["root", "", "1.1.0", "intent"],
		]);
	});

	it("changesets under .changeset/pre/ are not intents", () => {
		assert.deepStrictEqual(releases(assemble([lib], [intent("pre/old.md", { lib: "major" })])), []);
	});
});

describe("pnpm first releases", () => {
	it("a private project is never probed, so a missing registry version does not make it debut (changelog.rs:261-264)", () => {
		assert.deepStrictEqual(
			releases(
				assemble([at("lib", "lib", { private: true })], [intent("one.md", { lib: "minor" })], {
					currentVersions: new Map(),
				}),
			),
			[["lib", "lib", "1.1.0", "intent"]],
		);
	});

	it("a public project the registry has at another version debuts: pnpm probes its manifest version", () => {
		assert.deepStrictEqual(
			releases(
				assemble([at("lib", "lib")], [intent("one.md", { lib: "minor" })], {
					currentVersions: new Map([["lib", "0.9.0"]]),
				}),
			),
			[["lib", "lib", "1.0.0", "intent"]],
		);
	});

	it("without currentVersions nothing debuts", () => {
		assert.deepStrictEqual(releases(assemble([at("lib", "lib")], [intent("one.md", { lib: "minor" })])), [
			["lib", "lib", "1.1.0", "intent"],
		]);
	});

	it("only the first plan's releases are probed: a dependent reached on the second pass is not", () => {
		// The second pass is planned with lib unpublished; app joins no plan here, since lib's debut moves nothing.
		const app = at("app", "app", { dependencies: { lib: "workspace:*" } });
		assert.deepStrictEqual(
			releases(assemble([at("lib", "lib"), app], [intent("one.md", { lib: "patch" })], { currentVersions: new Map() })),
			[["lib", "lib", "1.0.0", "intent"]],
		);
	});
});

describe("causes in a Changesets plan", () => {
	const pkg = (name: string, extra: Partial<Pick<WorkspacePackage, "dependencies">> = {}) =>
		WorkspacePackage.make({
			name,
			version: "1.0.0",
			path: `/repo/packages/${name}`,
			packageJsonPath: `/repo/packages/${name}/package.json`,
			relativePath: `packages/${name}`,
			workspaceRoot: "/repo",
			...extra,
		});

	it("fills intent, dependencies and fixed, and leaves dir out", () => {
		const result = ReleasePlan.assemble({
			packages: [pkg("a"), pkg("b", { dependencies: { a: "workspace:*" } }), pkg("c"), pkg("d")],
			changesets: [intent("one.md", { a: "minor", c: "patch" })],
			config: Schema.decodeUnknownSync(ChangesetConfig)({ fixed: [["c", "d"]] }),
		});
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.deepStrictEqual(
				result.success.releases.map((r) => [r.name, r.causes.join("+"), r.dir]),
				[
					["a", "intent", undefined],
					["b", "dependencies", undefined],
					["c", "intent", undefined],
					["d", "fixed", undefined],
				],
			);
		}
	});
});
