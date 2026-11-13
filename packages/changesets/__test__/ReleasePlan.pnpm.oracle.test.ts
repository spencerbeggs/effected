import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { Ledger } from "../src/Ledger.js";
import { ReleasePlan } from "../src/ReleasePlan.js";
import type { AppliedRelease, OracleWorkspace } from "./support/pnpmOracle.js";
import {
	applyRelease,
	caseNames,
	ledgerLines,
	loadExpected,
	loadLedgerAfter,
	loadPrelude,
	loadWorkspace,
	runStep,
} from "./support/pnpmOracle.js";

// pnpm 12.20.0 is the authority on a pnpm-native plan. Each case under
// fixtures/pnpm-native/ is the answer pnpm gave on an applied run (see that
// README). The planner is held to it field for field: name, versions, the bump
// `pnpm change status` reported, and the causes in pnpm's order
// (`ReleaseCause`'s derived Ord, crates/versioning/src/plan.rs:56-68). A
// rejected case must fail VersioningError carrying the same ERR_PNPM_* code.
//
// Every case is planned with an empty `published`: the recorder pointed pnpm at
// an unreachable registry, and the pnpm that ran treated that as "not
// published" (see the fixtures README). Private projects are never probed
// (crates/cli/src/cli_args/changelog.rs:261-264), so only `first-release`, the
// one public case, debuts.

const config = Schema.decodeUnknownSync(ChangesetConfig)({});
const published: ReadonlySet<string> = new Set();

const assemble = (workspace: OracleWorkspace) =>
	ReleasePlan.assemble({
		packages: workspace.packages,
		changesets: workspace.changesets,
		config,
		manager: "pnpm",
		...(workspace.versioning === undefined ? {} : { versioning: workspace.versioning }),
		ledger: Ledger.make({ entries: workspace.ledger }),
		published,
	});

const applied = (plan: ReleasePlan): ReadonlyArray<AppliedRelease> =>
	plan.releases.map((release) => ({
		name: release.name,
		dir: release.dir ?? "",
		newVersion: release.newVersion,
		intents: release.changesets,
	}));

const planOrThrow = (workspace: OracleWorkspace): ReadonlyArray<AppliedRelease> => {
	const result = assemble(workspace);
	if (Result.isFailure(result)) throw new Error(`a prelude plan failed: ${result.failure.message}`);
	return applied(result.success);
};

const cases = caseNames();

it("finds every recorded pnpm-native case", () => {
	// Twelve are recorded today; a silently empty walk would pass every loop below.
	assert.strictEqual(cases.length, 12);
});

describe("ReleasePlan.assemble under pnpm, against pnpm 12.20.0", () => {
	for (const name of cases) {
		it.effect(name, () =>
			Effect.sync(() => {
				const expected = loadExpected(name);
				const workspace = loadWorkspace(name);
				for (const step of loadPrelude(name)) runStep(workspace, step, planOrThrow);
				const result = assemble(workspace);

				if (expected.outcome === "rejected") {
					assert.isTrue(Result.isFailure(result), `${name} should be refused`);
					if (Result.isFailure(result)) {
						const failure = result.failure;
						const code = expected.errors[0]?.code;
						assert.isString(code);
						assert.strictEqual(failure._tag, "VersioningError", failure.message);
						if (failure._tag === "VersioningError") assert.strictEqual(failure.code, code);
					}
					return;
				}

				assert.isTrue(Result.isSuccess(result), `${name} should plan`);
				if (Result.isFailure(result)) return;
				const plan = result.success;
				assert.deepStrictEqual(
					plan.releases.map((release) => ({
						name: release.name,
						currentVersion: release.oldVersion,
						newVersion: release.newVersion,
						bump: release.type,
						causes: [...release.causes],
					})),
					expected.releases.map((release) => ({
						...release,
						bump: release.bump ?? "none",
						causes: [...release.causes],
					})),
				);

				// The ledger pnpm left: the prelude's entries and this run's, one per release that
				// consumed intents. It pins each release's `changesets` (the intents it consumes).
				applyRelease(workspace, applied(plan));
				const after = loadLedgerAfter(name, expected);
				assert.deepStrictEqual(ledgerLines(workspace.ledger), after === undefined ? [] : ledgerLines(after.entries));
			}),
		);
	}
});
