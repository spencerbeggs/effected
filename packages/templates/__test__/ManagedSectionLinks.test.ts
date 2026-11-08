import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path } from "effect";
import { ManagedSection } from "../src/index.js";
import { lines, section } from "./fixtures.js";

const TARGET = "/repo/.husky/pre-commit";
const OUTSIDE = "/outside/hook";
const OLD = lines("#!/bin/sh", "echo before", "");

const env = (links?: "follow" | "replace") =>
	ManagedSection.layerWith(links === undefined ? {} : { links }).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				MemoryFileSystem.layerWith({ [OUTSIDE]: OLD, [TARGET]: MemoryFileSystem.symlink(OUTSIDE) }),
				Path.layer,
			),
		),
	);

describe("ManagedSection links", () => {
	for (const [label, links] of [
		["by default", undefined],
		['with links: "follow"', "follow"],
	] as const) {
		it.effect(`sync ${label} writes through a symlinked target and keeps the link`, () =>
			Effect.gen(function* () {
				yield* (yield* ManagedSection).sync(TARGET, section("tool", "echo hi"));
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.readLink(TARGET), OUTSIDE);
				assert.include(volume.text(OUTSIDE) ?? "", "echo hi");
			}).pipe(Effect.provide(env(links))),
		);
	}

	it.effect('sync with links: "replace" replaces the link and leaves its destination alone', () =>
		Effect.gen(function* () {
			yield* (yield* ManagedSection).sync(TARGET, section("tool", "echo hi"));
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(OUTSIDE), OLD);
			assert.strictEqual(volume.lstat(TARGET)?.kind, "file");
			assert.isUndefined(volume.readLink(TARGET));
			assert.include(volume.text(TARGET) ?? "", "echo hi");
		}).pipe(Effect.provide(env("replace"))),
	);
});
