import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { ReleasePlan } from "../src/ReleasePlan.js";
import { ROOT, caseNames, loadExpected, loadPrelude } from "./support/pnpmOracle.js";

// ReleasePlan.read end to end on each oracle case that needs no prelude: the
// fixture's files on an in-memory volume, the manager detected from its
// `versioning` key, the block read through PnpmSettings, the ledger through
// Ledger.read. No case has a `.changeset/config.json`, which pnpm never reads,
// so this also pins that a pnpm repository plans without one. The registry is
// not consulted (`read` passes no `published` set yet), so the one public
// case, `first-release`, plans a normal bump here; its debut is pinned by the
// pure oracle suite.

const RECORDED = new Set(["expected.json", "status.txt", "ledger.after.yaml", "prelude.json"]);

const seedOf = (name: string): Record<string, string> => {
	const base = join(ROOT, name);
	const seed: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (!(dir === base && RECORDED.has(entry.name)))
				seed[`/repo/${relative(base, path)}`] = readFileSync(path, "utf8");
		}
	};
	walk(base);
	return seed;
};

const layerFor = (name: string) =>
	WorkspaceDiscovery.layer().pipe(
		Layer.provide(WorkspaceRoot.layer),
		Layer.provideMerge(MemoryFileSystem.layerWithPath(seedOf(name))),
	);

const cases = caseNames().filter((name) => loadPrelude(name).length === 0 && name !== "first-release");

it("reads every prelude-free case but the one that needs a registry", () => {
	assert.strictEqual(cases.length, 9);
});

describe("ReleasePlan.read on a pnpm-native repository", () => {
	for (const name of cases) {
		// Each case is its own volume, so each test provides its own layer.
		it.effect(name, () =>
			Effect.gen(function* () {
				const expected = loadExpected(name);
				const result = yield* Effect.result(ReleasePlan.read("/repo"));
				if (expected.outcome === "rejected") {
					assert.isTrue(result._tag === "Failure", `${name} should be refused`);
					if (result._tag === "Failure") {
						const failure = result.failure;
						assert.strictEqual(failure._tag, "VersioningError");
						if (failure._tag === "VersioningError") assert.strictEqual(failure.code, expected.errors[0]?.code);
					}
					return;
				}
				assert.isTrue(result._tag === "Success", `${name} should plan`);
				if (result._tag !== "Success") return;
				assert.deepStrictEqual(
					result.success.releases.map((r) => [r.name, r.oldVersion, r.newVersion, r.type, r.causes.join("+")]),
					expected.releases.map((r) => [r.name, r.currentVersion, r.newVersion, r.bump ?? "none", r.causes.join("+")]),
				);
			}).pipe(Effect.provide(layerFor(name))),
		);
	}
});

it.effect("read plans first-release as a normal bump without a registry", () =>
	Effect.gen(function* () {
		const plan = yield* ReleasePlan.read("/repo");
		assert.deepStrictEqual(
			plan.releases.map((r) => [r.name, r.oldVersion, r.newVersion]),
			[["@p/a", "1.0.0", "1.1.0"]],
		);
	}).pipe(Effect.provide(layerFor("first-release"))),
);
