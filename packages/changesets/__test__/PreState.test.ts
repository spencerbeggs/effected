import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Option } from "effect";
import { PreState } from "../src/PreState.js";

const withPre = (text: string | undefined) =>
	MemoryFileSystem.layerWithPath({
		"/repo/.changeset/config.json": "{}",
		...(text === undefined ? {} : { "/repo/.changeset/pre.json": text }),
	});

it.effect("answers none when the repository is not in pre-release mode", () =>
	Effect.gen(function* () {
		assert.isTrue(Option.isNone(yield* PreState.read("/repo")));
	}).pipe(Effect.provide(withPre(undefined))),
);

it.effect("reads the mode and tag, and keeps an older layout's consumed ids", () =>
	Effect.gen(function* () {
		const pre = yield* PreState.read("/repo");
		assert.isTrue(Option.isSome(pre));
		if (Option.isSome(pre)) {
			assert.strictEqual(pre.value.mode, "pre");
			assert.strictEqual(pre.value.tag, "next");
			assert.deepStrictEqual(pre.value.changesets, ["old-one"]);
		}
	}).pipe(
		Effect.provide(withPre('{"mode":"pre","tag":"next","initialVersions":{"a":"1.0.0"},"changesets":["old-one"]}')),
	),
);

it.effect("reads exit mode", () =>
	Effect.gen(function* () {
		const pre = yield* PreState.read("/repo");
		assert.isTrue(Option.isSome(pre) && pre.value.mode === "exit" && pre.value.changesets === undefined);
	}).pipe(Effect.provide(withPre('{"mode":"exit","tag":"beta"}'))),
);

it.effect("fails with ChangesetConfigError on a file that is not JSON", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(PreState.read("/repo"));
		assert.isTrue(error._tag === "ChangesetConfigError" && error.reason.startsWith("pre.json is not valid JSON"));
	}).pipe(Effect.provide(withPre("{mode"))),
);

it.effect("fails with ChangesetConfigError on a pre.json with no tag", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(PreState.read("/repo"));
		assert.isTrue(error._tag === "ChangesetConfigError" && error.reason.startsWith("pre.json: "));
	}).pipe(Effect.provide(withPre('{"mode":"pre"}'))),
);

it.effect("fails with ChangesetConfigError on a mode other than pre or exit", () =>
	Effect.gen(function* () {
		const error = yield* Effect.flip(PreState.read("/repo"));
		assert.isTrue(error._tag === "ChangesetConfigError" && error.reason.startsWith("pre.json: "));
	}).pipe(Effect.provide(withPre('{"mode":"enter","tag":"next"}'))),
);
