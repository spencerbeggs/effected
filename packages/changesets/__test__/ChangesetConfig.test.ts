import { readFileSync } from "node:fs";
import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect } from "effect";
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
		assert.isDefined(config.extra.changelog);
		assert.strictEqual(config.extra.$schema, "https://unpkg.com/@changesets/config@3.1.1/schema.json");
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
