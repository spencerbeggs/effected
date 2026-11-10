import { readFileSync } from "node:fs";
import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Result } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";

const fixture = readFileSync(new URL("./fixtures/config.json", import.meta.url), "utf8");

const withConfig = (text: string | undefined, extra: Record<string, string> = {}) =>
	MemoryFileSystem.layerWithPath({
		"/repo/package.json": "{}",
		...(text === undefined ? {} : { "/repo/.changeset/config.json": text }),
		...extra,
	});

it.effect("decodes this repository's own config", () =>
	Effect.gen(function* () {
		const config = yield* ChangesetConfig.read("/repo");
		assert.strictEqual(config.updateInternalDependencies, "patch");
		assert.deepStrictEqual(config.ignore, ["docs", "scratchpad"]);
		assert.strictEqual(config.baseBranch, "main");
		assert.strictEqual(config.access, "restricted");
		assert.deepStrictEqual(config.privatePackages, { tag: true, version: true });
		assert.isFalse(config.commit);
	}).pipe(Effect.provide(withConfig(fixture))),
);

it.effect("keeps unknown keys instead of rejecting them", () =>
	Effect.gen(function* () {
		const config = yield* ChangesetConfig.read("/repo");
		assert.isUndefined(config.extra.changelog);
		assert.strictEqual(config.extra.$schema, "https://unpkg.com/@changesets/config@3.1.1/schema.json");
	}).pipe(Effect.provide(withConfig(fixture))),
);

it.effect("changelog and snapshot are modelled, not left on extra", () =>
	Effect.gen(function* () {
		const config = yield* ChangesetConfig.read("/repo");
		assert.isTrue(Array.isArray(config.changelog));
		if (Array.isArray(config.changelog)) assert.strictEqual(config.changelog[0], "@savvy-web/changelog");
		assert.deepStrictEqual(config.snapshot, { useCalculatedVersion: false });
		assert.notProperty(config.extra, "changelog");
		assert.notProperty(config.extra, "snapshot");
	}).pipe(Effect.provide(withConfig(fixture))),
);

it.effect("an empty object decodes to the documented defaults", () =>
	Effect.gen(function* () {
		const config = yield* ChangesetConfig.read("/repo");
		assert.strictEqual(config.baseBranch, "main");
		assert.deepStrictEqual(config.fixed, []);
		assert.deepStrictEqual(config.linked, []);
		assert.deepStrictEqual(config.ignore, []);
		assert.strictEqual(config.updateInternalDependencies, "patch");
		assert.deepStrictEqual(config.privatePackages, { tag: false, version: false });
		assert.strictEqual(config.access, "restricted");
		assert.isFalse(config.commit);
		assert.strictEqual(config.changelog, "@changesets/cli/changelog");
		assert.deepStrictEqual(config.snapshot, { useCalculatedVersion: false });
	}).pipe(Effect.provide(withConfig("{}"))),
);

for (const flag of [true, false]) {
	it.effect(`privatePackages: ${flag} sets both tag and version`, () =>
		Effect.gen(function* () {
			const config = yield* ChangesetConfig.read("/repo");
			assert.deepStrictEqual(config.privatePackages, { tag: flag, version: flag });
		}).pipe(Effect.provide(withConfig(`{"privatePackages":${flag}}`))),
	);
}

it.effect("fixed groups round-trip", () =>
	Effect.gen(function* () {
		const config = yield* ChangesetConfig.read("/repo");
		assert.deepStrictEqual(config.fixed, [["a", "b"]]);
	}).pipe(Effect.provide(withConfig('{"fixed":[["a","b"]]}'))),
);

it.effect("a missing config is ChangesetConfigError with reason missing", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ChangesetConfig.read("/repo"));
		assert.strictEqual(error._tag, "ChangesetConfigError");
		if (error._tag === "ChangesetConfigError") assert.strictEqual(error.reason, "missing");
	}).pipe(Effect.provide(withConfig(undefined))),
);

it.effect("invalid JSON and wrong value types are ChangesetConfigError", () =>
	Effect.gen(function* () {
		const syntax = yield* Effect.flip(ChangesetConfig.read("/repo"));
		assert.strictEqual(syntax._tag, "ChangesetConfigError");
	}).pipe(Effect.provide(withConfig("{ nope"))),
);

it.effect("a bad access value is ChangesetConfigError", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(ChangesetConfig.read("/repo"));
		assert.strictEqual(error._tag, "ChangesetConfigError");
	}).pipe(Effect.provide(withConfig('{"access":"private"}'))),
);

it.effect("a present pre.json does not stop the config reading", () =>
	Effect.gen(function* () {
		const config = yield* ChangesetConfig.read("/repo");
		assert.strictEqual(config.baseBranch, "main");
	}).pipe(Effect.provide(withConfig("{}", { "/repo/.changeset/pre.json": '{"mode":"pre","tag":"next"}' }))),
);

it("make fills changelog and snapshot with the decoding defaults", () => {
	const config = ChangesetConfig.make({
		baseBranch: "main",
		fixed: [],
		linked: [],
		ignore: [],
		updateInternalDependencies: "patch",
		privatePackages: { tag: false, version: false },
		access: "restricted",
		commit: false,
		extra: {},
	});
	assert.strictEqual(config.changelog, "@changesets/cli/changelog");
	assert.deepStrictEqual(config.snapshot, { useCalculatedVersion: false });
});

/**
 * Copied from `@changesets/config` 4.0.1's `validateConfig` (the version
 * `@changesets/get-release-plan` 5.0.2 resolves), run over each written
 * value. `accepted` is the oracle's verdict; `decoded` is that answer in the
 * written form this package keeps (the oracle turns a bare id into
 * `[id, null]`). Never hand-edit a verdict.
 */
const changelogOracle: ReadonlyArray<{ readonly written: unknown; readonly decoded?: unknown }> = [
	{ written: false, decoded: false },
	{ written: "x", decoded: "x" },
	{ written: ["x", { a: 1 }], decoded: ["x", { a: 1 }] },
	{ written: ["x", null], decoded: ["x", null] },
	{ written: ["x", { a: 1 }, 3], decoded: ["x", { a: 1 }] },
	{ written: ["x"] },
	{ written: true },
];

for (const { written, decoded } of changelogOracle) {
	it.effect(
		`changelog ${JSON.stringify(written)} ${decoded === undefined ? "is refused" : "decodes"} as the oracle answers`,
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.result(ChangesetConfig.read("/repo"));
				if (decoded === undefined) assert.isTrue(Result.isFailure(result));
				else {
					assert.isTrue(Result.isSuccess(result));
					if (Result.isSuccess(result)) assert.deepStrictEqual(result.success.changelog, decoded);
				}
			}).pipe(Effect.provide(withConfig(JSON.stringify({ changelog: written })))),
	);
}

/** Copied from the same `validateConfig` run; see {@link changelogOracle}. */
const snapshotOracle: ReadonlyArray<{ readonly written: unknown; readonly decoded?: unknown }> = [
	{ written: {}, decoded: { useCalculatedVersion: false } },
	{ written: { useCalculatedVersion: true }, decoded: { useCalculatedVersion: true } },
	{ written: { prereleaseTemplate: "{tag}" }, decoded: { useCalculatedVersion: false, prereleaseTemplate: "{tag}" } },
	{ written: { extra: 1 }, decoded: { useCalculatedVersion: false } },
	{ written: [], decoded: { useCalculatedVersion: false } },
	{ written: { prereleaseTemplate: "" } },
	{ written: { prereleaseTemplate: null } },
	{ written: null },
	{ written: { useCalculatedVersion: "yes" } },
];

for (const { written, decoded } of snapshotOracle) {
	it.effect(
		`snapshot ${JSON.stringify(written)} ${decoded === undefined ? "is refused" : "decodes"} as the oracle answers`,
		() =>
			Effect.gen(function* () {
				const result = yield* Effect.result(ChangesetConfig.read("/repo"));
				if (decoded === undefined) {
					assert.isTrue(Result.isFailure(result));
					if (Result.isFailure(result)) assert.strictEqual(result.failure._tag, "ChangesetConfigError");
				} else {
					assert.isTrue(Result.isSuccess(result));
					if (Result.isSuccess(result)) assert.deepStrictEqual(result.success.snapshot, decoded);
				}
			}).pipe(Effect.provide(withConfig(JSON.stringify({ snapshot: written })))),
	);
}
